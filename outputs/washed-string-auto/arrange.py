"""Washed: String Auto, a piece-specific instrumental arrangement.

Source: the supplied rhythm PDF and its adjacent matching Dorico MusicXML.
The source is NOT a complete vocal lead sheet. Source melody, selected cues,
editorial theme returns, and newly composed lines have distinct provenance.
Python 3 standard library; run this file beside source-rhythm.musicxml.
"""
from pathlib import Path
import collections, copy, hashlib, itertools, json
import xml.etree.ElementTree as E
import notation as n

OUT=Path(__file__).resolve().parent
PARTS={
 'V1':('Violin 1','Vln. 1','G',2,41,55,88),
 'V2':('Violin 2','Vln. 2','G',2,41,55,83),
 'VA':('Viola','Vla.','C',3,42,48,74),
 'VC':('Cello','Vc.','F',4,43,36,67),
 'CB':('Double Bass','D.B.','F',4,44,28,55),
}
LABEL={0:'Pickup',1:'A - Opening chorus',9:'B - Introduction',13:'C - Verse 1',
       21:'C2 - Verse continuation',29:'D - Chorus',37:'E - Verse 2',45:'E2 - Verse continuation',
       53:'F - Chorus (repeat)',63:'Transition',65:'G - Bridge 1',73:'H - Bridge 2',
       81:'I - Bridge 3',89:'J - Bridge 4',97:'K - Tag',105:'L - Vamp (repeat)',
       115:'M - Closing chorus',123:'Final chord'}
BARS=[]
MODE_CHANGES={'VA':{9:'Pizz.',29:'Arco',37:'Pizz.',53:'Arco',105:'Pizz.',113:'Arco'},
              'VC':{9:'Pizz.',29:'Arco',37:'Pizz.',53:'Arco',65:'Pizz.',81:'Arco, light detache',105:'Pizz.',113:'Arco'},
              'CB':{115:'Arco'}}
KINDS={'major':[0,4,7],'major-sixth':[0,4,7,9],'minor-seventh':[0,3,7,10],
       'suspended-fourth':[0,5,7],'suspended-second':[0,2,7],
       'dominant':[0,4,7,10],'none':[]}
SHARP=(('C',0),('C',1),('D',0),('D',1),('E',0),('F',0),('F',1),('G',0),('G',1),('A',0),('A',1),('B',0))

def midi(p):return (int(p.findtext('octave'))+1)*12+n.STEP[p.findtext('step')]+int(p.findtext('alter','0'))

def chord(x,bar,on,origin='source chord symbol'):
    root=(n.STEP[x.findtext('root/root-step')]+int(x.findtext('root/root-alter','0')))%12
    kind=x.findtext('kind');ints=list(KINDS[kind])
    for d in x.findall('degree'):
        deg=int(d.findtext('degree-value'));alt=int(d.findtext('degree-alter'))
        base=(0,2,4,5,7,9,11)[(deg-1)%7];action=d.findtext('degree-type')
        if action in ('alter','subtract'):ints=[i for i in ints if i%12!=base]
        if action in ('add','alter'):ints.append(base+alt)
    bass=root if x.find('bass') is None else (n.STEP[x.findtext('bass/bass-step')]+int(x.findtext('bass/bass-alter','0')))%12
    return dict(bar=bar,on=on,root=root,bass=bass,kind=kind,pcs=sorted({(root+i)%12 for i in ints}),origin=origin,xml=copy.deepcopy(x))

def editorial_chord(root,kind,bar,degree=None):
    x=E.Element('harmony');rr=n.el(x,'root');step,alt=SHARP[root];n.el(rr,'root-step',step)
    if alt:n.el(rr,'root-alter',alt)
    kk=n.el(x,'kind',kind);kk.set('text',{'major':'','minor-seventh':'m7','suspended-fourth':'sus4','dominant':'7','major-sixth':'6'}[kind])
    if degree:
        for value,action in degree:
            d=n.el(x,'degree');n.el(d,'degree-value',value);n.el(d,'degree-alter',0);n.el(d,'degree-type',action)
    return chord(x,bar,0,'editorial opening harmonization')

def read_source():
    root=E.parse(OUT/'source-rhythm.musicxml').getroot();records=[];hs=[];BARS.clear();sid=0;start=0
    for idx,m in enumerate(root.findall('./part/measure')):
        num=0 if m.get('number')=='X0' else int(m.get('number'));at=prior=end=0
        assert m.findtext('attributes/divisions')=='4'
        for x in m:
            if x.tag=='backup':at-=int(x.findtext('duration'))*2
            elif x.tag=='forward':at+=int(x.findtext('duration'))*2
            elif x.tag=='note':
                dur=int(x.findtext('duration','0'))*2;on=prior if x.find('chord') is not None else at
                if x.find('chord') is None:prior=at;at+=dur
                end=max(end,on+dur);sid+=1;p=x.find('pitch');head=x.findtext('notehead','normal')
                kind='rest' if x.find('rest') is not None else 'rhythm slash' if head=='slash' else 'percussion cue' if head in ('x','cross') or x.find('unpitched') is not None else 'pitched notation'
                records.append(dict(id=f's{sid}',bar=num,on=on,dur=dur,midi=midi(p) if p is not None else None,
                                    voice=x.findtext('voice','1'),classification=kind,head=head,xml=copy.deepcopy(x)))
            elif x.tag=='harmony':hs.append(chord(x,num,at+2*int(x.findtext('offset','0'))))
        length=8 if num==0 else 32
        assert end<=length,(num,end)
        BARS.append(dict(bar=num,index=idx,length=length,start=start,xml=copy.deepcopy(m)));start+=length
    assert len(BARS)==124 and sum(x['length'] for x in BARS)==3944
    # Honor the user's request to harmonize N.C.; preserve the source copy.
    opening={0:editorial_chord(11,'major',0),1:editorial_chord(11,'major',1),
             2:editorial_chord(8,'minor-seventh',2),3:editorial_chord(4,'major',3,[(9,'add')]),
             4:editorial_chord(6,'dominant',4,[(3,'subtract'),(4,'add')]),
             5:editorial_chord(11,'major',5),6:editorial_chord(8,'minor-seventh',6),
             7:editorial_chord(4,'major-sixth',7,[(9,'add')]),
             8:editorial_chord(6,'dominant',8,[(3,'subtract'),(4,'add')])}
    plan=[];last=None
    for meta in BARS:
        b=meta['bar'];found=[opening[b]] if b<=8 else sorted((h for h in hs if h['bar']==b),key=lambda h:h['on'])
        if not found or found[0]['on']>0:
            assert last is not None;found.insert(0,dict(last,bar=b,on=0,origin='carried source harmony' if b>8 else last['origin']))
        for i,h in enumerate(found):
            h['dur']=(found[i+1]['on'] if i+1<len(found) else meta['length'])-h['on'];assert h['dur']>0
            plan.append(h)
        last=found[-1]
    return root,records,hs,plan

def event(pid,b,on,dur,pitch,role,sources=(),tie_start=False,tie_stop=False):
    assert PARTS[pid][-2]<=pitch<=PARTS[pid][-1],(pid,b,pitch)
    return dict(part=pid,bar=b,on=on,dur=dur,midi=pitch,role=role,sources=list(sources),
                tie_start=tie_start,tie_stop=tie_stop,slur=None,art=None)

def upper_line(records,b,voice='1'):
    # Only normal, actual pitched notes; never treat slash placeholders as tune.
    groups=collections.defaultdict(list)
    for x in records:
        if x['bar']==b and x['voice']==voice and x['classification']=='pitched notation':groups[(x['on'],x['dur'])].append(x)
    return [max(g,key=lambda x:x['midi']) for _,g in sorted(groups.items())]

def lift(x,pid,b=None,shift=0,role='source pitched cue'):
    ties={t.get('type') for t in x['xml'].findall('tie')}
    return event(pid,x['bar'] if b is None else b,x['on'],x['dur'],x['midi']+shift,role,[x['id']], 'start' in ties,'stop' in ties)

def lead_lines(records,plan):
    events=[];cue_bars=set()
    def h_at(b,on):return next(h for h in plan if h['bar']==b and h['on']<=on<h['on']+h['dur'])
    for meta in BARS:
        b=meta['bar'];line=upper_line(records,b)
        if b<=8:
            events.extend(lift(x,'V1',role='source opening melody') for x in line)
        elif 29<=b<=36 or 53<=b<=60:
            template=(b-29 if b<=36 else b-53)%8+1
            shift=0 if b<=36 else 12
            events.extend(lift(x,'V1',b,shift,'editorial return of opening melody') for x in upper_line(records,template))
            if line:
                # The source guitar cue becomes a lower, independent violin strand.
                events.extend(lift(x,'V2',shift=-12,role='source guitar cue, octave lowered') for x in line);cue_bars.add(b)
        elif b in (19,20,43,44,61,62):
            events.extend(lift(x,'V1',shift=-12,role='source turnaround cue, octave lowered') for x in line)
        elif b in (27,28,51,52):
            # The score abbreviates the upper cue here; use its written prototype.
            prototype=19 if b%2 else 20
            events.extend(lift(x,'V1',b,-12,'editorial recurrence of source turnaround') for x in upper_line(records,prototype))
        elif 65<=b<=104:
            if line:
                shift=12 if b in (65,66) else -12 if b in (89,90,97,98) else 0
                events.extend(lift(x,'V1',shift=shift,role='source bridge riff in string register') for x in line)
            else:
                # Sequence the two-bar B-major riff, then project its new notes
                # onto the printed harmony. These are explicitly editorial notes.
                prototype=65 if b%2 else 66;h=h_at(b,0)
                for x in upper_line(records,prototype):
                    relative=x['midi']-59;target=71+relative+((h['root']-11+6)%12-6)
                    p=min((p for p in range(67,84) if p%12 in h['pcs']),key=lambda p:(abs(p-target),p))
                    events.append(event('V1',b,x['on'],x['dur'],p,'editorial harmonic sequence of bridge riff',[x['id']]))
        elif 113<=b<=114:
            events.extend(lift(x,'V1',role='source second-ending cue') for x in line)
        elif 115<=b<=122:
            events.extend(lift(x,'V1',shift=24,role='source closing upper line, two octaves raised') for x in line)
        elif b==123:
            events.append(event('V1',b,0,32,71,'editorial final tonic'))
        elif b in (63,64):
            events.append(event('V1',b,0,32,78,'quiet transition fifth'))
        else:
            # Verse/vamp continuation: rhythmic contour derived from short calls.
            patterns=[(4,8,0),(12,4,2),(16,8,4),(24,4,2),(28,4,0)] if b%2 else [(0,12,4),(12,4,2),(16,8,0)]
            old=75
            for on,dur,degree in patterns:
                h=h_at(b,on);pcs=h['pcs'];target=75+(degree-2)
                p=min((p for p in range(69,82) if p%12 in pcs),key=lambda p:abs(p-target)+.3*abs(p-old));old=p
                events.append(event('V1',b,on,dur,p,'new motivic continuation'))
            # Transfer the source's upper chord-hit line in the introduction.
            if 9<=b<=18 and line:
                events.extend(lift(x,'V2',role='source introduction upper chord-hit line') for x in line);cue_bars.add(b)
    return events,cue_bars

def voiced(h,events,previous):
    lead=[e['midi'] for e in events if e['part']=='V1' and e['bar']==h['bar'] and e['on']<h['on']+h['dur'] and e['on']+e['dur']>h['on']]
    cue=[e['midi'] for e in events if e['part']=='V2' and e['bar']==h['bar'] and e['on']<h['on']+h['dur'] and e['on']+e['dur']>h['on']]
    ceiling=min(lead or [84])-1;cue_ceiling=min(cue or [ceiling])
    bass=n.octave(h['bass'],47,36,55)
    opts=[[p for p in range(50,min(70,cue_ceiling-1)+1) if p%12 in h['pcs']],
          [p for p in range(55,min(79,ceiling)+1) if p%12 in h['pcs']]]
    best=None;old=previous or (bass,57,66)
    for va,v2 in itertools.product(*opts):
        if not bass<va<v2 or v2-va>12 or v2-va==1:continue
        pitches=(bass,va,v2);classes={p%12 for p in pitches}
        cost=sum(abs(p-q)+max(0,abs(p-q)-7)**2 for p,q in zip(pitches,old))
        cost+=.3*(abs(va-57)+abs(v2-66))+5*len(set(h['pcs'])-classes)
        cost+=sum(abs(v2-p)==1 for p in lead)*4
        if best is None or (cost,pitches)<best:best=(cost,pitches)
    assert best is not None,(h,lead,cue)
    return dict(zip(('VC','VA','V2'),best[1]))

def compose(records,plan):
    events,cue_bars=lead_lines(records,plan);previous=None
    for h in plan:
        b,a,d=h['bar'],h['on'],h['dur'];end=a+d;v=voiced(h,events,previous);previous=[v[p] for p in ('VC','VA','V2')];h['voicing']=v
        verse=9<=b<=28 or 37<=b<=52 or 105<=b<=112
        drive=81<=b<=104;bridge=65<=b<=104
        for pid in ('V2','VA','VC','CB'):
            if b==0:continue # melody-only pickup
            if pid=='V2' and b in cue_bars:continue
            p=n.octave(h['bass'],35,28,43) if pid=='CB' else v[pid]
            role='sustained harmonic strand';cells=[(a,d)]
            if b==123:
                p={'V2':66,'VA':63,'VC':47,'CB':35}[pid];cells=[(0,32)];role='final B-major voicing'
            elif pid=='CB' and b>=115:
                cells=[(a,d)];role='arco closing foundation'
            elif pid=='CB':
                pulse=8 if bridge else 16
                positions=sorted({a}|{t for t in range(0,32,pulse) if a<=t<end})
                cells=[(t,min(4,end-t)) for t in positions];role='pizzicato harmonic foundation'
            elif pid=='VC' and (verse or bridge):
                step=4 if drive else 8
                cells=[(t,min(4,end-t)) for t in range(a,end,step)];role='bowed motor rhythm' if drive else 'pizzicato cello pulse'
            elif pid=='VA' and verse:
                cells=[(t,min(4,end-t)) for t in (8,24) if a<=t<end];role='pizzicato backbeat'
            elif pid=='VA' and drive:
                cells=[(t,min(4,end-t)) for t in range(a,end,8)];role='bowed inner pulse'
            for j,(on,dur) in enumerate(cells):
                pitch=p
                if pid=='VC' and drive and j%2:
                    pitch=n.octave((h['root']+7)%12,p+5,*PARTS['VC'][-2:])
                    if pitch%12 not in h['pcs']:pitch=p
                e=event(pid,b,on,dur,pitch,role)
                if 'pulse' in role or 'motor' in role:e['art']='staccato' if drive else None
                events.append(e)
    # Leave at least a quarter rest to prepare each arco/pizzicato change.
    # At 139 bpm this is about 0.43 seconds; players may request more.
    for pid,changes in MODE_CHANGES.items():
        for b in changes:
            cutoff=BARS[b-1]['length']-8
            for e in list(events):
                if e['part']==pid and e['bar']==b-1 and e['on']+e['dur']>cutoff:
                    e['dur']=cutoff-e['on'];e['tie_start']=False
                    if e['dur']<=0:events.remove(e)
    events.sort(key=lambda e:(list(PARTS).index(e['part']),e['bar'],e['on']))
    # Reconcile copied cues to their actual following notes, not merely source ties.
    # This matters when a cue is lifted or a source passage is re-used elsewhere.
    for pid in PARTS:
        seq=[e for e in events if e['part']==pid]
        for i,e in enumerate(seq):
            def contiguous(x,y):return BARS[x['bar']]['start']+x['on']+x['dur']==BARS[y['bar']]['start']+y['on'] and x['midi']==y['midi']
            if e['tie_stop'] and (i==0 or not seq[i-1]['tie_start'] or not contiguous(seq[i-1],e)):e['tie_stop']=False
            if e['tie_start'] and (i+1==len(seq) or not seq[i+1]['tie_stop'] or not contiguous(e,seq[i+1])):e['tie_start']=False
        # Sustain common tones only in arco pads, avoiding repeats/ending jumps.
        for x,y in zip(seq,seq[1:]):
            if pid in ('V2','VA','VC') and x['role']==y['role']=='sustained harmonic strand' and x['bar'] not in (58,60,62,110,112,114) and contiguous(x,y) and (x['bar']==y['bar'] or x['bar']%2):
                x['tie_start']=True;y['tie_stop']=True
        # Short optional slur groups only for moving, untied melodic pitches.
        if pid=='V1':
            for b in range(124):
                for beat in (0,8,16,24):
                    g=[e for e in seq if e['bar']==b and beat<=e['on'] and e['on']+e['dur']<=beat+8]
                    if len(g)>=2 and all(not e['tie_start'] and not e['tie_stop'] for e in g) and all(x['midi']!=y['midi'] and abs(x['midi']-y['midi'])<=7 and x['on']+x['dur']==y['on'] for x,y in zip(g,g[1:])):
                        g[0]['slur']='start';g[-1]['slur']='stop'
    return events

def rest(m,on,dur,whole=False):
    if whole:
        note=n.el(m,'note');n.el(note,'rest',measure='yes');n.el(note,'duration',dur);return
    for d in n.chunks(on,dur) if dur else []:
        note=n.el(m,'note');n.el(note,'rest');n.el(note,'duration',d);typ,dot=n.VALUES[d];n.el(note,'type',typ)
        if dot:n.el(note,'dot')
        on+=d

def write_event(m,e):
    pid=e['part'];pitch=e['midi']+(12 if pid=='CB' else 0);step,alt=SHARP[pitch%12]
    chunks=n.chunks(e['on'],e['dur'])
    for j,d in enumerate(chunks):
        note=n.el(m,'note');p=n.el(note,'pitch');n.el(p,'step',step)
        if alt:n.el(p,'alter',alt)
        n.el(p,'octave',pitch//12-1);n.el(note,'duration',d)
        stop=e['tie_stop'] or j>0;start=e['tie_start'] or j<len(chunks)-1
        if stop:n.el(note,'tie',type='stop')
        if start:n.el(note,'tie',type='start')
        typ,dot=n.VALUES[d];n.el(note,'type',typ)
        if dot:n.el(note,'dot')
        no=n.el(note,'notations')
        if stop:n.el(no,'tied',type='stop')
        if start:n.el(no,'tied',type='start')
        if j==0 and e['slur']=='start':n.el(no,'slur',type='start',number=1)
        if j==len(chunks)-1 and e['slur']=='stop':n.el(no,'slur',type='stop',number=1)
        if e['art']:n.el(n.el(no,'articulations'),e['art'])
        if e['bar']==123:n.el(no,'fermata')
        if not len(no):note.remove(no)

def directions(m,b,pid,full):
    if b in LABEL and (pid=='V1' or not full):n.direction(m,rehearsal=LABEL[b])
    if b==0:
        if pid=='V1' or not full:
            d=n.direction(m,text='Quarter = 139; energetic, even eighths');n.el(d,'sound',tempo=139)
        n.direction(m,text='Arco; dolce, light articulation' if pid!='CB' else 'Pizz.; sounds one octave below written')
    if b in LABEL:
        dyn='p' if b in (0,1,115,123) else 'mp' if b<53 or b in (63,65) else 'mf' if b in (53,73,105) else 'f'
        n.direction(m,dynamic=dyn)
    if b in MODE_CHANGES.get(pid,{}):n.direction(m,text=MODE_CHANGES[pid][b])
    if b==1 and (pid=='V1' or not full):n.direction(m,text='Opening harmony added editorially to source N.C.')
    if b==122:n.direction(m,text='Rit.')

def build(root,events,plan,selected,full=False):
    s=E.Element('score-partwise',version='4.0');n.el(n.el(s,'work'),'work-title','Washed - String Auto')
    ident=copy.deepcopy(root.find('identification'))
    # This source has malformed lyricist placeholder text, not a person credit.
    for x in list(ident):
        if x.tag=='creator' and x.get('type')=='lyricist' and 'Hard return' in (x.text or ''):ident.remove(x)
    credit=E.Element('creator',type='arranger');credit.text='String arrangement: editorial edition'
    position=next((i for i,x in enumerate(ident) if x.tag!='creator'),len(ident))
    ident.insert(position,credit);s.append(ident)
    defaults=n.el(s,'defaults');sc=n.el(defaults,'scaling');n.el(sc,'millimeters',6 if full else 7);n.el(sc,'tenths',40)
    w,h=(1400,1980) if full else (1200,1697);pg=n.el(defaults,'page-layout');n.el(pg,'page-height',h);n.el(pg,'page-width',w)
    ma=n.el(pg,'page-margins',type='both')
    for tag in ('left-margin','right-margin','top-margin','bottom-margin'):n.el(ma,tag,65)
    texts=[('title','Washed - String Auto',22,h-70),('subtitle','String quintet | Rhythm source: Grant Wall / Daniel Galbraith' if full else PARTS[selected[0]][0]+' | String Auto',10,h-115),('composer','Joe L. Barnes, Joshua Holiday and Mitch Wong',10,h-150)]
    for kind,text,size,y in texts:
        cr=n.el(s,'credit',page=1);n.el(cr,'credit-type',kind);n.el(cr,'credit-words',text,**{'font-size':size,'default-x':w/2,'default-y':y,'justify':'center','valign':'top'})
    pl=n.el(s,'part-list')
    if full:
        gr=n.el(pl,'part-group',number=1,type='start');n.el(gr,'group-symbol','bracket');n.el(gr,'group-barline','yes')
    for i,pid in enumerate(selected,1):
        name,abbr,clef,line,program,lo,hi=PARTS[pid];sp=n.el(pl,'score-part',id=pid);n.el(sp,'part-name',name);n.el(sp,'part-abbreviation',abbr)
        ins=n.el(sp,'score-instrument',id=pid+'I');n.el(ins,'instrument-name',name)
        mi=n.el(sp,'midi-instrument',id=pid+'I');n.el(mi,'midi-channel',i);n.el(mi,'midi-program',program)
    if full:n.el(pl,'part-group',number=1,type='stop')
    for pid in selected:
        part=n.el(s,'part',id=pid)
        for meta in BARS:
            b=meta['bar'];src=meta['xml'];m=n.el(part,'measure',number=src.get('number'),**({'implicit':'yes'} if b==0 else {}))
            # Two systems of four bars per page; pickup joins first system.
            if full and b>1 and b%4==1:n.el(m,'print',**({'new-page':'yes'} if b%8==1 else {'new-system':'yes'}))
            if not full and b in (29,65,97):n.el(m,'print',**{'new-page':'yes'})
            if not full and b==(119 if pid=='VC' else 121):n.el(m,'print',**{'new-system':'yes'})
            if b==0:
                a=n.el(m,'attributes');n.el(a,'divisions',8);n.el(n.el(a,'key'),'fifths',5)
                tm=n.el(a,'time');n.el(tm,'beats',4);n.el(tm,'beat-type',4)
                cl=n.el(a,'clef');n.el(cl,'sign',PARTS[pid][2]);n.el(cl,'line',PARTS[pid][3])
                if pid=='CB':tr=n.el(a,'transpose');n.el(tr,'diatonic',0);n.el(tr,'chromatic',0);n.el(tr,'octave-change',-1)
            directions(m,b,pid,full)
            harmonies=[hh for hh in plan if hh['bar']==b and hh['origin']!='carried source harmony'] if pid=='V1' or not full else []
            for x in src.findall("barline[@location='left']"):m.append(n.clean(x))
            seq=[e for e in events if e['part']==pid and e['bar']==b]
            points=sorted({0,meta['length']}|{hh['on'] for hh in harmonies}|{t for e in seq for t in (e['on'],e['on']+e['dur'])})
            # Place each harmony at the actual XML cursor, rather than relying
            # on importers to honor harmony offsets. Split sustained notes with
            # ties when a harmony falls inside the note; sound stays identical.
            for on,end in zip(points,points[1:]):
                for hh in harmonies:
                    if hh['on']==on:
                        x=n.clean(hh['xml'])
                        for off in x.findall('offset'):x.remove(off)
                        m.append(x)
                active=[e for e in seq if e['on']<=on<e['on']+e['dur']]
                assert len(active)<=1,(pid,b,on,'overlap')
                if not active:rest(m,on,end-on,whole=not seq and on==0 and end==32)
                else:
                    e=active[0];piece=dict(e,on=on,dur=end-on,
                        tie_stop=e['tie_stop'] or on>e['on'],
                        tie_start=e['tie_start'] or end<e['on']+e['dur'],
                        slur=e['slur'] if (e['slur']=='start' and on==e['on']) or (e['slur']=='stop' and end==e['on']+e['dur']) else None)
                    write_event(m,piece)
            n.beam_measure(m)
            for x in src.findall('barline'):
                if x.get('location')!='left':m.append(n.clean(x))
    E.indent(s);return s

def decode(score):
    result=[]
    for part in score.findall('part'):
        pid=part.get('id');shift=0;active={};slur=False
        for idx,m in enumerate(part.findall('measure')):
            b=BARS[idx]['bar'];at=0
            tr=m.find('./attributes/transpose')
            if tr is not None:shift=int(tr.findtext('chromatic','0'))+12*int(tr.findtext('octave-change','0'))
            for note in m.findall('note'):
                dur=int(note.findtext('duration'));p=note.find('pitch');rests=note.find('rest')
                if rests is None or rests.get('measure')!='yes':
                    typ,dot=n.VALUES[dur];assert note.findtext('type')==typ and (note.find('dot') is not None)==dot
                if p is not None:
                    pitch=midi(p)+shift;result.extend((pid,b,t,pitch) for t in range(at,at+dur))
                    tie={x.get('type') for x in note.findall('tie')};start=BARS[idx]['start']+at
                    if 'stop' in tie:assert active.pop(pitch,None)==start,(pid,b,pitch,'unmatched tie stop')
                    if 'start' in tie:assert pitch not in active;active[pitch]=start+dur
                    for x in note.findall('./notations/slur'):
                        if x.get('type')=='start':assert not slur;slur=True
                        else:assert slur;slur=False
                at+=dur
            assert at==BARS[idx]['length'],(pid,b,at)
        assert not active and not slur,(pid,active,slur)
    return collections.Counter(result)

def validate(root,records,hs,plan,events,score):
    assert len(score.findall('part'))==5
    assert decode(score)==collections.Counter((e['part'],e['bar'],t,e['midi']) for e in events for t in range(e['on'],e['on']+e['dur']))
    # Exact opening pitches, timing, rests (implicitly), and ties survive.
    expected=[(x['bar'],x['on'],x['dur'],x['midi'],{t.get('type') for t in x['xml'].findall('tie')}) for x in records if x['bar']<=8 and x['classification']=='pitched notation']
    actual=[(e['bar'],e['on'],e['dur'],e['midi'],({'start'} if e['tie_start'] else set())|({'stop'} if e['tie_stop'] else set())) for e in events if e['part']=='V1' and e['bar']<=8]
    assert actual==expected,'Opening melody altered'
    exported=score.find("part[@id='V1']").findall('measure')
    for h in hs:
        if h['bar']<=8:continue
        at=0;candidates=[]
        for x in exported[h['bar']]:
            if x.tag=='note':at+=int(x.findtext('duration'))
            elif x.tag=='harmony':candidates.append((at,x))
        match=next(x for on,x in candidates if on==h['on'])
        hh=chord(match,h['bar'],h['on']);assert all(hh[k]==h[k] for k in ('root','bass','kind','pcs'))
    for part in score.findall('part'):
        assert len(part.findall('measure'))==124
        for meta,m in zip(BARS,part.findall('measure')):
            assert [n.canonical(n.clean(x)) for x in meta['xml'].findall('barline')]==[n.canonical(x) for x in m.findall('barline')]
    for e in events:
        assert PARTS[e['part']][-2]<=e['midi']<=PARTS[e['part']][-1]
        if e['part']!='V1' and not e['sources']:
            h=next(h for h in plan if h['bar']==e['bar'] and h['on']<=e['on']<h['on']+h['dur'])
            assert e['on']+e['dur']<=h['on']+h['dur']
            assert e['midi']%12 in set(h['pcs'])|{h['bass']}
    return {'source_measures_including_pickup':124,'numbered_measures':123,'opening_melody_segments':len(expected),
            'source_chord_symbols':len(hs),'editorially_harmonized_pickup_and_bars':list(range(9)),
            'printed_chords_from_bar_9_preserved':True,'source_repeats_and_endings_preserved':True,
            'opening_melody_preserved':True,'exported_pitches_timing_ties_slurs_checked':True,
            'arrangement_event_count':len(events),'source_xml_sha256':hashlib.sha256((OUT/'source-rhythm.musicxml').read_bytes()).hexdigest(),
            'source_pdf_sha256':hashlib.sha256((OUT/'source-rhythm.pdf').read_bytes()).hexdigest(),
            'source_type':'Rhythm chart with partial melody and pitched cues, not complete vocal lead sheet',
            'review_status':'Structural checks; PDF engraving and player review are separate.'}

def serial_plan(plan):return [{k:v for k,v in h.items() if k!='xml'} for h in plan]

def main():
    root,records,hs,plan=read_source();events=compose(records,plan);score=build(root,events,plan,list(PARTS),True)
    report=validate(root,records,hs,plan,events,score);jobs=[]
    for name,tree in [('washed-string-auto',score)]+[(f'washed-{pid}',build(root,events,plan,[pid])) for pid in PARTS]:
        f=OUT/(name+'.musicxml');E.ElementTree(tree).write(f,encoding='utf-8',xml_declaration=True)
        reopened=E.parse(f).getroot()
        if name=='washed-string-auto':validate(root,records,hs,plan,events,reopened)
        else:
            pid=tree.find('part').get('id')
            assert decode(reopened)==collections.Counter((e['part'],e['bar'],t,e['midi']) for e in events if e['part']==pid for t in range(e['on'],e['on']+e['dur']))
        jobs.append({'in':str(f),'out':str(f.with_suffix('.pdf'))})
    audit={'source_note_classifications':dict(collections.Counter(x['classification'] for x in records)),
           'part_ranges':{pid:{'low_sounding_midi':min(e['midi'] for e in events if e['part']==pid),'high_sounding_midi':max(e['midi'] for e in events if e['part']==pid)} for pid in PARTS},
           'event_roles':dict(collections.Counter(e['role'] for e in events))}
    for name,data in [('harmony-plan',serial_plan(plan)),('arrangement-events',events),('validation',report),('source-audit',audit),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
