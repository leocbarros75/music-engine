"""Washed - Wind Auto, piece-specific arrangement from the supplied rhythm chart.

Authored concert-pitch events are separate from the MusicXML writer. The source
contains partial melody and instrumental cues, not a complete vocal lead sheet.
Run with Python 3 standard library, alongside source-rhythm.musicxml and notation.py.
"""
from pathlib import Path
import collections, copy, hashlib, itertools, json
import xml.etree.ElementTree as E
import notation as n

OUT=Path(__file__).resolve().parent
PARTS={
 'FL':('Flute','Fl.','G',2,74,60,88),
 'OB':('Oboe','Ob.','G',2,69,58,81),
 'CL':('Clarinet in B-flat','Cl.','G',2,72,50,81),
 'BS':('Bassoon','Bsn.','F',4,71,34,67),
}
BARS=[]
KINDS={'major':[0,4,7],'major-sixth':[0,4,7,9],'minor-seventh':[0,3,7,10],
       'suspended-fourth':[0,5,7],'suspended-second':[0,2,7],
       'dominant':[0,4,7,10],'none':[]}
SHARP=(('C',0),('C',1),('D',0),('D',1),('E',0),('F',0),('F',1),('G',0),('G',1),('A',0),('A',1),('B',0))
# C# major spelling for Bb clarinet's written pitches (includes B# and E#).
CLAR_SPELL=(('B',1),('C',1),('D',0),('D',1),('E',0),('E',1),('F',1),('G',0),('G',1),('A',0),('A',1),('B',0))
LABEL={0:'Pickup',1:'A - Opening chorus',9:'B - Introduction',13:'C - Verse 1',
       21:'C2 - Verse continuation',29:'D - Chorus',37:'E - Verse 2',45:'E2 - Verse continuation',
       53:'F - Chorus (repeat)',63:'Transition',65:'G - Bridge 1',73:'H - Bridge 2',
       81:'I - Bridge 3',89:'J - Bridge 4',97:'K - Tag',105:'L - Vamp (repeat)',
       115:'M - Closing chorus',123:'Final chord'}

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
                tie_start=tie_start,tie_stop=tie_stop,slur=None,art=None,layer='lead')

def upper_line(records,b,voice='1'):
    # Only normal, actual pitched notes; never treat slash placeholders as tune.
    groups=collections.defaultdict(list)
    for x in records:
        if x['bar']==b and x['voice']==voice and x['classification']=='pitched notation':groups[(x['on'],x['dur'])].append(x)
    return [max(g,key=lambda x:x['midi']) for _,g in sorted(groups.items())]

def lift(x,pid,b=None,shift=0,role='source pitched cue'):
    ties={t.get('type') for t in x['xml'].findall('tie')}
    return event(pid,x['bar'] if b is None else b,x['on'],x['dur'],x['midi']+shift,role,[x['id']], 'start' in ties,'stop' in ties)

def leader(b):
    if b<=8 or 29<=b<=36 or b in (63,64,123):return 'FL'
    if 65<=b<=104:return ('FL','OB','CL')[((b-65)//2)%3]
    if 115<=b<=122:return ('FL','OB','CL','FL')[(b-115)//2]
    if 9<=b<=28 or 53<=b<=62 or b in (113,114):return 'OB'
    return 'CL'

def transferred(line,pid,b,shift=0,role='source pitched cue',layer='lead'):
    if not line:return []
    lo,hi=PARTS[pid][-2:]
    while min(x['midi']+shift for x in line)<lo:shift+=12
    while max(x['midi']+shift for x in line)>hi:shift-=12
    assert min(x['midi']+shift for x in line)>=lo,(pid,b,'cue span')
    result=[lift(x,pid,b,shift,role) for x in line]
    for e in result:e['layer']=layer;e['octave_shift']=shift
    return result

def lead_lines(records,plan):
    events=[];cue_bars=set()
    def harmony_at(b,on):return next(h for h in plan if h['bar']==b and h['on']<=on<h['on']+h['dur'])
    for meta in BARS:
        b=meta['bar'];pid=leader(b);line=upper_line(records,b)
        if b<=8:events.extend(transferred(line,pid,b,role='source opening melody'))
        elif 29<=b<=36 or 53<=b<=60:
            template=(b-29 if b<=36 else b-53)+1
            events.extend(transferred(upper_line(records,template),pid,b,role='editorial return of opening melody'))
            if line:
                events.extend(transferred(line,'CL',b,-12,'source guitar cue in clarinet register','source cue'));cue_bars.add(('CL',b))
        elif b in (19,20,43,44,61,62):
            events.extend(transferred(line,pid,b,-12,'source turnaround cue in quartet register'))
        elif b in (27,28,51,52):
            prototype=19 if b%2 else 20
            events.extend(transferred(upper_line(records,prototype),pid,b,-12,'editorial recurrence of source turnaround'))
        elif 65<=b<=104:
            if line:
                shift=12 if b in (65,66) else -12 if b in (89,90,97,98) else 0
                events.extend(transferred(line,pid,b,shift,'source bridge riff in quartet register'))
            else:
                prototype=65 if b%2 else 66;h=harmony_at(b,0);lo,hi=PARTS[pid][-2:]
                for x in upper_line(records,prototype):
                    target=71+x['midi']-59+((h['root']-11+6)%12-6)
                    p=min((p for p in range(max(lo,64),min(hi,81)+1) if p%12 in h['pcs']),key=lambda p:(abs(p-target),p))
                    events.append(event(pid,b,x['on'],x['dur'],p,'editorial harmonic sequence of bridge riff',[x['id']]))
        elif 113<=b<=114:
            events.extend(transferred(line,pid,b,role='source second-ending cue'))
        elif 115<=b<=122:
            events.extend(transferred(line,pid,b,24,'source closing upper line in quartet register'))
        elif b==123:events.append(event(pid,b,0,32,71,'editorial final tonic'))
        elif b in (63,64):events.append(event(pid,b,0,24 if b==64 else 32,78,'quiet transition fifth'))
        else:
            pattern=[(4,8,0),(12,4,2),(16,8,4),(24,4,2),(28,4,0)] if b%2 else [(0,12,4),(12,4,2),(16,8,0)]
            old=75
            for on,dur,degree in pattern:
                h=harmony_at(b,on);lo,hi=PARTS[pid][-2:];target=75+degree-2
                p=min((p for p in range(max(lo,67),min(hi,81)+1) if p%12 in h['pcs']),key=lambda p:abs(p-target)+.3*abs(p-old));old=p
                events.append(event(pid,b,on,dur,p,'new motivic continuation'))
            if 9<=b<=18 and line:
                events.extend(transferred(line,'FL',b,12,'source introduction chord-hit line in flute register','source cue'));cue_bars.add(('FL',b))
    return events,cue_bars

def voiced(h,events,previous,cue_bars):
    """Local exhaustive search for remaining woodwind voices, at concert pitch."""
    b=h['bar'];pid=leader(b);bass=n.octave(h['bass'],47,38,55)
    active=[e for e in events if e['bar']==b and e['on']<h['on']+h['dur'] and e['on']+e['dur']>h['on']]
    fixed=[e['midi'] for e in active];free=[p for p in ('CL','OB','FL') if p!=pid and (p,b) not in cue_bars]
    registers={'FL':(67,83,75),'OB':(62,76,68),'CL':(54,74,62)}
    options=[[v for v in range(registers[p][0],registers[p][1]+1) if v%12 in h['pcs']] for p in free]
    best=None
    for pitches in itertools.product(*options):
        if any(p<=bass for p in pitches) or any(x>=y for x,y in zip(pitches,pitches[1:])):continue
        if any(abs(x-y)==1 for x,y in itertools.combinations(pitches,2)):continue
        classes={bass%12}|{p%12 for p in pitches}|{p%12 for p in fixed}
        cost=5*len(set(h['pcs'])-classes)
        for part,p in zip(free,pitches):
            old=previous.get(part,registers[part][2]);movement=abs(p-old)
            cost+=movement+max(0,movement-7)**2+.25*abs(p-registers[part][2])
            cost+=sum(5 if abs(p-q)==1 else 1 if p==q else 0 for q in fixed)
        if best is None or (cost,pitches)<best:best=(cost,pitches)
    assert best is not None,(b,free)
    return {'BS':bass,**dict(zip(free,best[1]))}

def compose(records,plan):
    events,cue_bars=lead_lines(records,plan);previous={}
    for h in plan:
        b,a,end=h['bar'],h['on'],h['on']+h['dur'];v=voiced(h,events,previous,cue_bars);previous.update(v);h['voicing']=v
        if b==0:continue # original melody-only pickup
        verse=9<=b<=28 or 37<=b<=52 or 105<=b<=112
        bridge=65<=b<=104
        for pid,p in v.items():
            cells=[];role='breath-spaced harmonic support';art=None
            if b==123:
                p={'FL':71,'OB':66,'CL':63,'BS':47}[pid];cells=[(0,32)];role='final B-major voicing'
            elif pid=='BS' and (verse or bridge):
                cells=[(t,min(4,end-t)) for t in sorted({a}|{t for t in range(0,32,8) if a<=t<end})];role='lightly tongued bassoon pulse';art='staccato'
            elif pid=='BS' and 29<=b<=62:
                cells=[(t,min(12,end-t)) for t in sorted({a}|{t for t in (0,16) if a<=t<end})];role='bassoon harmonic foundation'
            elif pid=='BS':
                lo,hi=(0,28) if b%2 else (4,32)
                cells=[(max(a,lo),min(end,hi)-max(a,lo))] if max(a,lo)<min(end,hi) else []
                if a==28 and not cells:cells=[(a,end-a)]
                role='bassoon cantabile foundation'
            elif bridge and pid!='FL':
                cells=[(t,min(4,end-t)) for t in (8,24) if a<=t<end];role='light inner offbeat pulse';art='staccato'
            elif verse and pid=='CL':
                cells=[(t,min(4,end-t)) for t in (8,24) if a<=t<end];role='clarinet offbeat response';art='staccato'
            else:
                lo,hi=(8,24) if pid=='FL' else ((0,24) if b%2 else (4,28)) if pid=='OB' else ((4,28) if b%2 else (0,24))
                # A new support role after a solo starts with a brief breathing gap.
                if b>0 and leader(b-1)==pid:lo=max(lo,4)
                cells=[(max(a,lo),min(end,hi)-max(a,lo))] if max(a,lo)<min(end,hi) else []
            for on,dur in cells:
                e=event(pid,b,on,dur,p,role);e['layer']='accompaniment';e['art']=art;events.append(e)
    events.sort(key=lambda e:(list(PARTS).index(e['part']),e['bar'],e['on']))
    # Reconcile source ties after register transfers and solo handoffs.
    for pid in PARTS:
        seq=[e for e in events if e['part']==pid]
        def adjacent(x,y):return BARS[x['bar']]['start']+x['on']+x['dur']==BARS[y['bar']]['start']+y['on'] and x['midi']==y['midi']
        for i,e in enumerate(seq):
            if e['tie_stop'] and (i==0 or not seq[i-1]['tie_start'] or not adjacent(seq[i-1],e)):e['tie_stop']=False
            if e['tie_start'] and (i+1==len(seq) or not seq[i+1]['tie_stop'] or not adjacent(e,seq[i+1])):e['tie_start']=False
        for b in range(124):
            for beat in (0,8,16,24):
                group=[e for e in seq if e['bar']==b and beat<=e['on'] and e['on']+e['dur']<=beat+8 and e['layer'] in ('lead','source cue')]
                if len(group)>=2 and all(not e['tie_start'] and not e['tie_stop'] for e in group) and all(x['midi']!=y['midi'] and abs(x['midi']-y['midi'])<=7 and x['on']+x['dur']==y['on'] for x,y in zip(group,group[1:])):
                    group[0]['slur']='start';group[-1]['slur']='stop'
    return events

def playback_route():
    """Unfold the two explicit source repeats for an independent breath audit."""
    return list(range(53))+list(range(53,61))+list(range(53,59))+list(range(61,105))+list(range(105,113))+list(range(105,111))+list(range(113,124))

def breath_audit(events):
    result={}
    for pid in PARTS:
        timeline=[]
        for b in playback_route():
            active={t for e in events if e['part']==pid and e['bar']==b for t in range(e['on'],e['on']+e['dur'])}
            timeline.extend(t in active for t in range(BARS[b]['length']))
        best=run=gap=0
        for occupied in timeline:
            if occupied:
                if gap>=4:run=0
                run+=gap if gap<4 else 0;gap=0;run+=1;best=max(best,run)
            else:gap+=1
        assert best<=96,(pid,'no eighth-rest opportunity within 12 quarters',best)
        result[pid]={'longest_run_quarters':best/8,'seconds_at_139':round(best/8*60/139,2),'minimum_rest_counted_as_opportunity_quarters':0.5}
    return result

def transpose_harmony(harmony):
    h=n.clean(harmony)
    for tag in ('root','bass'):
        x=h.find(tag)
        if x is None:continue
        step=x.find(tag+'-step');alter=x.find(tag+'-alter');pc=(n.STEP[step.text]+int(alter.text if alter is not None else 0)+2)%12
        letter,acc=CLAR_SPELL[pc];step.text=letter
        if alter is not None:x.remove(alter)
        if acc:x.insert(1,E.Element(tag+'-alter'));x.find(tag+'-alter').text=str(acc)
    return h

def validate_written_harmony(score,source_harmonies,selected_pid=None):
    pid=selected_pid or 'FL';part=score.find(f"part[@id='{pid}']");shift=2 if pid=='CL' else 0
    for h in source_harmonies:
        if h['bar']<=8:continue
        at=0;candidates=[]
        for x in part.findall('measure')[h['bar']]:
            if x.tag=='note':at+=int(x.findtext('duration'))
            elif x.tag=='harmony':candidates.append((at,x))
        hh=chord(next(x for t,x in candidates if t==h['on']),h['bar'],h['on'])
        assert hh['root']==(h['root']+shift)%12 and hh['bass']==(h['bass']+shift)%12
        assert hh['kind']==h['kind'] and hh['pcs']==sorted((p+shift)%12 for p in h['pcs'])

def directions(m,b,pid,full):
    if b in LABEL and (pid=='FL' or not full):n.direction(m,rehearsal=LABEL[b])
    if b==0 and (pid=='FL' or not full):
        d=n.direction(m,text='Quarter = 139; energetic, even eighths');n.el(d,'sound',tempo=139)
    if b==0:n.direction(m,text='Dolce; light tonguing' if pid!='CL' else 'B-flat clarinet; written pitch')
    changed=b==0 or leader(b)!=leader(b-1)
    if changed or b in LABEL:
        base='p' if b<=8 or b in (63,64) or b>=115 else 'mf' if 53<=b<=62 or 81<=b<=112 else 'mp'
        dyn=base if leader(b)==pid else {'p':'pp','mp':'p','mf':'mp'}[base]
        n.direction(m,dynamic=dyn)
        if changed and b>0 and leader(b)==pid and b!=123:n.direction(m,text='Solo')
    if b==1 and (pid=='FL' or not full):n.direction(m,text='Opening harmony added to source N.C.')
    if b==81 and pid=='BS':n.direction(m,text='Light, rhythmic')
    if b==122:n.direction(m,text='Rit.')
def rest(m,on,dur,whole=False):
    if whole:
        note=n.el(m,'note');n.el(note,'rest',measure='yes');n.el(note,'duration',dur);return
    for d in n.chunks(on,dur) if dur else []:
        note=n.el(m,'note');n.el(note,'rest');n.el(note,'duration',d);typ,dot=n.VALUES[d];n.el(note,'type',typ)
        if dot:n.el(note,'dot')
        on+=d

def write_event(m,e):
    pid=e['part'];pitch=e['midi']+(2 if pid=='CL' else 0);step,alt=(CLAR_SPELL if pid=='CL' else SHARP)[pitch%12]
    chunks=n.chunks(e['on'],e['dur'])
    for j,d in enumerate(chunks):
        note=n.el(m,'note');p=n.el(note,'pitch');n.el(p,'step',step)
        if alt:n.el(p,'alter',alt)
        n.el(p,'octave',(pitch-alt-n.STEP[step])//12-1);n.el(note,'duration',d)
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

def build(root,events,plan,selected,full=False):
    s=E.Element('score-partwise',version='4.0');n.el(n.el(s,'work'),'work-title','Washed - Wind Auto')
    ident=copy.deepcopy(root.find('identification'))
    # This source has malformed lyricist placeholder text, not a person credit.
    for x in list(ident):
        if x.tag=='creator' and x.get('type')=='lyricist' and 'Hard return' in (x.text or ''):ident.remove(x)
    credit=E.Element('creator',type='arranger');credit.text='Wind arrangement: editorial edition'
    position=next((i for i,x in enumerate(ident) if x.tag!='creator'),len(ident))
    ident.insert(position,credit)
    encoding=ident.find('encoding')
    if encoding is not None:
        encoding.find('software').text='Codex-assisted Python MusicXML generator'
        encoding.find('encoding-date').text='2026-10-02'
    s.append(ident)
    defaults=n.el(s,'defaults');sc=n.el(defaults,'scaling');n.el(sc,'millimeters',6 if full else 7);n.el(sc,'tenths',40)
    w,h=(1400,1980) if full else (1200,1697);pg=n.el(defaults,'page-layout');n.el(pg,'page-height',h);n.el(pg,'page-width',w)
    ma=n.el(pg,'page-margins',type='both')
    for tag in ('left-margin','right-margin','top-margin','bottom-margin'):n.el(ma,tag,65)
    texts=[('title','Washed - Wind Auto',22,h-70),('subtitle','Wind quartet; Bb clarinet (transposed) | Rhythm source: Grant Wall / Daniel Galbraith' if full else PARTS[selected[0]][0]+' | Wind Auto',10,h-115),('composer','Joe L. Barnes, Joshua Holiday and Mitch Wong',10,h-150)]
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
            if not full and b==119:n.el(m,'print',**{'new-system':'yes'})
            if b==0:
                a=n.el(m,'attributes');n.el(a,'divisions',8);n.el(n.el(a,'key'),'fifths',7 if pid=='CL' else 5)
                tm=n.el(a,'time');n.el(tm,'beats',4);n.el(tm,'beat-type',4)
                cl=n.el(a,'clef');n.el(cl,'sign',PARTS[pid][2]);n.el(cl,'line',PARTS[pid][3])
                if pid=='CL':tr=n.el(a,'transpose');n.el(tr,'diatonic',-1);n.el(tr,'chromatic',-2)
            directions(m,b,pid,full)
            harmonies=[hh for hh in plan if hh['bar']==b and hh['origin']!='carried source harmony'] if pid=='FL' or not full else []
            for x in src.findall("barline[@location='left']"):m.append(n.clean(x))
            seq=[e for e in events if e['part']==pid and e['bar']==b]
            points=sorted({0,meta['length']}|{hh['on'] for hh in harmonies}|{t for e in seq for t in (e['on'],e['on']+e['dur'])})
            # Place each harmony at the actual XML cursor, rather than relying
            # on importers to honor harmony offsets. Split sustained notes with
            # ties when a harmony falls inside the note; sound stays identical.
            for on,end in zip(points,points[1:]):
                for hh in harmonies:
                    if hh['on']==on:
                        x=transpose_harmony(hh['xml']) if pid=='CL' else n.clean(hh['xml'])
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
    assert len(score.findall('part'))==4
    assert decode(score)==collections.Counter((e['part'],e['bar'],t,e['midi']) for e in events for t in range(e['on'],e['on']+e['dur']))
    # Exact opening pitches, timing, rests (implicitly), and ties survive.
    expected=[(x['bar'],x['on'],x['dur'],x['midi'],{t.get('type') for t in x['xml'].findall('tie')}) for x in records if x['bar']<=8 and x['classification']=='pitched notation']
    actual=[(e['bar'],e['on'],e['dur'],e['midi'],({'start'} if e['tie_start'] else set())|({'stop'} if e['tie_stop'] else set())) for e in events if e['part']=='FL' and e['bar']<=8]
    assert actual==expected,'Opening melody altered'
    exported=score.find("part[@id='FL']").findall('measure')
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
        if e['layer']=='accompaniment':
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
            'breathing':breath_audit(events),'lead_handoffs':{b:leader(b) for b in range(124) if b==0 or leader(b)!=leader(b-1)},
            'clarinet_transposition':'Written major second above concert; C# major; diatonic -1, chromatic -2',
            'review_status':'Structural checks; PDF engraving and player review are separate.'}

def serial_plan(plan):return [{k:v for k,v in h.items() if k!='xml'} for h in plan]

def main():
    root,records,hs,plan=read_source();events=compose(records,plan);score=build(root,events,plan,list(PARTS),True)
    report=validate(root,records,hs,plan,events,score);jobs=[]
    for name,tree in [('washed-wind-auto',score)]+[(f'washed-{pid}',build(root,events,plan,[pid])) for pid in PARTS]:
        f=OUT/(name+'.musicxml');E.ElementTree(tree).write(f,encoding='utf-8',xml_declaration=True)
        reopened=E.parse(f).getroot()
        if name=='washed-wind-auto':validate(root,records,hs,plan,events,reopened)
        else:
            pid=tree.find('part').get('id')
            assert decode(reopened)==collections.Counter((e['part'],e['bar'],t,e['midi']) for e in events if e['part']==pid for t in range(e['on'],e['on']+e['dur']))
        validate_written_harmony(reopened,hs,selected_pid=None if name=='washed-wind-auto' else pid)
        jobs.append({'in':str(f),'out':str(f.with_suffix('.pdf'))})
    audit={'source_note_classifications':dict(collections.Counter(x['classification'] for x in records)),
           'part_ranges':{pid:{'low_sounding_midi':min(e['midi'] for e in events if e['part']==pid),'high_sounding_midi':max(e['midi'] for e in events if e['part']==pid)} for pid in PARTS},
           'event_roles':dict(collections.Counter(e['role'] for e in events))}
    for name,data in [('harmony-plan',serial_plan(plan)),('arrangement-events',events),('validation',report),('source-audit',audit),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=="__main__":main()
