"""Washed - Jazz Band: source-aware standalone jazz-funk/gospel arrangement.
Internal data use sounding pitches; the exporter handles saxophones, trumpets,
guitar/bass octave notation, piano polyphony, and unpitched drum instruments.
Python 3 standard library. Piece-specific form and editorial phrases.
"""
from pathlib import Path
import collections,copy,hashlib,itertools,json
import xml.etree.ElementTree as E
import notation as n
OUT=Path(__file__).resolve().parent
PARTS={
 'AS1':('Alto Saxophone 1 in E-flat','A. Sax. 1','G',2,66,55,81),
 'AS2':('Alto Saxophone 2 in E-flat','A. Sax. 2','G',2,66,55,79),
 'TS1':('Tenor Saxophone 1 in B-flat','T. Sax. 1','G',2,67,49,76),
 'TS2':('Tenor Saxophone 2 in B-flat','T. Sax. 2','G',2,67,46,73),
 'BS':('Baritone Saxophone in E-flat','B. Sax.','G',2,68,37,65),
 'TP1':('Trumpet 1 in B-flat','Tpt. 1','G',2,57,54,82),
 'TP2':('Trumpet 2 in B-flat','Tpt. 2','G',2,57,54,79),
 'TP3':('Trumpet 3 in B-flat','Tpt. 3','G',2,57,52,77),
 'TP4':('Trumpet 4 in B-flat','Tpt. 4','G',2,57,52,75),
 'TB1':('Trombone 1','Tbn. 1','F',4,58,40,74),
 'TB2':('Trombone 2','Tbn. 2','F',4,58,40,69),
 'TB3':('Trombone 3','Tbn. 3','F',4,58,38,65),
 'BT':('Bass Trombone','B. Tbn.','F',4,58,34,60),
 'PI':('Piano','Pno.','G',2,1,48,84),
 'GT':('Rhythm Guitar','Gtr.','G',2,27,48,72),
 'BA':('Acoustic Bass','Bass','F',4,33,28,55),
 'DR':('Drum Set','Dr.','percussion',0,1,0,127),
}
TRANSPOSE={'AS1':(5,9),'AS2':(5,9),'TS1':(8,14),'TS2':(8,14),'BS':(12,21),
           'TP1':(1,2),'TP2':(1,2),'TP3':(1,2),'TP4':(1,2),'GT':(7,12),'BA':(7,12)}
BARS=[]
KINDS={'major':[0,4,7],'major-sixth':[0,4,7,9],'minor-seventh':[0,3,7,10],
       'suspended-fourth':[0,5,7],'suspended-second':[0,2,7],'dominant':[0,4,7,10],'none':[]}
SHARP=(('C',0),('C',1),('D',0),('D',1),('E',0),('F',0),('F',1),('G',0),('G',1),('A',0),('A',1),('B',0))
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


def transferred(line,pid,b,shift=0,role='source pitched cue',layer='lead'):
    if not line:return []
    lo,hi=PARTS[pid][-2:]
    while min(x['midi']+shift for x in line)<lo:shift+=12
    while max(x['midi']+shift for x in line)>hi:shift-=12
    assert min(x['midi']+shift for x in line)>=lo,(pid,b,'cue span')
    result=[lift(x,pid,b,shift,role) for x in line]
    for e in result:e['layer']=layer;e['octave_shift']=shift
    return result


SAX=('BS','TS2','TS1','AS2','AS1')
TPT=('TP4','TP3','TP2','TP1');TBN=('BT','TB3','TB2','TB1')
WINDS=tuple(p for p in PARTS if p not in ('PI','GT','BA','DR'))
SCALE={11,1,3,4,6,8,10}
FLAT=(('C',0),('D',-1),('D',0),('E',-1),('E',0),('F',0),('G',-1),('G',0),('A',-1),('A',0),('B',-1),('B',0))
DRUMS={'kick':(36,'F',4,'normal'),'snare':(38,'C',5,'normal'),'hat':(42,'G',5,'x'),
       'ride':(51,'F',5,'x'),'crash':(49,'A',5,'x'),'tom':(45,'A',4,'normal')}

def spelling(pid):return FLAT if pid in SAX+TPT else SHARP

def leader(b):
    if b<=12 or 29<=b<=36 or 53<=b<=62 or 81<=b<=88:return 'AS1'
    if 13<=b<=28 or 105<=b<=112:return 'TS1'
    if 37<=b<=52 or 113<=b<=114:return 'TB1'
    if b in (63,64):return 'TS2'
    if 65<=b<=80:return ('AS1','TS1')[((b-65)//4)%2]
    if 89<=b<=104:return 'TP1' if b<=92 or b>=97 and b<=100 else 'AS1'
    if 115<=b<=122:return 'AS1' if ((b-115)//2)%2==0 else 'TS1'
    return 'AS1'

def h_at(plan,b,on):return next(h for h in plan if h['bar']==b and h['on']<=on<h['on']+h['dur'])

def near(h,target,pid,pcs=None):
    lo,hi=PARTS[pid][-2:];pcs=h['pcs'] if pcs is None else pcs
    return min((p for p in range(lo,hi+1) if p%12 in pcs),key=lambda p:(abs(p-target),p))

def add(events,pid,b,on,dur,pitches,role,layer='accompaniment',staff=1,art=None,sources=()):
    if dur<=0:return
    pitches=[pitches] if isinstance(pitches,(int,str)) else list(pitches)
    assert pitches and len(pitches)==len(set(pitches))
    if pid=='DR':assert all(p in DRUMS for p in pitches);e=event(pid,b,on,dur,0,role,sources)
    else:
        assert all(PARTS[pid][-2]<=p<=PARTS[pid][-1] for p in pitches),(pid,pitches)
        e=event(pid,b,on,dur,max(pitches),role,sources)
    e.update(pitches=pitches,layer=layer,staff=staff,art=art);events.append(e);return e

def lead_lines(records,plan):
    events=[];cues=set();centers={'AS1':73,'TS1':66,'TS2':61,'TB1':57,'TP1':74}
    for meta in BARS:
        b=meta['bar'];pid=leader(b);line=upper_line(records,b)
        if b<=8:events.extend(transferred(line,pid,b,role='source opening melody'))
        elif 29<=b<=36 or 53<=b<=60:
            events.extend(transferred(upper_line(records,b-28 if b<=36 else b-52),pid,b,role='editorial return of opening theme'))
            if line:
                events.extend(transferred(line,'AS2',b,-12,'source guitar cue in alto saxophone','source cue'));cues.add(('AS2',b))
        elif b in (19,20,43,44,61,62):events.extend(transferred(line,pid,b,-12,'source turnaround cue'))
        elif b in (27,28,51,52):events.extend(transferred(upper_line(records,19 if b%2 else 20),pid,b,-12,'editorial return of source turnaround'))
        elif 65<=b<=104:
            if line:events.extend(transferred(line,pid,b,12 if b in (65,66) else -12 if b in (89,90,97,98) else 0,'source bridge riff in jazz register'))
            else:
                for x in upper_line(records,65 if b%2 else 66):
                    h=h_at(plan,b,x['on']);target=centers[pid]+x['midi']-59+((h['root']-11+6)%12-6)
                    events.append(event(pid,b,x['on'],x['dur'],near(h,target,pid),'editorial sequence of source bridge riff',[x['id']]))
        elif 113<=b<=114:events.extend(transferred(line,pid,b,-24,'source descending second-ending cue'))
        elif 115<=b<=122:events.extend(transferred(line,pid,b,12,'source closing upper line'))
        elif b==123:events.append(event(pid,b,0,32,71,'editorial final tonic'))
        elif b in (63,64):events.append(event(pid,b,0,24,66,'quiet transition fifth'))
        else:
            pattern=[(4,8,0),(12,4,2),(16,8,4),(24,4,2),(28,4,0)] if b%2 else [(0,12,4),(12,4,2),(16,8,0)]
            for on,dur,degree in pattern:
                h=h_at(plan,b,on);events.append(event(pid,b,on,dur,near(h,centers[pid]+degree-2,pid),'new motivic continuation'))
            if 9<=b<=18 and line:
                events.extend(transferred(line,'AS2',b,0,'source introduction cue in alto saxophone','source cue'));cues.add(('AS2',b))
    return events,cues

def color_harmony(h):
    """Add selected diatonic color; preserve printed source symbol separately."""
    pcs=set(h['pcs']);extra=[]
    intervals=(9,2) if h['kind'] in ('major','major-sixth') else (2,) if h['kind']=='minor-seventh' else ()
    for interval in intervals:
        pc=(h['root']+interval)%12
        if pc in SCALE and pc not in pcs:pcs.add(pc);extra.append(pc)
    h['arrangement_pcs']=sorted(pcs);h['added_color_pcs']=extra
    return sorted(pcs)

def section_voice(h,ids,centers,old,events):
    b=h['bar'];fixed=[e['midi'] for e in events if e['bar']==b and e['layer'] in ('lead','source cue') and e['on']<h['on']+h['dur'] and e['on']+e['dur']>h['on']]
    free=[(pid,c) for pid,c in zip(ids,centers) if not any(e['part']==pid and e['bar']==b and e['layer'] in ('lead','source cue') for e in events)]
    lead=[e['midi'] for e in events if e['bar']==b and e['layer']=='lead' and e['on']<h['on']+h['dur'] and e['on']+e['dur']>h['on']]
    ceiling=min(lead)-1 if ids==SAX and leader(b)=='AS1' and lead else 127
    states=[(0,{},None,set())]
    for pid,c in free:
        lo,hi=PARTS[pid][-2:];opts=[p for p in range(max(lo,c-7),min(hi,c+7,ceiling)+1) if p%12 in h['arrangement_pcs']];new=[]
        if pid=='BS' and (29<=b<=36 or 53<=b<=62 or 65<=b<=104):opts=[p for p in opts if p%12==h['bass']]
        for cost,v,last,pcs in states:
            for p in opts:
                if last is not None and (p<=last or p-last==1 or pid!='BS' and p-last>12):continue
                movement=abs(p-old.get(pid,c));local=movement+2*max(0,movement-5)**2+.3*abs(p-c)
                local+=sum(4 if abs(p-q)==1 else 1 if p==q else 0 for q in fixed)
                new.append((cost+local,{**v,pid:p},p,pcs|{p%12}))
        assert new,(b,pid,'no section voicing');states=sorted(new,key=lambda s:(s[0]+4*len(set(h['arrangement_pcs'])-s[3]),tuple(s[1].values())))[:64]
    v=min(states,key=lambda s:s[0]+4*len(set(h['arrangement_pcs'])-s[3]))[1];old.update(v);return v

def piano_lh_classes(h):
    r=h['root']
    if h['kind']=='minor-seventh':return {(r+3)%12,(r+10)%12}
    if h['kind'] in ('major','major-sixth'):return {(r+4)%12,(r+9)%12}
    if h['kind']=='dominant':return {(r+(4 if (r+4)%12 in h['pcs'] else 5))%12,(r+10)%12}
    if h['kind']=='suspended-fourth':return {r,(r+5)%12}
    if h['kind']=='suspended-second':return {(r+2)%12,(r+7)%12}
    raise AssertionError(h['kind'])

def piano_voicing(h,previous):
    pcs=set(h['arrangement_pcs']);rootless=h['kind'] in ('major','major-sixth','minor-seventh')
    if rootless:pcs.discard(h['root'])
    options=[p for p in range(49,78) if p%12 in pcs];best=None
    for lh in itertools.combinations([p for p in options if p<=61],2):
        if lh[-1]-lh[0]>9:continue
        if {p%12 for p in lh}!=piano_lh_classes(h):continue
        for rh in itertools.combinations([p for p in options if p>=61],3):
            if lh[-1]>=rh[0] or rh[-1]-rh[0]>12 or len({p%12 for p in lh+rh})<min(4,len(pcs)):continue
            old=previous or (52,58,64,69,74);v=lh+rh
            movement=sum(abs(p-q)+max(0,abs(p-q)-5)**2 for p,q in zip(v,old))
            cost=movement+.3*sum(abs(p-c) for p,c in zip(v,(52,58,64,69,74)))+4*len(pcs-{p%12 for p in v})
            if best is None or (cost,v)<best:best=(cost,v)
    assert best is not None,(h['bar'],h['kind'],pcs,'piano voicing')
    return best[1][:2],best[1][2:],rootless

def compose(records,plan):
    events,cues=lead_lines(records,plan);old={};piano_previous=None;bass_previous=35
    def occupied(pid,b):return any(e['part']==pid and e['bar']==b for e in events)
    for i,h in enumerate(plan):
        b,a,end=h['bar'],h['on'],h['on']+h['dur'];pcs=color_harmony(h);h['voicing']={}
        if b==0:continue
        verse=9<=b<=28 or 37<=b<=52 or 105<=b<=112
        walking=29<=b<=36 or 53<=b<=62 or 65<=b<=104
        # Sax choir rotates between pads, offbeat figures, and rhythmic shout cells.
        if b==123:sax={}
        else:sax=section_voice(h,SAX,(47,56,62,68,73),old,events)
        h['voicing']['saxophones']=sax
        for pid,p in sax.items():
            if b==123:continue
            if verse:
                on=max(a,4);stop=min(end,24 if b%2==0 else 28)
                cells=[(on,stop-on)] if on<stop and b%4 in (1,2) else [(t,min(4,end-t)) for t in (12,28) if a<=t<end and b%4 in (0,3)]
            elif 65<=b<=104:cells=[(t,min(4,end-t)) for t in (0,12,20,28) if a<=t<end]
            else:
                on=max(a,0 if b%2 else 4);stop=min(end,24 if b%2 else 28);cells=[(on,stop-on)] if on<stop else []
            for on,dur in cells:add(events,pid,b,on,dur,p,'saxophone harmonic response',art='tenuto' if dur>8 else 'staccato')
        # Alternating brass responses; full choir at selected peak cadences.
        use_tpt=b in (32,36,56,60,62,80,88,96,100,104,114) or 89<=b<=104 and b%4==1
        use_tbn=b in (8,28,36,52,60,62,72,80,88,96,100,104,112,114) or 53<=b<=62 and b%4==1
        for label,ids,centers,enabled in [('trumpets',TPT,(60,65,70,76),use_tpt),('trombones',TBN,(42,49,55,61),use_tbn)]:
            if not enabled or b==123:continue
            vv=section_voice(h,ids,centers,old,events);h['voicing'][label]=vv
            for pid,p in vv.items():
                for on in (0,12,24) if b>=81 else (12,24):
                    if a<=on<end:add(events,pid,b,on,min(4,end-on),p,'brass syncopated punch',art='accent')
        # Rootless (where appropriate), playable-width two-hand piano voicings.
        lh,rh,rootless=piano_voicing(h,piano_previous);piano_previous=lh+rh
        h['voicing']['piano_lh']=lh;h['voicing']['piano_rh']=rh;h['piano_rootless']=rootless
        if b==123:continue
        if b in (63,64):positions=[a] if a==0 else []
        elif b<=8 or b>=115:positions=[a]
        else:positions=sorted({a}|{t for t in (4,20) if a<=t<end})
        for on in positions:
            dur=min(8 if b<=8 or b>=115 else 4,end-on)
            add(events,'PI',b,on,dur,lh,'piano guide-tone comp',staff=2)
            add(events,'PI',b,on,dur,rh,'piano color voicing',staff=1)
        # Guitar comping occupies complementary offbeats, rather than copying piano.
        if b>=9 and b not in (63,64):
            candidates=[v for v in itertools.combinations([p for p in range(50,67) if p%12 in pcs],3) if v[-1]-v[0]<=9 and len({p%12 for p in v})==3]
            gv=min(candidates,key=lambda v:sum(abs(p-c) for p,c in zip(v,(54,59,63)))+2*len(set(h['pcs'])-{p%12 for p in v}))
            h['voicing']['guitar']=gv
            for on in (12,28):
                if a<=on<end and (b%2 or walking):add(events,'GT',b,on,min(4,end-on),gv,'guitar offbeat comp',art='staccato')
        # Bass attack at every actual chord change preserves slash-bass identity.
        grid=(0,8,16,24) if walking else (0,16)
        positions=sorted({a}|{t for t in grid if a<=t<end})
        for j,on in enumerate(positions):
            pc=h['bass'] if on==a else pcs[(j+2)%len(pcs)]
            p=n.octave(pc,bass_previous,28,50);next_on=positions[j+1] if j+1<len(positions) else end;dur=next_on-on
            if walking and j==len(positions)-1 and dur>=8 and end%8==0 and h['dur']>=16 and b not in (58,60,110,112) and i+1<len(plan):
                target=n.octave(plan[i+1]['bass'],p,28,50)
                approach=min((q for q in (target-1,target+1) if 28<=q<=50),key=lambda q:(abs(q-p),q))
                add(events,'BA',b,on,dur-4,p,'walking bass chord tone')
                e=add(events,'BA',b,next_on-4,4,approach,'chromatic bass approach',layer='bass approach');e['resolution_target']=target;bass_previous=approach
            else:add(events,'BA',b,on,dur,p,'walking bass chord tone' if walking else 'two-feel bass');bass_previous=p
    # Drum groove: straight eighths, kick on 1/3, snare on 2/4; short fills.
    for b in range(5,123):
        if b in (63,64):continue
        big=29<=b<=36 or 53<=b<=62 or 65<=b<=104
        fill=b in (28,36,52,60,62,80,88,96,104,112,114)
        for on in range(0,32,4):
            if fill and on>=24:
                add(events,'DR',b,on,4,['snare' if on==24 else 'tom'],'drum fill')
                continue
            sounds=['ride' if big else 'hat']
            if on in (0,16):sounds.append('kick')
            if on in (8,24):sounds.append('snare')
            add(events,'DR',b,on,4,sounds,'straight-eighth drum groove')
    final={'AS2':66,'TS1':63,'TS2':59,'BS':47,'TP1':78,'TP2':75,'TP3':71,'TP4':66,'TB1':59,'TB2':54,'TB3':47,'BT':42,'BA':35}
    for pid,p in final.items():add(events,pid,123,0,32,p,'final B-major voicing')
    add(events,'PI',123,0,32,[51,59],'final piano tonic',staff=2);add(events,'PI',123,0,32,[66,71,75],'final piano tonic',staff=1)
    add(events,'GT',123,0,32,[54,59,63],'final guitar tonic');add(events,'DR',123,0,32,['crash','kick'],'final drum release')
    plan[-1]['arrangement_pcs']=list(plan[-1]['pcs']);plan[-1]['added_color_pcs']=[];plan[-1]['piano_rootless']=False
    plan[-1]['voicing']={'saxophones':{'AS1':71,**{p:v for p,v in final.items() if p in SAX}},'trumpets':{p:v for p,v in final.items() if p in TPT},'trombones':{p:v for p,v in final.items() if p in TBN},'piano_lh':[51,59],'piano_rh':[66,71,75],'guitar':[54,59,63]}
    # A quarter rest at alternate wind/brass solo endings; opening sax tune intact.
    for b in range(9,123):
        pid=leader(b)
        if b%2:continue
        for e in list(events):
            if e['part']==pid and e['bar']==b and e['layer']=='lead' and e['on']+e['dur']>24:
                e['dur']=24-e['on'];e['tie_start']=False;e['breath_trimmed']=True
                if e['dur']<=0:events.remove(e)
    events.sort(key=lambda e:(list(PARTS).index(e['part']),e.get('staff',1),e['bar'],e['on']))
    for pid in WINDS:
        seq=[e for e in events if e['part']==pid]
        def contiguous(x,y):return BARS[x['bar']]['start']+x['on']+x['dur']==BARS[y['bar']]['start']+y['on'] and x['midi']==y['midi']
        for i,e in enumerate(seq):
            if e['tie_stop'] and (i==0 or not seq[i-1]['tie_start'] or not contiguous(seq[i-1],e)):e['tie_stop']=False
            if e['tie_start'] and (i+1==len(seq) or not seq[i+1]['tie_stop'] or not contiguous(e,seq[i+1])):e['tie_start']=False
        for b in range(124):
            for beat in (0,8,16,24):
                group=[e for e in seq if e['bar']==b and beat<=e['on'] and e['on']+e['dur']<=beat+8 and e['layer'] in ('lead','source cue')]
                if len(group)>=2 and all(not e['tie_start'] and not e['tie_stop'] for e in group) and all(x['midi']!=y['midi'] and abs(x['midi']-y['midi'])<=7 and x['on']+x['dur']==y['on'] for x,y in zip(group,group[1:])):group[0]['slur']='start';group[-1]['slur']='stop'
    return events

def directions(m,b,pid,full):
    if b in LABEL and (pid=='AS1' or not full):n.direction(m,rehearsal=LABEL[b])
    if b==0 and (pid=='AS1' or not full):
        d=n.direction(m,text='Quarter = 139; jazz-funk / gospel; straight eighths');n.el(d,'sound',tempo=139)
    if b==0:n.direction(m,text='Light tongue; no mutes' if pid in WINDS else 'Pizz.; two-feel / walking' if pid=='BA' else 'Straight eighths; light groove' if pid=='DR' else 'Comp lightly; leave space')
    changed=b==0 or leader(b)!=leader(b-1)
    if changed or b in LABEL:
        base='p' if b<=8 or b in (63,64) or b>=115 else 'f' if 89<=b<=104 else 'mf' if 29<=b<=36 or 53<=b<=62 or 65<=b<=112 else 'mp'
        dyn=base if leader(b)==pid else {'p':'pp','mp':'p','mf':'mp','f':'mf'}[base]
        if pid in ('PI','GT','BA','DR'):dyn='p' if base in ('p','mp') else 'mp'
        n.direction(m,dynamic=dyn)
        if changed and b>0 and leader(b)==pid and b!=123:n.direction(m,text='Lead / foreground')
    if b==1 and (pid=='AS1' or not full):n.direction(m,text='Opening harmony added to source N.C.')
    if b==81 and pid=='AS1':n.direction(m,text='Shout texture; bright but buoyant')
    if b==122:n.direction(m,text='Rit.')
    if b==123 and pid=='DR':n.direction(m,text='Let cymbal ring; cue release')


def rest(m,on,dur,whole=False,staff=1,piano=False):
    for d in [dur] if whole else n.chunks(on,dur):
        note=n.el(m,'note');n.el(note,'rest',**({'measure':'yes'} if whole else {}));n.el(note,'duration',d);n.el(note,'voice',staff)
        if not whole:
            typ,dot=n.VALUES[d];n.el(note,'type',typ)
            if dot:n.el(note,'dot')
        if piano:n.el(note,'staff',staff)
        on+=d

def write_event(m,e):
    pid=e['part'];staff=e.get('staff',1);pitches=e.get('pitches',[e['midi']]);chunks=n.chunks(e['on'],e['dur'])
    for j,d in enumerate(chunks):
        for k,pitch in enumerate(pitches):
            note=n.el(m,'note')
            if k:n.el(note,'chord')
            if pid=='DR':
                gm,step,octv,head=DRUMS[pitch];u=n.el(note,'unpitched');n.el(u,'display-step',step);n.el(u,'display-octave',octv)
            else:
                written=pitch+TRANSPOSE.get(pid,(0,0))[1];step,alt=spelling(pid)[written%12]
                p=n.el(note,'pitch');n.el(p,'step',step)
                if alt:n.el(p,'alter',alt)
                n.el(p,'octave',(written-alt-n.STEP[step])//12-1)
            n.el(note,'duration',d)
            stop=e['tie_stop'] or j>0;start=e['tie_start'] or j<len(chunks)-1
            if stop:n.el(note,'tie',type='stop')
            if start:n.el(note,'tie',type='start')
            if pid=='DR':n.el(note,'instrument',id='DR_'+pitch)
            n.el(note,'voice',staff);typ,dot=n.VALUES[d];n.el(note,'type',typ)
            if dot:n.el(note,'dot')
            if pid=='DR':n.el(note,'stem','up');n.el(note,'notehead',head)
            if pid=='PI':n.el(note,'staff',staff)
            no=n.el(note,'notations')
            if stop:n.el(no,'tied',type='stop')
            if start:n.el(no,'tied',type='start')
            if k==0 and j==0 and e['slur']=='start':n.el(no,'slur',type='start',number=1)
            if k==0 and j==len(chunks)-1 and e['slur']=='stop':n.el(no,'slur',type='stop',number=1)
            if j==0 and e['art']:n.el(n.el(no,'articulations'),e['art'])
            if e['bar']==123:n.el(no,'fermata')
            if not len(no):note.remove(no)

def transpose_harmony(harmony,pid):
    h=n.clean(harmony);shift=TRANSPOSE[pid][1]
    for tag in ('root','bass'):
        x=h.find(tag)
        if x is None:continue
        step=x.find(tag+'-step');alter=x.find(tag+'-alter');pc=(n.STEP[step.text]+int(alter.text if alter is not None else 0)+shift)%12
        letter,acc=spelling(pid)[pc];step.text=letter
        if alter is not None:x.remove(alter)
        if acc:x.insert(1,E.Element(tag+'-alter'));x.find(tag+'-alter').text=str(acc)
    return h


def playback_route():
    """Unfold the two explicit source repeats for an independent breath audit."""
    return list(range(53))+list(range(53,61))+list(range(53,59))+list(range(61,105))+list(range(105,113))+list(range(105,111))+list(range(113,124))


def build(root,events,plan,selected,full=False):
    s=E.Element('score-partwise',version='4.0');n.el(n.el(s,'work'),'work-title','Washed - Jazz Band')
    ident=copy.deepcopy(root.find('identification'))
    for x in list(ident):
        if x.tag=='creator' and x.get('type')=='lyricist' and 'Hard return' in (x.text or ''):ident.remove(x)
    credit=E.Element('creator',type='arranger');credit.text='Jazz-band arrangement: editorial edition'
    ident.insert(next((i for i,x in enumerate(ident) if x.tag!='creator'),len(ident)),credit)
    encoding=ident.find('encoding')
    if encoding is not None:encoding.find('software').text='Codex-assisted Python MusicXML generator';encoding.find('encoding-date').text='2026-10-06'
    s.append(ident);defs=n.el(s,'defaults');sc=n.el(defs,'scaling');n.el(sc,'millimeters',5 if full else 7);n.el(sc,'tenths',40)
    w,h=(2376,3360) if full else (1200,1697);pg=n.el(defs,'page-layout');n.el(pg,'page-height',h);n.el(pg,'page-width',w)
    ma=n.el(pg,'page-margins',type='both')
    for tag in ('left-margin','right-margin','top-margin','bottom-margin'):n.el(ma,tag,65)
    title='Washed - Jazz Band';subtitle='17-piece big band | Jazz-funk / gospel | Transposed score; concert chords' if full else PARTS[selected[0]][0]+' | Jazz-funk / gospel'
    for kind,text,size,y in [('title',title,22,h-70),('subtitle',subtitle,10,h-115),('composer','Joe L. Barnes, Joshua Holiday and Mitch Wong',10,h-150)]:
        cr=n.el(s,'credit',page=1);n.el(cr,'credit-type',kind);n.el(cr,'credit-words',text,**{'font-size':size,'default-x':w/2,'default-y':y,'justify':'center','valign':'top'})
    pl=n.el(s,'part-list');families=(('Saxophones',('AS1','AS2','TS1','TS2','BS')),('Trumpets',('TP1','TP2','TP3','TP4')),('Trombones',('TB1','TB2','TB3','BT')),('Rhythm section',('PI','GT','BA','DR')))
    groups={p:(i,name) for i,(name,ids) in enumerate(families,1) for p in ids}
    for i,pid in enumerate(selected,1):
        group,family=groups[pid]
        if full and (i==1 or groups[selected[i-2]][0]!=group):
            gr=n.el(pl,'part-group',number=group,type='start');n.el(gr,'group-name',family);n.el(gr,'group-symbol','bracket');n.el(gr,'group-barline','yes')
        name,abbr,clef,line,program,lo,hi=PARTS[pid];sp=n.el(pl,'score-part',id=pid);n.el(sp,'part-name',name);n.el(sp,'part-abbreviation',abbr)
        if pid=='DR':
            for sound,(gm,step,octv,head) in DRUMS.items():
                ins=n.el(sp,'score-instrument',id='DR_'+sound);n.el(ins,'instrument-name',sound.title())
                mi=n.el(sp,'midi-instrument',id='DR_'+sound);n.el(mi,'midi-channel',10);n.el(mi,'midi-unpitched',gm+1)
        else:
            ins=n.el(sp,'score-instrument',id=pid+'I');n.el(ins,'instrument-name',name)
            mi=n.el(sp,'midi-instrument',id=pid+'I');n.el(mi,'midi-program',program)
        if full and (i==len(selected) or groups[selected[i]][0]!=group):n.el(pl,'part-group',number=group,type='stop')
    for pid in selected:
        part=n.el(s,'part',id=pid)
        for meta in BARS:
            b=meta['bar'];src=meta['xml'];m=n.el(part,'measure',number=src.get('number'),**({'implicit':'yes'} if b==0 else {}))
            if full and b>1 and b%4==1:n.el(m,'print',**{'new-page':'yes'})
            if not full and (b in range(17,124,16) if pid=='PI' else b in (29,65,97)):n.el(m,'print',**{'new-page':'yes'})
            if b==0:
                a=n.el(m,'attributes');n.el(a,'divisions',8)
                if pid!='DR':n.el(n.el(a,'key'),'fifths',-4 if pid in ('AS1','AS2','BS') else -5 if pid in ('TS1','TS2')+TPT else 5)
                tm=n.el(a,'time');n.el(tm,'beats',4);n.el(tm,'beat-type',4)
                if pid=='PI':n.el(a,'staves',2);n.el(a,'part-symbol','brace')
                cl=n.el(a,'clef',**({'number':1} if pid=='PI' else {}));n.el(cl,'sign',PARTS[pid][2])
                if pid!='DR':n.el(cl,'line',PARTS[pid][3])
                if pid=='PI':cl=n.el(a,'clef',number=2);n.el(cl,'sign','F');n.el(cl,'line',4)
                if pid in TRANSPOSE:
                    dia,chrom=TRANSPOSE[pid];octaves=chrom//12;tr=n.el(a,'transpose');n.el(tr,'diatonic',-(dia-7*octaves));n.el(tr,'chromatic',-(chrom%12))
                    if octaves:n.el(tr,'octave-change',-octaves)
            directions(m,b,pid,full)
            harmonies=[h for h in plan if h['bar']==b and h['origin']!='carried source harmony'] if pid=='AS1' or not full and pid!='DR' else []
            for x in src.findall("barline[@location='left']"):m.append(n.clean(x))
            for staff in (1,2) if pid=='PI' else (1,):
                if staff==2:n.el(n.el(m,'backup'),'duration',meta['length'])
                seq=[e for e in events if e['part']==pid and e['bar']==b and e.get('staff',1)==staff]
                hs=harmonies if staff==1 else []
                points=sorted({0,meta['length']}|{h['on'] for h in hs}|{t for e in seq for t in (e['on'],e['on']+e['dur'])})
                for on,end in zip(points,points[1:]):
                    for h in hs:
                        if h['on']==on:
                            x=transpose_harmony(h['xml'],pid) if not full and pid in TRANSPOSE else n.clean(h['xml'])
                            for off in x.findall('offset'):x.remove(off)
                            m.append(x)
                    active=[e for e in seq if e['on']<=on<e['on']+e['dur']];assert len(active)<=1,(pid,b,on,staff,'overlap')
                    if not active:rest(m,on,end-on,whole=not seq and on==0 and end==32,staff=staff,piano=pid=='PI')
                    else:
                        e=active[0];piece=dict(e,on=on,dur=end-on,tie_stop=e['tie_stop'] or on>e['on'],tie_start=e['tie_start'] or end<e['on']+e['dur'],slur=e['slur'] if e['slur']=='start' and on==e['on'] or e['slur']=='stop' and end==e['on']+e['dur'] else None)
                        write_event(m,piece)
                # Beam only first chord heads, separately by staff/voice.
                virtual=E.Element('measure')
                for note in m.findall('note'):
                    if note.find('chord') is None and int(note.findtext('voice','1'))==staff:virtual.append(note)
                n.beam_measure(virtual)
            for x in src.findall('barline'):
                if x.get('location')!='left':m.append(n.clean(x))
    E.indent(s);return s

def expected(events):
    return collections.Counter((e['part'],e['bar'],t,p,e.get('staff',1)) for e in events for t in range(e['on'],e['on']+e['dur']) for p in e.get('pitches',[e['midi']]))

def decode(score,performed=False):
    result=[]
    for part in score.findall('part'):
        pid=part.get('id');measures=part.findall('measure');shift=0;active={};slurs={};elapsed=0
        if pid=='DR':
            drum_part=score.find("part-list/score-part[@id='DR']")
            for sound,info in DRUMS.items():
                mapping=drum_part.find(f"midi-instrument[@id='DR_{sound}']")
                assert mapping is not None and int(mapping.findtext('midi-unpitched'))==info[0]+1
                assert mapping.findtext('midi-channel')=='10'
        for idx in playback_route() if performed else range(124):
            m=measures[idx];b=BARS[idx]['bar'];at=prior=0;totals=collections.Counter()
            tr=measures[0].find('attributes/transpose')
            if tr is not None:shift=int(tr.findtext('chromatic'))+12*int(tr.findtext('octave-change','0'))
            for note in m:
                if note.tag=='backup':at-=int(note.findtext('duration'));continue
                if note.tag!='note':continue
                dur=int(note.findtext('duration'));staff=int(note.findtext('staff','1'));on=prior if note.find('chord') is not None else at
                if note.find('chord') is None:prior=at;at+=dur;totals[staff]+=dur
                rests=note.find('rest')
                if rests is None or rests.get('measure')!='yes':
                    typ,dot=n.VALUES[dur];assert note.findtext('type')==typ and (note.find('dot') is not None)==dot
                if rests is not None:continue
                if pid=='DR':
                    pitch=note.find('instrument').get('id').removeprefix('DR_');assert pitch in DRUMS
                    gm,step,octv,head=DRUMS[pitch]
                    assert note.findtext('unpitched/display-step')==step and note.findtext('unpitched/display-octave')==str(octv)
                    assert note.findtext('notehead')==head
                else:pitch=midi(note.find('pitch'))+shift
                result.extend((pid,b,t,pitch,staff) for t in range(on,on+dur))
                key=(staff,pitch);start=elapsed+on;ties={t.get('type') for t in note.findall('tie')}
                if 'stop' in ties:assert active.pop(key,None)==start,(pid,b,key,'unmatched tie')
                if 'start' in ties:assert key not in active;active[key]=start+dur
                for x in note.findall('./notations/slur'):
                    if x.get('type')=='start':assert not slurs.get(staff,False);slurs[staff]=True
                    else:assert slurs.get(staff,False);slurs[staff]=False
            assert totals==collections.Counter({staff:BARS[idx]['length'] for staff in ((1,2) if pid=='PI' else (1,))}),(pid,b,totals)
            elapsed+=BARS[idx]['length']
        assert not active and not any(slurs.values()),(pid,active,slurs)
    return collections.Counter(result)

def validate_written_harmony(score,source_harmonies,selected_pid=None):
    pid=selected_pid or 'AS1'
    if pid=='DR':return
    part=score.find(f"part[@id='{pid}']");shift=TRANSPOSE.get(pid,(0,0))[1]%12 if selected_pid else 0
    for h in source_harmonies:
        if h['bar']<=8:continue
        at=prior=0;candidates=[]
        for x in part.findall('measure')[h['bar']]:
            if x.tag=='note' and x.find('chord') is None:at+=int(x.findtext('duration'))
            elif x.tag=='backup':at-=int(x.findtext('duration'))
            elif x.tag=='harmony':candidates.append((at,x))
        hh=chord(next(x for t,x in candidates if t==h['on']),h['bar'],h['on'])
        assert hh['root']==(h['root']+shift)%12 and hh['bass']==(h['bass']+shift)%12
        assert hh['kind']==h['kind'] and hh['pcs']==sorted((p+shift)%12 for p in h['pcs'])

def activity_audit(events):
    route=playback_route();total=sum(BARS[b]['length'] for b in route);result={}
    for pid in PARTS:
        occupied=sum(len({t for e in events if e['part']==pid and e['bar']==b for t in range(e['on'],e['on']+e['dur'])}) for b in route)
        result[pid]={'nominal_sounding_percent':round(100*occupied/total,1),'fully_silent_numbered_measures':[b for b in range(1,124) if not any(e['part']==pid and e['bar']==b for e in events)]}
    return result

def breath_audit(events):
    result={}
    for pid in WINDS:
        timeline=[]
        for b in playback_route():
            active={t for e in events if e['part']==pid and e['bar']==b for t in range(e['on'],e['on']+e['dur'])};timeline.extend(t in active for t in range(BARS[b]['length']))
        best=run=gap=0
        for occupied in timeline:
            if occupied:
                if gap>=4:run=0
                run+=gap if gap<4 else 0;gap=0;run+=1;best=max(best,run)
            else:gap+=1
        assert best<=96,(pid,'no eighth-rest breath opportunity within 12 quarters',best)
        result[pid]={'longest_run_quarters':best/8,'seconds_at_139':round(best/8*60/139,2)}
    return result

def validate_musical_constraints(events,plan):
    for pid in PARTS:
        for staff in (1,2) if pid=='PI' else (1,):
            for b in range(124):
                seq=sorted((e for e in events if e['part']==pid and e['bar']==b and e.get('staff',1)==staff),key=lambda e:e['on'])
                assert all(x['on']+x['dur']<=y['on'] for x,y in zip(seq,seq[1:])),(pid,b,staff,'overlap')
                for e in seq:
                    ps=e.get('pitches',[e['midi']])
                    if pid=='DR':assert len(ps)<=3 and all(p in DRUMS for p in ps);continue
                    assert all(PARTS[pid][-2]<=p<=PARTS[pid][-1] for p in ps)
                    if e['layer']=='accompaniment':
                        h=h_at(plan,b,e['on']);assert e['on']+e['dur']<=h['on']+h['dur']
                        assert all(p%12 in set(h['arrangement_pcs'])|{h['bass']} for p in ps),(pid,b,e['role'],ps)
                    if pid=='PI':assert ps==sorted(ps) and ps[-1]-ps[0]<=12
                    if pid=='PI' and b!=123:
                        h=h_at(plan,b,e['on'])
                        if h['piano_rootless']:assert all(p%12!=h['root'] for p in ps)
                        if staff==2:assert {p%12 for p in ps}==piano_lh_classes(h)
                    if pid=='GT':assert ps[-1]-ps[0]<=9 and len(ps)==3
    # Inspect chromatic bass resolutions along both actual ending/repeat routes.
    pending=None
    for b in playback_route():
        for e in sorted((e for e in events if e['part']=='BA' and e['bar']==b),key=lambda e:e['on']):
            if pending is not None:assert e['midi']==pending,(b,'unresolved bass approach');pending=None
            if e['role']=='chromatic bass approach':
                assert e['on']%8==4 and abs(e['midi']-e['resolution_target'])==1;pending=e['resolution_target']
    assert pending is None;breath_audit(events)

def validate(root,records,hs,plan,events,score):
    assert len(score.findall('part'))==17
    assert decode(score)==expected(events)
    performed_expected=collections.Counter()
    perbar=collections.Counter(playback_route())
    for key,count in expected(events).items():performed_expected[key]=count*perbar[key[1]]
    assert decode(score,True)==performed_expected
    validate_musical_constraints(events,plan)
    original=[(x['bar'],x['on'],x['dur'],x['midi'],{t.get('type') for t in x['xml'].findall('tie')}) for x in records if x['bar']<=8 and x['classification']=='pitched notation']
    actual=[(e['bar'],e['on'],e['dur'],e['midi'],({'start'} if e['tie_start'] else set())|({'stop'} if e['tie_stop'] else set())) for e in events if e['part']=='AS1' and e['bar']<=8]
    assert actual==original,'Opening melody changed';validate_written_harmony(score,hs)
    for part in score.findall('part'):
        assert len(part.findall('measure'))==124
        for meta,m in zip(BARS,part.findall('measure')):
            assert [n.canonical(n.clean(x)) for x in meta['xml'].findall('barline')]==[n.canonical(x) for x in m.findall('barline')]
    return {'source_type':'Rhythm chart with partial melody and pitched cues; not complete vocal lead sheet','parts':17,'staves_including_piano_grand_staff':18,'numbered_measures':123,'pickup_units':8,'opening_melody_segments':len(original),'source_chord_symbols':len(hs),'opening_preserved':True,'printed_chords_from_measure_9_preserved':True,'repeats_and_endings_preserved':True,'score_part_pitch_timing_ties_checked':True,'performed_repeat_route_visits':len(playback_route()),'arrangement_event_count':len(events),'breathing':breath_audit(events),'activity':activity_audit(events),'source_hashes':{name:hashlib.sha256((OUT/name).read_bytes()).hexdigest() for name in ('source-rhythm.musicxml','source-rhythm.pdf')},'review_status':'Structural checks complete; visual, audio, and live-player review are distinct stages.'}

def serial_plan(plan):return [{k:v for k,v in h.items() if k!='xml'} for h in plan]

def main():
    root,records,hs,plan=read_source();events=compose(records,plan);score=build(root,events,plan,list(PARTS),True)
    report=validate(root,records,hs,plan,events,score);jobs=[]
    for name,tree in [('washed-jazz-band',score)]+[(f'washed-{pid}',build(root,events,plan,[pid])) for pid in PARTS]:
        f=OUT/(name+'.musicxml');E.ElementTree(tree).write(f,encoding='utf-8',xml_declaration=True);reopened=E.parse(f).getroot()
        if name=='washed-jazz-band':validate(root,records,hs,plan,events,reopened)
        else:
            pid=tree.find('part').get('id');assert decode(reopened)==expected([e for e in events if e['part']==pid]);validate_written_harmony(reopened,hs,pid)
        jobs.append({'in':str(f),'out':str(f.with_suffix('.pdf'))})
    audit={'source_note_classifications':dict(collections.Counter(x['classification'] for x in records)),
           'part_ranges':{pid:{'low_sounding_midi':min(p for e in events if e['part']==pid for p in e.get('pitches',[e['midi']])),'high_sounding_midi':max(p for e in events if e['part']==pid for p in e.get('pitches',[e['midi']]))} for pid in PARTS if pid!='DR'},'event_roles':dict(collections.Counter(e['role'] for e in events))}
    for name,data in [('harmony-plan',serial_plan(plan)),('arrangement-events',events),('validation',report),('source-audit',audit),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
