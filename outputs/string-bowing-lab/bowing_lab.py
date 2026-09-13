"""Educational bowing assistant, Python standard library only.

This proposes discussion candidates, not physically certified bowings.
Input scope: uncompressed, unnamespaced partwise MusicXML, one monophonic
line per part, positive durations, constant user-supplied quarter-note tempo.
Rejects chords/backups/forwards/grace notes instead of silently misreading them.
Run: python3 bowing_lab.py --self-test
     python3 bowing_lab.py --input source.musicxml --output report.json
"""
from __future__ import annotations
import argparse
from dataclasses import dataclass, asdict
from fractions import Fraction
import json
from pathlib import Path
import xml.etree.ElementTree as ET

@dataclass
class Event:
    measure: str
    index: int
    onset: Fraction
    beats: Fraction
    pitch: str | None
    tie_start: bool = False
    tie_stop: bool = False

@dataclass
class Attack:
    onset: Fraction
    beats: Fraction
    pitch: str | None
    locations: list[str]

@dataclass
class Policy:
    # Editorial defaults for this exercise. NOT measured instrument limits.
    max_group_beats: float = 2.0
    review_seconds: float = 2.5
    start_direction: str = 'down'
    split_repeated_attacks: bool = True


def parse_part(part):
    events, original_slurs = [], []
    division = None
    absolute = Fraction(0)
    opened = {}
    for measure in part.findall('measure'):
        number = measure.get('number', '?')
        d = measure.findtext('attributes/divisions')
        if d is not None: division = int(d)
        if not division or division < 1: raise ValueError('Missing/invalid divisions')
        cursor = Fraction(0)
        for index, node in enumerate(measure.findall('note'), 1):
            if node.find('chord') is not None or node.find('grace') is not None:
                raise ValueError('This teaching parser only supports single-note events')
            raw = node.findtext('duration')
            if raw is None or int(raw) <= 0: raise ValueError('Missing/invalid duration')
            duration = Fraction(int(raw), division)
            p = node.find('pitch')
            if p is None:
                if node.find('rest') is None: raise ValueError('Unpitched note unsupported')
                pitch = None
            else:
                # Preserve spelling; ties should join the same spelled pitch here.
                alter = int(p.findtext('alter','0'))
                if alter not in (-2,-1,0,1,2): raise ValueError('Microtones unsupported')
                pitch = p.findtext('step') + {-2:'bb',-1:'b',0:'',1:'#',2:'##'}[alter] + p.findtext('octave')
            ties = {t.get('type') for t in node.findall('tie')}
            visible = {t.get('type') for t in node.findall('./notations/tied')}
            if ties != visible: raise ValueError('Sound/notation tie mismatch: '+number)
            event = Event(number,index,absolute+cursor,duration,pitch,'start' in ties,'stop' in ties)
            events.append(event)
            for slur in node.findall('./notations/slur'):
                key=slur.get('number','1');kind=slur.get('type')
                if kind=='start':
                    if key in opened: raise ValueError('Nested same-number slur')
                    opened[key]=len(events)-1
                elif kind=='stop':
                    if key not in opened: raise ValueError('Unmatched slur stop')
                    first=opened.pop(key)
                    original_slurs.append((first,len(events)-1))
                elif kind!='continue': raise ValueError('Unsupported slur type')
            cursor += duration
        if measure.find('backup') is not None or measure.find('forward') is not None:
            raise ValueError('Polyphonic timeline unsupported by this teaching parser')
        absolute += cursor
    if opened: raise ValueError('Unclosed slur')
    return events, original_slurs


def merge_ties(events):
    """A tie continuation contributes duration, not a new musical attack.
    This does NOT imply the player must sustain the entire chain in one bow.
    """
    result=[];active=None
    for e in events:
        where=f'm{e.measure}:note{e.index}'
        if e.tie_stop:
            if active is None or e.pitch!=active.pitch or e.onset!=active.onset+active.beats:
                raise ValueError('Broken or noncontiguous tie at '+where)
            active.beats += e.beats;active.locations.append(where)
        else:
            if active is not None: raise ValueError('Tie start without continuation')
            result.append(Attack(e.onset,e.beats,e.pitch,[where]))
        active=result[-1] if e.tie_start else None
    if active is not None: raise ValueError('Unclosed tie chain')
    return result


def candidate_groups(attacks,policy):
    """Greedy pedagogical grouping: keep ties; separate repeated attacks;
    keep moving-note groups inside a bar and a user-defined beat window.
    A real optimizer should compare alternatives over whole phrases.
    """
    groups=[];current=[]
    limit=Fraction(str(policy.max_group_beats))
    for a in attacks:
        if a.pitch is None:
            if current:groups.append(current);current=[]
            continue
        if current:
            last=current[-1]
            same_bar=current[0].locations[0].split(':')[0]==a.locations[0].split(':')[0]
            contiguous=last.onset+last.beats==a.onset
            repeated=policy.split_repeated_attacks and last.pitch==a.pitch
            total=sum((x.beats for x in current),Fraction(0))+a.beats
            if not same_bar or not contiguous or repeated or total>limit:
                groups.append(current);current=[]
        current.append(a)
    if current:groups.append(current)
    return groups


def report_part(part,tempo,policy):
    events,slurs=parse_part(part)
    attacks=merge_ties(events)
    groups=candidate_groups(attacks,policy)
    audits=[]
    for first,last in slurs:
        inside=events[first:last+1]
        seconds=float(sum((x.beats for x in inside),Fraction(0)))*60/tempo
        repeated=[f'm{b.measure}:note{b.index}' for a,b in zip(inside,inside[1:]) if a.pitch==b.pitch and a.pitch is not None and not b.tie_stop]
        audits.append({'from':f'm{inside[0].measure}:note{inside[0].index}',
                       'to':f'm{inside[-1].measure}:note{inside[-1].index}',
                       'seconds':round(seconds,3),
                       'review_duration':seconds>policy.review_seconds,
                       'repeated_attacks_under_slur':repeated})
    suggested=[];direction=policy.start_direction
    for group in groups:
        beats=sum((a.beats for a in group),Fraction(0));seconds=float(beats)*60/tempo
        issues=[]
        if seconds>policy.review_seconds:
            issues.append('Review bow distribution; threshold is editorial, not a physical limit.')
        if any(len(a.locations)>1 for a in group):
            issues.append('Tie chain kept as one attack; internal unobtrusive bow changes remain a player decision.')
        suggested.append({'notes':[a.pitch for a in group],
                          'locations':[loc for a in group for loc in a.locations],
                          'beats':float(beats),'seconds':round(seconds,3),
                          'candidate_direction':direction,
                          'candidate_slur':len(group)>1,'review':issues})
        # Alternate by group, not by printed note or bar. This does not model
        # actual remaining bow, retakes, hooked strokes or reset opportunities.
        direction='up' if direction=='down' else 'down'
    return {'part_id':part.get('id'),'original_slur_audit':audits,
            'candidate_groups':suggested,
            'limitations':['No physical bow model or fingering/string assignment.',
                           'Dynamics, tempo changes and fermata duration are not modeled.',
                           'Direction alternation is an illustrative baseline, not a final prescription.']}


def export_demo(path):
    """Two bars: one tied D, then E-F# in one up-bow; G-A in one down-bow.
    This example explicitly separates sound ties from visual ties and slurs.
    """
    r=ET.Element('score-partwise',version='4.0')
    w=ET.SubElement(r,'work');ET.SubElement(w,'work-title').text='Bowing laboratory — notation example'
    pl=ET.SubElement(r,'part-list');sp=ET.SubElement(pl,'score-part',id='V1');ET.SubElement(sp,'part-name').text='Violin'
    part=ET.SubElement(r,'part',id='V1')
    for bar in (1,2):
        m=ET.SubElement(part,'measure',number=str(bar))
        if bar==1:
            a=ET.SubElement(m,'attributes');ET.SubElement(a,'divisions').text='1'
            k=ET.SubElement(a,'key');ET.SubElement(k,'fifths').text='2'
            t=ET.SubElement(a,'time');ET.SubElement(t,'beats').text='4';ET.SubElement(t,'beat-type').text='4'
            c=ET.SubElement(a,'clef');ET.SubElement(c,'sign').text='G';ET.SubElement(c,'line').text='2'
        sequence=[('D',None,True,False),('D',None,False,True)] if bar==1 else [('E',None,False,False),('F',1,False,False),('G',None,False,False),('A',None,False,False)]
        for idx,(step,alter,start,stop) in enumerate(sequence):
            n=ET.SubElement(m,'note');p=ET.SubElement(n,'pitch');ET.SubElement(p,'step').text=step
            if alter is not None:ET.SubElement(p,'alter').text=str(alter)
            ET.SubElement(p,'octave').text='5';ET.SubElement(n,'duration').text='2' if bar==1 else '1'
            if start or stop:ET.SubElement(n,'tie',type='start' if start else 'stop')
            ET.SubElement(n,'type').text='half' if bar==1 else 'quarter'
            no=ET.SubElement(n,'notations')
            if start or stop:ET.SubElement(no,'tied',type='start' if start else 'stop')
            if bar==2:ET.SubElement(no,'slur',type='start' if idx%2==0 else 'stop',number='1')
            if (bar==1 and idx==0) or (bar==2 and idx in (0,2)):
                te=ET.SubElement(no,'technical');ET.SubElement(te,'up-bow' if bar==2 and idx==0 else 'down-bow')
    ET.indent(r);ET.ElementTree(r).write(path,encoding='utf-8',xml_declaration=True)


def self_test():
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        p=Path(directory)/'demo.musicxml';export_demo(p)
        part=ET.parse(p).getroot().find('part');events,_=parse_part(part)
        attacks=merge_ties(events)
        assert len(events)==6 and len(attacks)==5
        assert attacks[0].beats==4 and attacks[0].locations==['m1:note1','m1:note2']
        groups=candidate_groups(attacks,Policy())
        assert [[a.pitch for a in g] for g in groups]==[['D5'],['E5','F#5'],['G5','A5']]
        a=report_part(part,60,Policy());b=report_part(part,120,Policy())
        assert a['candidate_groups'][0]['seconds']==2*b['candidate_groups'][0]['seconds']
        assert [g['candidate_direction'] for g in a['candidate_groups']]==['down','up','down']
        repeated=[Attack(Fraction(0),Fraction(1),'D5',['m1:note1']),Attack(Fraction(1),Fraction(1),'D5',['m1:note2'])]
        assert len(candidate_groups(repeated,Policy()))==2
        invalid=[Event('1',1,Fraction(0),Fraction(1),'D5',True,False),Event('1',2,Fraction(1),Fraction(1),'E5',False,True)]
        try:merge_ties(invalid)
        except ValueError:pass
        else:raise AssertionError('Must reject mismatched-pitch tie')
    print('Passed: tie merge, malformed tie rejection, slur grouping, repeated attacks, tempo scaling, bow alternation.')

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input',type=Path);ap.add_argument('--output',type=Path,default=Path('bowing-report.json'))
    ap.add_argument('--tempo',type=float,default=76);ap.add_argument('--group-beats',type=float,default=2)
    ap.add_argument('--review-seconds',type=float,default=2.5)
    ap.add_argument('--demo',type=Path);ap.add_argument('--self-test',action='store_true')
    args=ap.parse_args()
    if args.tempo<=0 or args.group_beats<=0 or args.review_seconds<=0:ap.error('Positive parameters required')
    if args.self_test:self_test()
    if args.demo:export_demo(args.demo)
    if args.input:
        root=ET.parse(args.input).getroot()
        if root.tag!='score-partwise':raise ValueError('Requires unnamespaced score-partwise MusicXML')
        policy=Policy(args.group_beats,args.review_seconds)
        data={'input':args.input.name,'tempo_assumption':args.tempo,'policy':asdict(policy),
              'status':'EDUCATIONAL CANDIDATES — PLAYER REVIEW REQUIRED',
              'parts':[report_part(p,args.tempo,policy) for p in root.findall('part')]}
        args.output.write_text(json.dumps(data,indent=2)+'\n')
        print('Wrote',args.output)
