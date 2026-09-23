"""Living Hope piano reduction for Flute, Oboe, Bb Clarinet and Bassoon.
Standard-library Python 3. This is an editorial transcription of the supplied
piano texture, not a vocal-melody reconstruction or a note-for-note facsimile.
Every retained wind segment is traced to one source piano note.
"""
from pathlib import Path
import collections, copy, hashlib, itertools, json
import xml.etree.ElementTree as E

OUT=Path(__file__).resolve().parent
STEP={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
PARTS={'FL':('Flute','Fl.','G',2,74,60,88),
       'OB':('Oboe','Ob.','G',2,69,58,81),
       'CL':('Clarinet in Bb','Cl. in Bb','G',2,72,50,79),
       'BN':('Bassoon','Bsn.','F',4,71,34,65)}
SECTIONS={1:'Intro',5:'1 - Verse',13:'2 - Verse continuation',24:'3 - Chorus',
          35:'4 - Later verse',49:'5 - Final chorus'}

def el(p,tag,text=None,**attrs):
    n=E.SubElement(p,tag,{k:str(v) for k,v in attrs.items()})
    if text is not None:n.text=str(text)
    return n

def canonical(x):
    return x.tag,tuple(sorted(x.attrib.items())),(x.text or '').strip(),tuple(canonical(c) for c in x)

def clean(x):
    x=copy.deepcopy(x)
    for n in x.iter():
        for a in ('default-x','default-y','relative-x','relative-y','end-length','font-family'):
            n.attrib.pop(a,None)
    return x

def read_source():
    root=E.parse(OUT/'original-piano.musicxml').getroot();notes=[];directions=collections.defaultdict(list)
    active={}
    for b,m in enumerate(root.findall('./part/measure'),1):
        at=0;previous=0;end=0
        for x in m:
            if x.tag=='attributes':
                if x.find('divisions') is not None:assert x.findtext('divisions')=='8'
                if x.find('time') is not None:assert x.findtext('time/beats')=='4' and x.findtext('time/beat-type')=='4'
            elif x.tag=='backup':at-=int(x.findtext('duration'))
            elif x.tag=='forward':at+=int(x.findtext('duration'))
            elif x.tag=='direction':directions[b].append((at+int(x.findtext('offset','0')),clean(x)))
            elif x.tag=='note':
                dur=int(x.findtext('duration','0'));on=previous if x.find('chord') is not None else at
                if x.find('chord') is None:previous=at;at+=dur
                end=max(end,on+dur)
                if x.find('pitch') is None:continue
                p=x.find('pitch');midi=(int(p.findtext('octave'))+1)*12+STEP[p.findtext('step')]+int(p.findtext('alter','0'))
                sid=f'm{b}-n{len(notes)+1}';staff=int(x.findtext('staff','1'));voice=x.findtext('voice','1')
                ties={t.get('type') for t in x.findall('tie')};key=(staff,voice,midi)
                chain=active.pop(key) if 'stop' in ties else sid
                if 'start' in ties:active[key]=chain
                notes.append(dict(id=sid,bar=b,on=on,dur=dur,midi=midi,staff=staff,voice=voice,
                    chain=chain,xml=copy.deepcopy(x)))
        assert end==32,(b,end)
    assert not active
    return root,notes,directions

def octave(pc,target,lo,hi):
    return min((p for p in range(lo,hi+1) if p%12==pc),key=lambda p:(abs(p-target),p))

def reduce(notes):
    """Read all source change-points; select the upper RH line, principal
    LH voice 3, and up to two distinct inner RH pitch classes. Repeated attacks
    retain separate chain identities; tied continuations share one identity.
    Merge adjacent cells only when the same source chain remains selected.
    """
    cells=[];choices={};previous={'OB':67,'CL':58}
    for b in range(1,63):
        mine=[n for n in notes if n['bar']==b]
        bounds=sorted({0,32}|{n['on'] for n in mine}|{n['on']+n['dur'] for n in mine})
        for a,z in zip(bounds,bounds[1:]):
            active=[n for n in mine if n['on']<=a<n['on']+n['dur']]
            rh=sorted((n for n in active if n['staff']==1),key=lambda n:(-n['midi'],n['voice']))
            lh=[n for n in active if n['staff']==2 and n['voice']=='3']
            selected={}
            if rh:
                top=rh[0];selected['FL']=(top,top['midi']+12)
                # Exclude melody octave doublings; use existing piano tones only.
                inner=[];pcs={top['midi']%12}
                for n in rh[1:]:
                    if n['midi']%12 not in pcs:inner.append(n);pcs.add(n['midi']%12)
                # RH single notes/octaves leave inner winds resting, not invented chords.
                for pid,n in zip(('OB','CL'),inner[:2]):
                    key=(pid,n['chain'])
                    if key not in choices:
                        lo,hi=PARTS[pid][-2:]
                        ceiling=selected['FL'][1]-1 if pid=='OB' else selected['OB'][1]-1
                        target=previous[pid]
                        choices[key]=octave(n['midi']%12,target,lo,min(hi,ceiling))
                    pitch=choices[key];selected[pid]=(n,pitch);previous[pid]=pitch
            if lh:
                bass=min(lh,key=lambda n:n['midi']);pitch=bass['midi']
                while pitch<34:pitch+=12
                while pitch>65:pitch-=12
                selected['BN']=(bass,pitch)
            for pid,(n,pitch) in selected.items():
                cells.append(dict(part=pid,bar=b,on=a,dur=z-a,midi=pitch,source=n['id'],
                                  chain=n['chain'],source_midi=n['midi'],role={'FL':'upper piano line + octave','OB':'upper inner piano tone',
                                  'CL':'lower inner piano tone','BN':'principal piano bass'}[pid]))
    merged=[]
    for pid in PARTS:
        for e in sorted((e for e in cells if e['part']==pid),key=lambda e:(e['bar'],e['on'])):
            if merged and all(merged[-1][k]==e[k] for k in ('part','bar','chain','midi')) and merged[-1]['on']+merged[-1]['dur']==e['on']:
                merged[-1]['dur']+=e['dur'];merged[-1]['sources'].append(e['source'])
            else:
                e=dict(e);e['sources']=[e.pop('source')];merged.append(e)
    # Stagger written eighth-rest breaths. If a source note is too short, use
    # a breath comma only: no melody attack is deleted to manufacture a rest.
    for pid in PARTS:
        seq=[e for e in merged if e['part']==pid]
        offset={'FL':0,'OB':1,'CL':2,'BN':3}[pid]
        for i,e in enumerate(seq):
            b=e['bar'];e.update(breath=False,trim=0)
            if b==62:continue
            next_e=seq[i+1] if i+1<len(seq) else None
            continuing=next_e and next_e['chain']==e['chain'] and next_e['midi']==e['midi'] and (next_e['bar']-1)*32+next_e['on']==(b-1)*32+e['on']+e['dur']
            last=e['on']+e['dur']==32
            selected_bar=(b%2==0 if pid=='FL' else b%4==offset)
            if last and selected_bar and not continuing:
                e['breath']=True
                if e['dur']>=8:e['dur']-=4;e['trim']=4
    # Remove provenance entries that lie wholly inside a newly inserted breath.
    byid={n['id']:n for n in notes}
    for e in merged:
        e['sources']=sorted(set(sid for sid in e['sources'] if byid[sid]['on']<e['on']+e['dur'] and byid[sid]['on']+byid[sid]['dur']>e['on']))
    # Ties are derived from retained source chain identity after breath editing.
    for pid in PARTS:
        seq=[e for e in merged if e['part']==pid]
        for i,e in enumerate(seq):
            e['tie_start']=e['tie_stop']=False
            if i:
                p=seq[i-1]
                if p['chain']==e['chain'] and p['midi']==e['midi'] and (p['bar']-1)*32+p['on']+p['dur']==(e['bar']-1)*32+e['on']:
                    p['tie_start']=True;e['tie_stop']=True
    # Slur short, contiguous figures inside a beat; do not slur through a
    # written breath or confuse a tied continuation with a fresh attack.
    for e in merged:e['slur']=None
    for pid in PARTS:
        for b in range(1,63):
            for beat in (0,8,16,24):
                group=[e for e in merged if e['part']==pid and e['bar']==b and beat<=e['on'] and e['on']+e['dur']<=beat+8]
                if len(group)>=2 and all(e['dur']<=4 and not e['breath'] and not e['tie_start'] and not e['tie_stop'] for e in group):
                    if all(a['on']+a['dur']==c['on'] and abs(a['midi']-c['midi'])<=7 for a,c in zip(group,group[1:])):
                        group[0]['slur']='start';group[-1]['slur']='stop'
    return merged

def direction(m,text=None,dynamic=None,rehearsal=None):
    d=el(m,'direction',placement='above' if text or rehearsal else 'below');dt=el(d,'direction-type')
    if text:el(dt,'words',text)
    if dynamic:el(el(dt,'dynamics'),dynamic)
    if rehearsal:el(dt,'rehearsal',rehearsal)
    return d

def transfer(m,on,source):
    """Copy source dynamic shapes and tempo; omit piano-only pedal and cues."""
    d=clean(source)
    for tag in ('staff','offset'):
        for x in d.findall(tag):d.remove(x)
    for dt in list(d.findall('direction-type')):
        for x in list(dt):
            if x.tag not in ('dynamics','wedge','metronome'):dt.remove(x)
        if not len(dt):d.remove(dt)
    if not d.findall('direction-type'):return
    for dt in d.findall('direction-type'):
        dyn=dt.find('dynamics')
        if dyn is not None and len(dyn)>1:
            # The source's composite mp + '-' + mf imports as three colliding
            # dynamic objects in some engravers. One text object preserves it.
            label=' '.join((x.text or '') if x.tag=='other-dynamics' else x.tag for x in dyn)
            dt.remove(dyn);el(dt,'words',label,**{'font-style':'italic'})
    if on:
        off=E.Element('offset');off.text=str(on)
        last=d.findall('direction-type')[-1];d.insert(list(d).index(last)+1,off)
    m.append(d)

def spelling(sounding,pid,source=None):
    # Preserve diatonic spelling while transposing Bb clarinet up a major second.
    if source is not None:
        p=source.find('pitch');letter=p.findtext('step');idx='CDEFGAB'.index(letter)
        source_midi=(int(p.findtext('octave'))+1)*12+STEP[letter]+int(p.findtext('alter','0'))
        octv=int(p.findtext('octave'))+(sounding-source_midi)//12
        if pid=='CL':
            idx+=1;octv+=idx//7;letter='CDEFGAB'[idx%7]
        written=sounding+(2 if pid=='CL' else 0)
        alt=written-((octv+1)*12+STEP[letter])
        assert -2<=alt<=2
        return letter,alt,octv
    raise AssertionError('Every pitched output requires a source spelling')

VALUES={32:('whole',False),24:('half',True),16:('half',False),12:('quarter',True),
        8:('quarter',False),6:('eighth',True),4:('eighth',False),3:('16th',True),2:('16th',False),1:('32nd',False)}

def chunks(on,dur):
    """Split uncommon/misgrouped lengths into conventional tied values."""
    if dur in VALUES and not (on%8 and dur>8):return [dur]
    result=[]
    while dur:
        limit=8-on%8 if on%8 else dur
        d=max(x for x in VALUES if x<=min(dur,limit))
        result.append(d);on+=d;dur-=d
    return result

def write_event(m,e,pid,source):
    lengths=chunks(e['on'],e['dur'])
    for j,dur in enumerate(lengths):
        n=el(m,'note');pitch=el(n,'pitch');step,alt,octv=spelling(e['midi'],pid,source)
        el(pitch,'step',step)
        if alt:el(pitch,'alter',alt)
        el(pitch,'octave',octv);el(n,'duration',dur)
        stops=e['tie_stop'] or j>0;starts=e['tie_start'] or j<len(lengths)-1
        if stops:el(n,'tie',type='stop')
        if starts:el(n,'tie',type='start')
        typ,dot=VALUES[dur];el(n,'type',typ)
        if dot:el(n,'dot')
        no=el(n,'notations')
        if stops:el(no,'tied',type='stop')
        if starts:el(no,'tied',type='start')
        if e['slur']=='start' and j==0:el(no,'slur',type='start',number=1)
        if e['slur']=='stop' and j==len(lengths)-1:el(no,'slur',type='stop',number=1)
        if e['breath'] and j==len(lengths)-1:el(el(no,'articulations'),'breath-mark')
        if e['bar']==62:el(no,'fermata')
        if not len(no):n.remove(no)

def rest(m,on,dur):
    for length in chunks(on,dur) if dur else []:
        n=el(m,'note');el(n,'rest',**({'measure':'yes'} if length==32 else {}));el(n,'duration',length)
        typ,dot=VALUES[length];el(n,'type',typ)
        if dot:el(n,'dot')
        on+=length

def beam_measure(m):
    """Explicit metrical beams for fast notes, since importer defaults vary."""
    at=0;groups=[];group=[]
    for n in m.findall('note'):
        dur=int(n.findtext('duration'))
        eligible=n.find('pitch') is not None and n.findtext('type') in ('eighth','16th','32nd')
        if not eligible or (group and group[-1][1]//8!=at//8):
            if group:groups.append(group);group=[]
        if eligible:group.append((n,at))
        at+=dur
    if group:groups.append(group)
    for group in groups:
        if len(group)<2:continue
        for j,(n,_) in enumerate(group):
            levels={'eighth':1,'16th':2,'32nd':3}[n.findtext('type')]
            for level in range(1,levels+1):
                left=j>0 and {'eighth':1,'16th':2,'32nd':3}[group[j-1][0].findtext('type')]>=level
                right=j+1<len(group) and {'eighth':1,'16th':2,'32nd':3}[group[j+1][0].findtext('type')]>=level
                value='continue' if left and right else 'end' if left else 'begin' if right else 'forward hook' if j==0 else 'backward hook'
                beam=E.Element('beam',number=str(level));beam.text=value
                no=n.find('notations');n.insert(list(n).index(no) if no is not None else len(n),beam)

def build(root,notes,events,directions,selected,full):
    s=E.Element('score-partwise',version='4.0');el(el(s,'work'),'work-title','Living Hope')
    ident=copy.deepcopy(root.find('identification'));s.append(ident)
    cr=E.Element('creator',type='arranger');cr.text='Wind quartet: editorial piano transcription';ident.insert(len(ident.findall('creator')),cr)
    defaults=el(s,'defaults');sc=el(defaults,'scaling');el(sc,'millimeters',6.5 if full else 7);el(sc,'tenths',40)
    w,h=(1293,1828) if full else (1200,1697)
    pg=el(defaults,'page-layout');el(pg,'page-height',h);el(pg,'page-width',w)
    ma=el(pg,'page-margins',type='both')
    for tag in ('left-margin','right-margin','top-margin','bottom-margin'):el(ma,tag,70)
    for kind,text,size,y in [('title','Living Hope',24,h-65),('subtitle','Wind Quartet | Piano source: Dan Galbraith',11,h-115),('composer','Brian Johnson and Phil Wickham',10,h-155)]:
        c=el(s,'credit',page=1);el(c,'credit-type',kind);el(c,'credit-words',text,**{'font-size':size,'default-x':w/2,'default-y':y,'justify':'center','valign':'top'})
    pl=el(s,'part-list')
    if full:
        g=el(pl,'part-group',number=1,type='start');el(g,'group-symbol','bracket');el(g,'group-barline','yes')
    for idx,pid in enumerate(selected,1):
        nm,abbr,clef,line,program,*_=PARTS[pid]
        sp=el(pl,'score-part',id=pid);el(sp,'part-name',nm);el(sp,'part-abbreviation',abbr)
        ins=el(sp,'score-instrument',id=pid+'I');el(ins,'instrument-name',nm)
        mi=el(sp,'midi-instrument',id=pid+'I');el(mi,'midi-channel',idx);el(mi,'midi-program',program)
    if full:el(pl,'part-group',number=1,type='stop')
    byid={n['id']:n for n in notes}
    for pid in selected:
        part=el(s,'part',id=pid)
        for b,src in enumerate(root.findall('./part/measure'),1):
            m=el(part,'measure',number=src.get('number'))
            if full and b%4==1:el(m,'print',**({'new-system':'yes'} if b>1 else {}))
            if not full and b==35:el(m,'print',**{'new-page':'yes'})
            if b==1:
                a=el(m,'attributes');el(a,'divisions',8);el(el(a,'key'),'fifths',-1 if pid=='CL' else -3)
                tm=el(a,'time');el(tm,'beats',4);el(tm,'beat-type',4)
                c=el(a,'clef');el(c,'sign',PARTS[pid][2]);el(c,'line',PARTS[pid][3])
                if pid=='CL':tr=el(a,'transpose');el(tr,'diatonic',-1);el(tr,'chromatic',-2)
                direction(m,text='Dolce, cantabile; stagger breaths.' if pid!='BN' else 'Warm, light articulation; support the upper voices.')
            if b in SECTIONS and (pid=='FL' or not full):direction(m,rehearsal=SECTIONS[b])
            for on,d in directions[b]:transfer(m,on,d)
            for bl in src.findall("barline[@location='left']"):m.append(clean(bl))
            at=0
            for e in (e for e in events if e['part']==pid and e['bar']==b):
                assert e['on']>=at
                rest(m,at,e['on']-at);write_event(m,e,pid,byid[e['sources'][0]]['xml']);at=e['on']+e['dur']
            rest(m,at,32-at)
            beam_measure(m)
            for bl in src.findall('barline'):
                if bl.get('location')!='left':m.append(clean(bl))
    E.indent(s);return s

def decode(score):
    result=[]
    for part in score.findall('part'):
        pid=part.get('id')
        for b,m in enumerate(part.findall('measure'),1):
            at=0
            for n in m.findall('note'):
                dur=int(n.findtext('duration'));p=n.find('pitch')
                if p is not None:
                    midi=(int(p.findtext('octave'))+1)*12+STEP[p.findtext('step')]+int(p.findtext('alter','0'))-(2 if pid=='CL' else 0)
                    result.extend((pid,b,t,midi) for t in range(at,at+dur))
                at+=dur
            assert at==32,(pid,b,at)
    return collections.Counter(result)

def validate(root,notes,events,score):
    expected=collections.Counter((e['part'],e['bar'],t,e['midi']) for e in events for t in range(e['on'],e['on']+e['dur']))
    assert decode(score)==expected,'Exported sounding pitches/timing differ'
    byid={n['id']:n for n in notes};used=set()
    for e in events:
        assert PARTS[e['part']][-2]<=e['midi']<=PARTS[e['part']][-1]
        assert e['midi']%12==e['source_midi']%12
        used.update(e['sources'])
        for sid in e['sources']:assert byid[sid]['midi']%12==e['midi']%12
        if e['part']=='BN':assert all(byid[sid]['voice']=='3' for sid in e['sources'])
    for part in score.findall('part'):
        assert len(part.findall('measure'))==62
        for orig,m in zip(root.findall('./part/measure'),part.findall('measure')):
            assert [canonical(clean(x)) for x in orig.findall('barline')]==[canonical(x) for x in m.findall('barline')]
    omitted=[]
    for n in notes:
        if n['id'] not in used:omitted.append({'source':n['id'],'bar':n['bar'],'midi':n['midi'],
            'reason':'alternate LH voice 4 omitted' if n['staff']==2 and n['voice']=='4' else 'octave doubling or unselected interior voice'})
    return {'measures':62,'source_pitched_segments':len(notes),'retained_source_segments':len(used),
        'unselected_source_segments':len(omitted),'wind_events_before_notational_splitting':len(events),
        'octave_shifted_wind_events':sum(e['midi']!=e['source_midi'] for e in events),
        'written_breath_rests':sum(e['trim']>0 for e in events),'breath_marks':sum(e['breath'] for e in events),
        'new_pitch_classes':0,'clarinet_written_major_second_above_sounding':True,
        'source_sha256':hashlib.sha256((OUT/'original-piano.musicxml').read_bytes()).hexdigest()},omitted

def main():
    root,notes,directions=read_source();events=reduce(notes)
    score=build(root,notes,events,directions,list(PARTS),True);report,omitted=validate(root,notes,events,score)
    jobs=[]
    for name,tree in [('living-hope-wind-quartet',score)]+[(f'living-hope-{pid}',build(root,notes,events,directions,[pid],False)) for pid in PARTS]:
        f=OUT/(name+'.musicxml');E.ElementTree(tree).write(f,encoding='utf-8',xml_declaration=True)
        jobs.append({'in':str(f),'out':str(f.with_suffix('.pdf'))})
    for name,data in [('note-map',events),('omissions',omitted),('validation',report),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
