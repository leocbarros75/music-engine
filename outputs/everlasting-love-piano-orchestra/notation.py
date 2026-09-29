"""The Everlasting Love of God editorial piano transcription for eight brass players.
Standard-library Python 3. This is an editorial transcription of the supplied
piano texture, not a vocal-melody reconstruction or a note-for-note facsimile.
Every retained wind segment is traced to one source piano note.
"""
from pathlib import Path
import collections, copy, hashlib, itertools, json
import xml.etree.ElementTree as E

OUT=Path(__file__).resolve().parent
STEP={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
PARTS={
 'FL1':('Flute 1','Fl. 1','G',2,74,60,88), 'FL2':('Flute 2','Fl. 2','G',2,74,60,84),
 'OB':('Oboe','Ob.','G',2,69,58,81), 'CL':('Clarinet in Bb','Cl.','G',2,72,50,79),
 'BN':('Bassoon','Bsn.','F',4,71,34,67),
 'H1':('Horn 1 in F','Hn. 1','G',2,61,48,72), 'H2':('Horn 2 in F','Hn. 2','G',2,61,43,67),
 'T1':('Trumpet 1 in Bb','Tpt. 1','G',2,57,54,79), 'T2':('Trumpet 2 in Bb','Tpt. 2','G',2,57,54,75),
 'TB1':('Trombone 1','Tbn. 1','F',4,58,43,67), 'TB3':('Trombone 3','Tbn. 3','F',4,58,40,62),
 'BT':('Bass Trombone','B. Tbn.','F',4,58,34,58), 'TU':('Tuba','Tba.','F',4,59,28,55),
 'TI':('Timpani','Timp.','F',4,48,41,48),
 'V1':('Violin 1','Vln. 1','G',2,41,55,88), 'V2':('Violin 2','Vln. 2','G',2,41,55,81),
 'VA':('Viola','Vla.','C',3,42,48,74), 'VC':('Cello','Vc.','F',4,43,36,67),
 'CB':('Double Bass','D.B.','F',4,44,28,55)}
SHIFT={'CL':(1,2),'T1':(1,2),'T2':(1,2),'H1':(4,7),'H2':(4,7),'CB':(7,12)}
SECTIONS={1:'Introduction',4:'A - Verse 1',14:'B - Verse 2',22:'C - Chorus',
 31:'D - Verse 3',40:'E - Instrumental',46:'F - Verse 4',57:'G - Chorus',65:'H - Chorus',75:'Closing'}
WIND=set(PARTS)-{'TI','V1','V2','VA','VC','CB'}
BARS=[]

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
    active={};beats=4;beat_type=4;BARS.clear()
    for b,m in enumerate(root.findall('./part/measure'),1):
        at=previous=end=0
        for x in m:
            if x.tag=='attributes':
                if x.find('divisions') is not None:assert x.findtext('divisions')=='8'
                if x.find('time') is not None:beats=int(x.findtext('time/beats'));beat_type=int(x.findtext('time/beat-type'))
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
                notes.append(dict(id=sid,bar=b,on=on,dur=dur,midi=midi,staff=staff,voice=voice,chain=chain,xml=copy.deepcopy(x)))
        length=beats*32//beat_type;assert end==length,(b,end,length)
        BARS.append({'length':length,'beats':beats,'beat_type':beat_type,'start':sum(x['length'] for x in BARS)})
    assert not active
    return root,notes,directions

def octave(pc,target,lo,hi):
    return min((p for p in range(lo,hi+1) if p%12==pc),key=lambda p:(abs(p-target),p))

def reduce(notes):
    """Piece-specific orchestration; every pitch is sourced from an active piano note.
    Strings carry continuity, woodwinds exchange color, brass enters selectively.
    Timpani uses only F2/C3, and only when the principal bass supplies that class.
    """
    cells=[];previous={pid:(v[-2]+v[-1])//2 for pid,v in PARTS.items()}
    for b,meta in enumerate(BARS,1):
        mine=[n for n in notes if n['bar']==b];length=meta['length']
        bounds=sorted({0,length}|{n['on'] for n in mine}|{n['on']+n['dur'] for n in mine})
        big=22<=b<=30 or 40<=b<=45 or b>=57
        for start,stop in zip(bounds,bounds[1:]):
            active=[n for n in mine if n['on']<=start<n['on']+n['dur']]
            rh=sorted((n for n in active if n['staff']==1),key=lambda n:-n['midi'])
            lh=sorted((n for n in active if n['staff']==2 and n['voice']=='2'),key=lambda n:n['midi'])
            chosen={}
            def take(pid,n,role,target=None):
                lo,hi=PARTS[pid][-2:]
                pitch=octave(n['midi']%12,previous[pid] if target is None else target,lo,hi)
                chosen[pid]=(n,pitch,role);previous[pid]=pitch
            if rh:
                top=rh[0];inner=[];pcs={top['midi']%12}
                for n in rh[1:]:
                    if n['midi']%12 not in pcs:inner.append(n);pcs.add(n['midi']%12)
                take('V1',top,'principal upper piano line',top['midi'])
                if inner:take('V2',inner[0],'upper inner piano voice',inner[0]['midi'])
                if len(inner)>1:take('VA',inner[1],'lower inner piano voice',inner[1]['midi'])
                elif inner and big:take('VA',inner[0],'inner octave support',inner[0]['midi']-12)
                lead='OB' if 4<=b<=13 or 46<=b<=56 else 'FL1'
                if big or b%4 in (0,1):take(lead,top,'woodwind melody color',top['midi']+(12 if lead=='FL1' else 0))
                if inner and (big or b%4 in (2,3)):take('CL',inner[0],'woodwind inner line',inner[0]['midi'])
                if len(inner)>1 and big:take('FL2',inner[1],'upper woodwind harmony',inner[1]['midi']+12)
                if inner and (big or 14<=b<=21 or 31<=b<=38):take('H1',inner[0],'horn middle voice',inner[0]['midi']-12)
                if len(inner)>1 and big:take('H2',inner[1],'lower horn harmony',inner[1]['midi']-12)
                if big:
                    take('T1',top,'brass melody reinforcement',top['midi'])
                    if inner:take('T2',inner[0],'brass upper interior',inner[0]['midi'])
                    if len(inner)>1:take('TB1',inner[1],'tenor harmonic foundation',inner[1]['midi']-12)
                    if inner:take('TB3',inner[-1],'low tenor harmony',inner[-1]['midi']-12)
            if lh:
                bass=lh[0];take('VC',bass,'principal piano bass',bass['midi'])
                take('CB',bass,'bass octave foundation',bass['midi']-12)
                if big or b%4 in (2,3):take('BN',bass,'woodwind bass',bass['midi'])
                if big:
                    take('TU',bass,'orchestral bass reinforcement',bass['midi']-12)
                    if start<8 or b==79:take('BT',bass,'structural bass punctuation',bass['midi'])
                    if start==0 and bass['midi']%12 in (0,5):
                        take('TI',bass,'tuned harmonic punctuation',41 if bass['midi']%12==5 else 48)
            for pid,(n,pitch,role) in chosen.items():
                cells.append(dict(part=pid,bar=b,on=start,dur=stop-start,midi=pitch,chain=n['chain'],sources=[n['id']],source_midi=n['midi'],role=role))
    merged=[]
    for pid in PARTS:
        for e in (e for e in cells if e['part']==pid):
            if merged and all(merged[-1][k]==e[k] for k in ('part','bar','chain','midi')) and merged[-1]['on']+merged[-1]['dur']==e['on']:
                merged[-1]['dur']+=e['dur'];merged[-1]['sources']+=e['sources']
            else:merged.append(dict(e))
    byid={n['id']:n for n in notes}
    for e in merged:
        e.update(breath=False,trim=0,tie_start=False,tie_stop=False,slur=None)
        b=e['bar'];length=BARS[b-1]['length']
        if e['part'] in WIND and b<79 and e['on']+e['dur']==length and e['dur']>=2:
            e['trim']=min(4,e['dur']//2);e['dur']-=e['trim'];e['breath']=True
        e['sources']=sorted(set(s for s in e['sources'] if byid[s]['on']<e['on']+e['dur'] and byid[s]['on']+byid[s]['dur']>e['on']))
    for pid in PARTS:
        seq=[e for e in merged if e['part']==pid]
        for p,e in zip(seq,seq[1:]):
            if p['chain']==e['chain'] and p['midi']==e['midi'] and BARS[p['bar']-1]['start']+p['on']+p['dur']==BARS[e['bar']-1]['start']+e['on']:
                p['tie_start']=True;e['tie_stop']=True
        # Short phrase slurs are proposals, not prescribed string bow directions.
        if pid not in ('TI','CB','TU','BT'):
            for b,meta in enumerate(BARS,1):
                for beat in range(0,meta['length'],8):
                    g=[e for e in seq if e['bar']==b and beat<=e['on'] and e['on']+e['dur']<=beat+8]
                    if len(g)>=2 and all(e['dur']<=4 and not e['breath'] and not e['tie_start'] and not e['tie_stop'] for e in g):
                        if all(p['on']+p['dur']==e['on'] and abs(p['midi']-e['midi'])<=7 for p,e in zip(g,g[1:])):g[0]['slur']='start';g[-1]['slur']='stop'
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
            if x.tag not in ('dynamics','wedge','metronome','segno','coda') and not (x.tag=='words' and 'Rit' in (x.text or '')):dt.remove(x)
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
    """Diatonic transposition preserves the original enharmonic spelling."""
    p=source.find('pitch');letter=p.findtext('step');idx='CDEFGAB'.index(letter)
    source_midi=(int(p.findtext('octave'))+1)*12+STEP[letter]+int(p.findtext('alter','0'))
    octv=int(p.findtext('octave'))+(sounding-source_midi)//12
    dia,chrom=SHIFT.get(pid,(0,0));idx+=dia;octv+=idx//7;letter='CDEFGAB'[idx%7]
    alt=sounding+chrom-((octv+1)*12+STEP[letter]);assert -2<=alt<=2
    return letter,alt,octv

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
        if source.find('./notations/fermata') is not None:el(no,'fermata')
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
    s=E.Element('score-partwise',version='4.0');el(el(s,'work'),'work-title','The Everlasting Love of God')
    ident=copy.deepcopy(root.find('identification'));s.append(ident)
    cr=E.Element('creator',type='arranger');cr.text='Orchestral transcription: editorial edition';ident.insert(len(ident.findall('creator')),cr)
    defaults=el(s,'defaults');sc=el(defaults,'scaling');el(sc,'millimeters',5.5 if full else 7);el(sc,'tenths',40)
    w,h=(2160,3055) if full else (1200,1697)
    pg=el(defaults,'page-layout');el(pg,'page-height',h);el(pg,'page-width',w)
    ma=el(pg,'page-margins',type='both')
    for tag in ('left-margin','right-margin','top-margin','bottom-margin'):el(ma,tag,70)
    for kind,text,size,y in [('title','The Everlasting Love of God',24,h-65),('subtitle','Orchestral transcription | Piano source: Jeff Moore',11,h-115),('composer','Matt Boswell, Matt Papa and Matt Redman',10,h-155)]:
        c=el(s,'credit',page=1);el(c,'credit-type',kind);el(c,'credit-words',text,**{'font-size':size,'default-x':w/2,'default-y':y,'justify':'center','valign':'top'})
    pl=el(s,'part-list')
    if full:
        g=el(pl,'part-group',number=1,type='start');el(g,'group-symbol','bracket');el(g,'group-barline','yes')
    for idx,pid in enumerate(selected,1):
        nm,abbr,clef,line,program,*_=PARTS[pid]
        sp=el(pl,'score-part',id=pid);el(sp,'part-name',nm);el(sp,'part-abbreviation',abbr)
        ins=el(sp,'score-instrument',id=pid+'I');el(ins,'instrument-name',nm)
        el(sp,'midi-device',port=(idx-1)//15+1);mi=el(sp,'midi-instrument',id=pid+'I');el(mi,'midi-channel',((idx-1)%15)+1 if ((idx-1)%15)+1<10 else ((idx-1)%15)+2);el(mi,'midi-program',program)
    if full:el(pl,'part-group',number=1,type='stop')
    byid={n['id']:n for n in notes}
    for pid in selected:
        part=el(s,'part',id=pid)
        for b,src in enumerate(root.findall('./part/measure'),1):
            m=el(part,'measure',number=src.get('number'))
            if full and b%4==1:el(m,'print',**({'new-page':'yes'} if b>1 else {}))
            if not full and b in (31,57):el(m,'print',**{'new-page':'yes'})
            if b==1:
                a=el(m,'attributes');el(a,'divisions',8);el(el(a,'key'),'fifths',1 if pid in ('T1','T2','CL') else 0 if pid in ('H1','H2') else -1)
                tm=el(a,'time');el(tm,'beats',4);el(tm,'beat-type',4)
                c=el(a,'clef');el(c,'sign',PARTS[pid][2]);el(c,'line',PARTS[pid][3])
                if pid in SHIFT:
                    tr=el(a,'transpose');el(tr,'diatonic',0 if pid=='CB' else -SHIFT[pid][0]);el(tr,'chromatic',0 if pid=='CB' else -SHIFT[pid][1])
                    if pid=='CB':el(tr,'octave-change',-1)
                direction(m,text=('Arco, cantabile; slurs indicate short bow groups.' if pid in ('V1','V2','VA','VC','CB') else 'Soft mallets; damp at rests.' if pid=='TI' else 'Warm, light articulation; support the upper voices.' if pid=='TU' else 'Dolce, cantabile; breathe at written rests.'))
            if b in SECTIONS and (pid=='FL1' or not full):direction(m,rehearsal=SECTIONS[b])
            if b>1 and BARS[b-1]['beats']!=BARS[b-2]['beats']:
                a=el(m,'attributes');tm=el(a,'time');el(tm,'beats',BARS[b-1]['beats']);el(tm,'beat-type',4)
            if b==1 and pid=='TI':direction(m,text='Tune F2 and C3; damp after punctuation.')
            for on,d in directions[b]:transfer(m,on,d)
            for bl in src.findall("barline[@location='left']"):m.append(clean(bl))
            at=0
            for e in (e for e in events if e['part']==pid and e['bar']==b):
                assert e['on']>=at
                rest(m,at,e['on']-at);write_event(m,e,pid,byid[e['sources'][0]]['xml']);at=e['on']+e['dur']
            rest(m,at,BARS[b-1]['length']-at)
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
                    midi=(int(p.findtext('octave'))+1)*12+STEP[p.findtext('step')]+int(p.findtext('alter','0'))-SHIFT.get(pid,(0,0))[1]
                    result.extend((pid,b,t,midi) for t in range(at,at+dur))
                at+=dur
            assert at==BARS[b-1]['length'],(pid,b,at)
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
        if e['part'] in ('TU','BT','TI','VC','CB','BN'):assert all(byid[sid]['voice']=='2' for sid in e['sources'])
    for part in score.findall('part'):
        assert len(part.findall('measure'))==len(BARS)
        for orig,m in zip(root.findall('./part/measure'),part.findall('measure')):
            assert [canonical(clean(x)) for x in orig.findall('barline')]==[canonical(x) for x in m.findall('barline')]
    omitted=[]
    for n in notes:
        if n['id'] not in used:omitted.append({'source':n['id'],'bar':n['bar'],'midi':n['midi'],
            'reason':'alternate LH voice 3 omitted' if n['staff']==2 and n['voice']=='3' else 'octave doubling or unselected interior voice'})
    return {'measures':len(BARS),'source_pitched_segments':len(notes),'retained_source_segments':len(used),
        'unselected_source_segments':len(omitted),'wind_events_before_notational_splitting':len(events),
        'octave_shifted_wind_events':sum(e['midi']!=e['source_midi'] for e in events),
        'written_breath_rests':sum(e['trim']>0 for e in events),'breath_marks':sum(e['breath'] for e in events),
        'new_pitch_classes':0,'trumpets_written_major_second_above_sounding':True,'horns_written_perfect_fifth_above_sounding':True,
        'source_sha256':hashlib.sha256((OUT/'original-piano.musicxml').read_bytes()).hexdigest()},omitted

def playability(events):
    """Notated-order audit, excluding the open-ended final fermata."""
    result={}
    for pid in PARTS:
        seq=[e for e in events if e['part']==pid];end=-1;run=maximum=0
        for e in seq:
            if e['bar']==len(BARS):continue
            start=BARS[e['bar']-1]['start']+e['on']
            run=run+e['dur'] if start==end else e['dur']
            end=start+e['dur'];maximum=max(maximum,run)
        result[pid]={'events':len(seq),'low_sounding_midi':min(e['midi'] for e in seq),
            'high_sounding_midi':max(e['midi'] for e in seq),'max_continuous_beats_except_final':maximum/8}
    return result

def main():
    root,notes,directions=read_source();events=reduce(notes)
    score=build(root,notes,events,directions,list(PARTS),True);report,omitted=validate(root,notes,events,score)
    jobs=[]
    for name,tree in [('everlasting-love-orchestra',score)]+[(f'everlasting-love-{pid}',build(root,notes,events,directions,[pid],False)) for pid in PARTS]:
        f=OUT/(name+'.musicxml');E.ElementTree(tree).write(f,encoding='utf-8',xml_declaration=True)
        jobs.append({'in':str(f),'out':str(f.with_suffix('.pdf'))})
    for name,data in [('playability-audit',playability(events)),('note-map',events),('omissions',omitted),('validation',report),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
