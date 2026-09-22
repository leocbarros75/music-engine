"""Piano + independently composed strings for the supplied Last Train to London.

Python 3, standard library only. Run this script in any folder. The original
piano music is copied, not reconstructed. String textures and harmonic edits
are explicit editorial rules for this piece, not a general-purpose arranger.
All times are integer MusicXML divisions: 60 = quarter note, 240 = bar.
"""
from pathlib import Path
import collections, copy, hashlib, itertools, json, zipfile
import xml.etree.ElementTree as E

OUT = Path(__file__).resolve().parent
PARTS = {
    'V1': ('Violin I', 'Vln. I', 'G', 2, 41, 67, 86),
    'V2': ('Violin II', 'Vln. II', 'G', 2, 41, 60, 79),
    'VA': ('Viola', 'Vla.', 'C', 3, 42, 48, 69),
    'VC': ('Violoncello', 'Vc.', 'F', 4, 43, 36, 59),
    'CB': ('Double Bass', 'Cb.', 'F', 4, 44, 28, 47),
}
CHORDS = {'Em7': (4,7,11,2), 'Bm7': (11,2,6,9), 'Am7': (9,0,4,7),
          'Cmaj7': (0,4,7,11), 'D': (2,6,9), 'Em': (4,7,11),
          'Gmaj9': (7,11,2,6,9)}
FORM = [
 (1,'A','Opening','pp'), (5,'B','Piano groove','p'),
 (9,'C','Light offbeats','mp'), (23,'D','Lift','mf'),
 (25,'E','Broad refrain','mf'), (33,'F','Air and space','p'),
 (39,'G','Groove - developing','mp'), (55,'H','Lift','mf'),
 (57,'I','Refrain - fuller','f'), (65,'J','Air and space','p'),
 (71,'K','Piano solo - strings underneath','p'), (87,'L','Lift','mf'),
 (89,'M','Refrain - full','f'), (97,'N','Echoes','mp'),
 (103,'O','Piano break','p'), (104,'P','Final echoes','mp'),
 (110,'Q','Piano break','p'), (111,'R','Coda - broad','mf'),
 (123,'S','Piano tag','p')]

def el(parent, tag, text=None, **attrs):
    x=E.SubElement(parent,tag,{k:str(v) for k,v in attrs.items()})
    if text is not None:x.text=str(text)
    return x

def unpack():
    with zipfile.ZipFile(OUT/'original-piano.mxl') as z:
        container=E.fromstring(z.read('META-INF/container.xml'))
        name=next(x.get('full-path') for x in container.iter() if x.tag.endswith('rootfile'))
        data=z.read(name)
    (OUT/'source.musicxml').write_bytes(data)
    return E.fromstring(data)

def piano_events(root):
    result=[]
    for b,m in enumerate(root.findall('./part/measure'),1):
        t=0;previous=0
        for x in m:
            if x.tag=='backup':t-=int(x.findtext('duration'))
            elif x.tag=='forward':t+=int(x.findtext('duration'))
            elif x.tag=='note':
                d=int(x.findtext('duration'));on=previous if x.find('chord') is not None else t
                if x.find('chord') is None:previous=t;t+=d
                p=x.find('pitch')
                if p is not None:
                    midi=12*(int(p.findtext('octave'))+1)+{'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[p.findtext('step')]+int(p.findtext('alter','0'))
                    result.append(dict(bar=b,on=on,dur=d,midi=midi,staff=int(x.findtext('staff','1'))))
    return result

def section(b):
    return next(x for x in reversed(FORM) if x[0]<=b)

def harmony(b, notes):
    """Piece-specific chord plan. Bass riff identifies groove roots; composed
    transitions use verified explicit overrides, not pitch-frequency guesses.
    Chord symbols here are arranging choices rather than source annotations.
    """
    if b<=3:return [(0,240,'Bm7')]
    if b==4:return [(0,240,'Em7')]
    if b in (23,55,87):return [(0,240,'Cmaj7')]
    if b in (24,56,88):return [(0,240,'D')]
    if any(a<=b<=a+7 for a in (25,57,89)):
        return [(0,180,'D'),(180,60,'Em')] if b%2 else [(0,240,'Em')]
    if any(a<=b<=a+5 for a in (33,65,97,104)):
        start=next(a for a in (33,65,97,104) if a<=b<=a+5)
        return [(0,180,'Bm7'),(180,60,'Em')] if (b-start)%2==0 else [(0,240,'Em')]
    if 111<=b<=122:
        if b%2:return [(0,180,'Gmaj9' if b in (111,113,117,119) else 'Bm7'),(180,60,'Em')]
        return [(0,240,'Em')]
    bass=[n for n in notes if n['bar']==b and n['staff']==2 and n['on']==0]
    root=min((n['midi'] for n in bass),default=40)%12
    return [(0,240,{4:'Em7',11:'Bm7',9:'Am7'}.get(root,'Em7'))]

def voice_chord(name, previous):
    """Enumerate ordered VC/VA/V2/V1 voicings and minimize movement.
    Register limits and spacing are hard constraints. Smoothness, coverage,
    and closeness to a comfortable central tessitura are soft costs.
    """
    pcs=CHORDS[name];ids=['VC','VA','V2','V1'];centers=[50,57,67,76]
    options=[[p for p in range(PARTS[i][-2],PARTS[i][-1]+1) if p%12 in pcs] for i in ids]
    best=None
    for v in itertools.product(*options):
        if not (v[0]<v[1]<v[2]<v[3]):continue
        if any(v[i+1]-v[i]>12 for i in range(1,3)):continue
        if v[1]-v[0]>19:continue
        missing=len(set(pcs)-{p%12 for p in v})
        motion=sum(abs(a-b) for a,b in zip(v,previous or centers))
        leaps=sum(max(0,abs(a-b)-5)**2 for a,b in zip(v,previous or centers))
        cost=motion+2*leaps+14*missing+0.25*sum(abs(a-b) for a,b in zip(v,centers))
        key=(cost,v)
        if best is None or key<best:best=key
    return dict(zip(ids,best[1]))

def nearest(pc, target, low, high):
    return min((p for p in range(low,high+1) if p%12==pc),key=lambda p:(abs(p-target),p))

def compose(notes):
    events=[];plan=[];previous=None
    def add(pid,b,on,dur,p,role,art=None,slur=None):
        if dur>0:events.append(dict(part=pid,bar=b,on=on,dur=dur,midi=p,role=role,art=art,slur=slur))
    for b in range(1,124):
        label=section(b)[2]
        for on,dur,ch in harmony(b,notes):
            v=voice_chord(ch,previous);previous=[v[i] for i in ('VC','VA','V2','V1')]
            plan.append(dict(bar=b,on=on,dur=dur,chord=ch,texture=label,voicing=v))
            end=on+dur
            if b in (5,6,103,110,123):continue  # deliberate piano-only breathing spaces
            if b<=4:
                for pid in ('V2','VA'):add(pid,b,on,dur,v[pid],'opening harmonic veil')
                if b in (2,4):add('V1',b,120,120,v['V1'],'delayed upper entry')
                continue
            if b in (7,8):
                if b==8:
                    for t in (150,210):add('VA',b,t,30,v['VA'],'anticipatory offbeats','staccato')
                continue
            lift=b in (23,24,55,56,87,88)
            refrain=any(a<=b<=a+7 for a in (25,57,89))
            echo=any(a<=b<=a+5 for a in (33,65,97,104))
            coda=111<=b<=122
            solo=71<=b<=86
            if lift or refrain or coda:
                for pid in ('VA','V2','VC'):
                    # Coda low lines leave chromatic piano bass motion exposed.
                    length=min(dur,120) if coda and b%2==0 and pid=='VC' else dur
                    add(pid,b,on,length,v[pid],'broad harmonic support','tenuto')
                if dur==240:
                    # Composed arch: chord tone -> neighbouring chord tone -> return.
                    p=v['V1'];others=[n for n in range(p-4,p+5) if n%12 in CHORDS[ch] and n!=p and 67<=n<=86]
                    q=min(others,key=lambda n:abs(n-p)) if others else p
                    add('V1',b,on,120,p,'lyrical arch',slur='start')
                    add('V1',b,on+120,60,q,'chord-tone inflection')
                    add('V1',b,on+180,60,p,'arch resolution',slur='stop')
                else:add('V1',b,on,dur,v['V1'],'harmonic arrival','tenuto')
            elif echo:
                for pid in ('VA','VC'):add(pid,b,on,dur,v[pid],'low sustained contrast')
                if b%2==0 and dur==240:
                    # The piano sustains high E: an independent middle-register answer.
                    pcs=CHORDS[ch]
                    pitches=[nearest(pc,67,60,76) for pc in (pcs[1],pcs[2],pcs[0])]
                    for t,d,p,s in zip((120,150,180),(30,30,60),pitches,('start',None,'stop')):
                        add('V2',b,t,d,p,'middle-register answer',slur=s)
                continue  # no bass here: clear space below the high piano episode
            else:
                # Offbeats maintain the dance pulse; piano keeps its own bass riff.
                for t in (30,90,150,210):
                    add('VA',b,t,30,v['VA'],'offbeat pulse','staccato')
                add('V2',b,0,120,v['V2'],'quiet inner pedal')
                if not solo and b%2==0:
                    p=v['V1'];pc=CHORDS[ch][1]
                    q=nearest(pc,p,67,86)
                    if q==p:q=nearest(CHORDS[ch][2],p,67,86)
                    for t,d,n,s in ((120,60,p,'start'),(180,30,q,None),(210,30,p,'stop')):
                        add('V1',b,t,d,n,'short answering figure',slur=s)
                elif solo and b%4==1:
                    add('V1',b,0,120,v['V1'],'restrained upper cushion')
                if b%2:add('VC',b,0,120,v['VC'],'low half-note support')
            # Bass punctuates harmonic arrivals, never copies the busy piano riff.
            if on==0 and (lift or refrain or coda or b%2==1):
                source_bass=[n for n in notes if n['bar']==b and n['staff']==2 and n['on']==0]
                pc=min((n['midi'] for n in source_bass),default=CHORDS[ch][0])%12
                bass=nearest(pc,35,28,47)
                add('CB',b,0,60 if not (lift or refrain or coda) else 120,bass,'harmonic punctuation')
    return sorted(events,key=lambda n:(n['part'],n['bar'],n['on'])),plan

def clean_layout(part):
    """Remove engraving coordinates and normalize a split printed tempo.
    Source tempo 121 plus a separate '.4' word becomes one 121.4 metronome;
    the original sound tempo remains 121.4. No musical value changes.
    """
    part=copy.deepcopy(part)
    for m in part.findall('measure'):
        m.attrib.pop('width',None)
        for p in m.findall('print'):m.remove(p)
    for x in part.iter():
        for a in ('default-x','default-y','relative-x','relative-y'):x.attrib.pop(a,None)
    for d in part.findall('.//direction'):
        per=d.find('./direction-type/metronome/per-minute')
        if per is not None and per.text=='121' and d.find('sound') is not None and d.find('sound').get('tempo')=='121.4':
            for dt in list(d.findall('direction-type')):
                word=dt.find('words')
                if word is not None and (word.text or '').strip()=='.4':
                    d.remove(dt);per.text='121.4'
    return part

def canonical(node):
    return (node.tag,tuple(sorted(node.attrib.items())),(node.text or '').strip(),tuple(canonical(c) for c in node))

def direction(m,text=None,dynamic=None,rehearsal=None):
    d=el(m,'direction',placement='above' if text or rehearsal else 'below');dt=el(d,'direction-type')
    if text:el(dt,'words',text)
    if rehearsal:el(dt,'rehearsal',rehearsal)
    if dynamic:el(el(dt,'dynamics'),dynamic)
    return d

def note_xml(m,event,pid):
    n=el(m,'note');dur=event['dur'];p=event.get('midi')
    if p is None:el(n,'rest',**({'measure':'yes'} if dur==240 else {}))
    else:
        p+=12 if pid=='CB' else 0
        step,alter=[('C',0),('C',1),('D',0),('E',-1),('E',0),('F',0),('F',1),('G',0),('A',-1),('A',0),('B',-1),('B',0)][p%12]
        pitch=el(n,'pitch');el(pitch,'step',step)
        if alter:el(pitch,'alter',alter)
        el(pitch,'octave',p//12-1)
    el(n,'duration',dur);el(n,'type',{30:'eighth',60:'quarter',90:'quarter',120:'half',180:'half',240:'whole'}[dur])
    if dur in (90,180):el(n,'dot')
    if event.get('art') or event.get('slur'):
        no=el(n,'notations')
        if event.get('slur'):el(no,'slur',type=event['slur'],number=1)
        if event.get('art'):el(el(no,'articulations'),event['art'])

def rest(m,dur,pid):
    for d in (240,120,60,30):
        while dur>=d:note_xml(m,{'dur':d},pid);dur-=d
    assert dur==0

def build(root,events,selected,full):
    s=E.Element('score-partwise',version='4.0')
    el(el(s,'work'),'work-title','Last Train to London')
    ident=el(s,'identification');el(ident,'creator','Jeff Lynne',type='composer')
    el(ident,'creator','Piano: Zach V. | Additional strings: editorial arrangement',type='arranger')
    defaults=el(s,'defaults');scale=el(defaults,'scaling');el(scale,'millimeters',5.6 if full else 7);el(scale,'tenths',40)
    w,h=(1500,2121) if full else (1200,1697)
    page=el(defaults,'page-layout');el(page,'page-height',h);el(page,'page-width',w)
    margins=el(page,'page-margins',type='both')
    for t in ('left-margin','right-margin','top-margin','bottom-margin'):el(margins,t,70)
    for kind,txt,size,x,y in [('title','Last Train to London',22,w/2,h-70),('subtitle','Piano with Strings | Piano arrangement: Zach V.',11,w/2,h-120),('composer','Jeff Lynne',11,w-70,h-155)]:
        cr=el(s,'credit',page=1);el(cr,'credit-type',kind);el(cr,'credit-words',txt,**{'font-size':size,'default-x':x,'default-y':y,'justify':'right' if kind=='composer' else 'center','valign':'top'})
    pl=el(s,'part-list')
    if full:
        g=el(pl,'part-group',type='start',number=1);el(g,'group-symbol','bracket');el(g,'group-barline','yes')
    for i,pid in enumerate(selected,2):
        name,abbr,sign,line,program,*_=PARTS[pid]
        sp=el(pl,'score-part',id=pid);el(sp,'part-name',name);el(sp,'part-abbreviation',abbr)
        ins=el(sp,'score-instrument',id=pid+'I');el(ins,'instrument-name',name)
        mi=el(sp,'midi-instrument',id=pid+'I');el(mi,'midi-channel',i);el(mi,'midi-program',program)
    if full:
        el(pl,'part-group',type='stop',number=1)
        pl.append(copy.deepcopy(root.find('./part-list/score-part')))
    bars=root.findall('./part/measure')
    for pid in selected:
        part=el(s,'part',id=pid)
        for b,source in enumerate(bars,1):
            m=el(part,'measure',number=source.get('number',str(b)))
            if full and b%4==1:
                pr=el(m,'print',**({'new-system':'yes'} if b>1 else {}))
                if b>1:el(el(pr,'system-layout'),'system-distance',90)
            if not full and pid!='VA' and b==65:
                el(m,'print',**{'new-page':'yes'})
            if b==1:
                a=el(m,'attributes');el(a,'divisions',60);el(el(a,'key'),'fifths',1)
                time=el(a,'time');el(time,'beats',4);el(time,'beat-type',4)
                clef=el(a,'clef');el(clef,'sign',PARTS[pid][2]);el(clef,'line',PARTS[pid][3])
                if pid=='CB':
                    tr=el(a,'transpose');el(tr,'diatonic',0);el(tr,'chromatic',0);el(tr,'octave-change',-1)
                direction(m,text='Arco; one line per section. Piano remains prominent.' if pid!='CB' else 'Pizz. throughout; light and resonant.')
                if not full:
                    d=direction(m,text='Quarter note = 121.4');el(d,'sound',tempo='121.4')
            entry=next((f for f in FORM if f[0]==b),None)
            if entry:
                direction(m,rehearsal=entry[1])
                if full and pid=='V1':direction(m,text=entry[2])
                direction(m,dynamic=entry[3] if pid!='CB' else ('mp' if entry[3] in ('mf','f') else 'p'))
            for barline in source.findall("barline[@location='left']"):m.append(copy.deepcopy(barline))
            at=0
            for e in [e for e in events if e['part']==pid and e['bar']==b]:
                assert e['on']>=at
                rest(m,e['on']-at,pid);note_xml(m,e,pid);at=e['on']+e['dur']
            rest(m,240-at,pid)
            for barline in source.findall('barline'):
                if barline.get('location')!='left':m.append(copy.deepcopy(barline))
    if full:s.append(clean_layout(root.find('part')))
    E.indent(s);return s

def validate(source,score,events):
    piano=score.findall('part')[-1]
    assert canonical(clean_layout(source.find('part')))==canonical(clean_layout(piano)), 'Piano musical content changed'
    for part in score.findall('part')[:-1]:
        pid=part.get('id');assert len(part.findall('measure'))==123
        actual=[]
        for b,m in enumerate(part.findall('measure'),1):
            at=0
            for n in m.findall('note'):
                assert n.find('chord') is None
                d=int(n.findtext('duration'));p=n.find('pitch')
                if p is not None:
                    midi=12*(int(p.findtext('octave'))+1)+{'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[p.findtext('step')]+int(p.findtext('alter','0'))-(12 if pid=='CB' else 0)
                    assert PARTS[pid][-2]<=midi<=PARTS[pid][-1],(pid,b,midi)
                    actual.append((b,at,d,midi))
                at+=d
            assert at==240,(pid,b,at)
            src=source.findall('./part/measure')[b-1]
            assert [canonical(x) for x in src.findall('barline')]==[canonical(x) for x in m.findall('barline')]
        expected=[(n['bar'],n['on'],n['dur'],n['midi']) for n in events if n['part']==pid]
        assert actual==expected,(pid,'export differs from composition')
    return {'piano_musical_xml_preserved':True,'measures':123,'piano_pitched_segments':len(piano_events(source)),
            'new_string_notes':len(events),'string_notes_by_part':dict(collections.Counter(e['part'] for e in events)),
            'monophonic_string_parts':True,'measure_durations_and_repeats_valid':True,
            'original_mxl_sha256':hashlib.sha256((OUT/'original-piano.mxl').read_bytes()).hexdigest()}

def main():
    root=unpack();notes=piano_events(root);events,plan=compose(notes)
    score=build(root,events,list(PARTS),True)
    report=validate(root,score,events)
    jobs=[]
    for name,tree in [('last-train-piano-and-strings',score)]+[(f'last-train-{pid}',build(root,events,[pid],False)) for pid in PARTS]:
        file=OUT/(name+'.musicxml');E.ElementTree(tree).write(file,encoding='utf-8',xml_declaration=True)
        jobs.append({'in':str(file),'out':str(file.with_suffix('.pdf'))})
    for name,data in [('arrangement-events',events),('harmonic-plan',plan),('validation',report),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
