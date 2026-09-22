"""Living Hope: preserve source piano; compose five complementary string lines.
Python 3 standard library only. Run: python3 arrange.py
This is a piece-specific, auditable arrangement, not a general arranging engine.
"""
from pathlib import Path
import collections, copy, hashlib, itertools, json
import xml.etree.ElementTree as E

OUT=Path(__file__).resolve().parent
STEP={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
PARTS={'V1':('Violin I','Vln. I','G',2,41,67,84),
       'V2':('Violin II','Vln. II','G',2,41,60,77),
       'VA':('Viola','Vla.','C',3,42,48,70),
       'VC':('Violoncello','Vc.','F',4,43,36,62),
       'CB':('Double Bass','Cb.','F',4,44,28,47)}
SECTIONS={1:('Intro','pp'),5:('1 - Verse','p'),13:('2 - Verse continuation','mp'),
          24:('3 - Chorus','mf'),35:('4 - Later verse','p'),43:('Build','mf'),
          49:('5 - Final chorus','f'),57:('Closing refrain','mf'),62:('Release','p')}

def el(parent,tag,text=None,**attrs):
    n=E.SubElement(parent,tag,{k:str(v) for k,v in attrs.items()})
    if text is not None:n.text=str(text)
    return n

def canonical(x):
    return x.tag,tuple(sorted(x.attrib.items())),(x.text or '').strip(),tuple(canonical(c) for c in x)

def clean_layout(x):
    """Keep musical data; relocate an embedded title block to score credits.
    The original archive remains unchanged. Only engraving is normalized.
    """
    x=copy.deepcopy(x)
    for m in x.findall('measure'):
        m.attrib.pop('width',None)
        for p in m.findall('print'):m.remove(p)
        if m.get('number')=='2':
            for d in list(m.findall('direction')):
                words=d.findall('./direction-type/words')
                if words and all(not (w.text or '').strip() or 'Living Hope'==(w.text or '').strip() or 'praisecharts.com/71163' in (w.text or '') for w in words):
                    m.remove(d)
    for n in x.iter():
        for attr in ('default-x','default-y','relative-x','relative-y','end-length','font-family'):
            n.attrib.pop(attr,None)
    return x

def parse_chord(h):
    root=(STEP[h.findtext('root/root-step')]+int(h.findtext('root/root-alter','0')))%12
    kind=h.findtext('kind');intervals={'major':[0,4,7],'minor':[0,3,7],
        'minor-seventh':[0,3,7,10],'suspended-fourth':[0,5,7]}[kind]
    for d in h.findall('degree'):
        assert d.findtext('degree-type')=='add'
        degree=int(d.findtext('degree-value'));alter=int(d.findtext('degree-alter'))
        intervals.append([0,2,4,5,7,9,11][(degree-1)%7]+alter)
    bass=h.find('bass')
    basspc=(STEP[bass.findtext('bass-step')]+int(bass.findtext('bass-alter','0')))%12 if bass is not None else root
    name=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][root]
    name+= {'major':'','minor':'m','minor-seventh':'m7','suspended-fourth':'sus4'}[kind]
    if h.find('degree') is not None:name+='(add2)'
    if bass is not None:name+='/'+['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][basspc]
    return {'name':name,'root':root,'pcs':sorted({(root+i)%12 for i in intervals}),'bass':basspc}

def read_source():
    root=E.parse(OUT/'original-piano.musicxml').getroot();plan=[];notes=[];last=None
    for b,m in enumerate(root.findall('./part/measure'),1):
        at=0;previous=0;end=0;chords=[]
        for x in m:
            if x.tag=='attributes':
                if x.find('divisions') is not None:assert x.findtext('divisions')=='8'
                if x.find('time') is not None:assert x.findtext('time/beats')=='4' and x.findtext('time/beat-type')=='4'
            if x.tag=='backup':at-=int(x.findtext('duration'))
            elif x.tag=='forward':at+=int(x.findtext('duration'))
            elif x.tag=='harmony':chords.append((at+int(x.findtext('offset','0')),parse_chord(x)))
            elif x.tag=='note':
                dur=int(x.findtext('duration','0'));on=previous if x.find('chord') is not None else at
                if x.find('chord') is None:previous=at;at+=dur
                end=max(end,on+dur)
                if x.find('pitch') is not None:
                    p=x.find('pitch');midi=(int(p.findtext('octave'))+1)*12+STEP[p.findtext('step')]+int(p.findtext('alter','0'))
                    notes.append({'bar':b,'on':on,'dur':dur,'midi':midi,'staff':int(x.findtext('staff','1'))})
        assert end==32,(b,end)
        if not chords or chords[0][0]>0:
            assert last is not None;chords.insert(0,(0,last))
        for i,(on,h) in enumerate(chords):
            stop=chords[i+1][0] if i+1<len(chords) else 32
            assert stop>on
            plan.append(dict(h,bar=b,on=on,dur=stop-on))
        last=chords[-1][1]
    assert len(root.findall('./part/measure'))==62
    return root,plan,notes

def voicing(h,previous):
    """Local exhaustive search, respecting order, register and upper spacing.
    A common-tone and small-motion preference joins successive harmonies.
    """
    ids=('VC','VA','V2','V1');center=(48,57,65,75)
    ranges=((43,55),(53,65),(62,73),(70,82))
    opts=[[p for p in range(lo,hi+1) if p%12 in h['pcs']] for lo,hi in ranges]
    candidates=[]
    for v in itertools.product(*opts):
        if not all(v[i]<v[i+1] for i in range(3)):continue
        if any(v[i+1]-v[i]>12 for i in range(1,3)):continue
        motion=sum(abs(a-b) for a,b in zip(v,previous or center))
        leaps=sum(max(0,abs(a-b)-5)**2 for a,b in zip(v,previous or center))
        missing=len(set(h['pcs'])-{p%12 for p in v})
        cost=motion+2*leaps+12*missing+0.2*sum(abs(a-b) for a,b in zip(v,center))
        candidates.append((cost,v))
    return dict(zip(ids,min(candidates)[1]))

def nearest(pc,target,lo,hi):
    return min((p for p in range(lo,hi+1) if p%12==pc),key=lambda p:(abs(p-target),p))

def compose(plan):
    events=[];previous=None
    def add(pid,h,on,dur,p,role,slur=None,art=None,fermata=False):
        events.append(dict(part=pid,bar=h['bar'],on=on,dur=dur,midi=p,role=role,
                           slur=slur,art=art,fermata=fermata))
    def sustained(pid,h,p,role):
        # At 71 bpm, split a whole-bar support into two natural bow lengths.
        at=h['on'];remaining=h['dur']
        while remaining:
            dur=min(16,remaining);add(pid,h,at,dur,p,role);at+=dur;remaining-=dur
    for h in plan:
        b,on,dur=h['bar'],h['on'],h['dur'];v=voicing(h,previous)
        previous=[v[i] for i in ('VC','VA','V2','V1')];h['voicing']=v
        if b==1:continue  # piano establishes the opening sound
        if b==62:
            for pid in ('V1','V2','VA','VC'):
                add(pid,h,0,32,v[pid],'final tonic release',fermata=True)
            add('CB',h,0,32,39,'final tonic foundation',fermata=True)
            continue
        if b<=4:
            for pid in ('VA','V2'):sustained(pid,h,v[pid],'quiet introduction')
            if b==4:add('V1',h,16,16,v['V1'],'delayed upper entry')
            continue
        if b<=12:
            sustained('VA',h,v['VA'],'verse inner support')
            if dur==32:add('V2',h,16,16,v['V2'],'delayed verse support')
            else:add('V2',h,on,dur,v['V2'],'harmonic-change support')
            if b in (8,12):add('V1',h,16,16,v['V1'],'phrase-end halo')
            if b%2:sustained('VC',h,v['VC'],'sparse low warmth')
            continue
        chorus=24<=b<=34 or 49<=b<=61
        later=35<=b<=42
        for pid in ('V2','VC'):sustained(pid,h,v[pid],'sustained harmonic support')
        # Later verses use quiet quarter-note motion; choruses retain legato breadth.
        if later:
            for t in range(on,on+dur,8):
                add('VA',h,t,min(8,on+dur-t),v['VA'],'gentle repeated pulse',art='tenuto')
        else:sustained('VA',h,v['VA'],'inner harmonic thread')
        p=v['V1']
        # Answer on selected phrase tails; chord tones avoid inventing reharmonization.
        answer=(b in (16,18,20,23,26,28,31,33,44,46,48,51,53,56,58,60)) and on+dur==32 and dur>=16
        if answer:
            if dur>16:add('V1',h,on,dur-16,p,'held preparation')
            q=min((x for x in range(max(67,p-4),min(84,p+4)+1) if x%12 in h['pcs'] and x!=p),
                  key=lambda x:abs(x-p),default=p)
            for offset,length,pitch,sl in ((0,8,p,'start'),(8,4,q,None),(12,4,p,'stop')):
                add('V1',h,on+dur-16+offset,length,pitch,'short lyrical answer',slur=sl)
        elif later:
            if b in (38,42):sustained('V1',h,p,'restrained phrase arrival')
        else:sustained('V1',h,p,'upper sustained line')
        # Bass honors every explicit slash chord. No fifth-string extension needed.
        if chorus or 43<=b<=48 or b in (13,15,17,19,21,22,23):
            bass=nearest(h['bass'],36,28,47)
            sustained('CB',h,bass,'root or written inversion')
    return sorted(events,key=lambda e:(e['part'],e['bar'],e['on']))

def direction(m,text=None,dynamic=None,rehearsal=None):
    d=el(m,'direction',placement='above' if text or rehearsal else 'below');dt=el(d,'direction-type')
    if text:el(dt,'words',text)
    if dynamic:el(el(dt,'dynamics'),dynamic)
    if rehearsal:el(dt,'rehearsal',rehearsal)
    return d

def write_note(m,e,pid):
    n=el(m,'note');p=e.get('midi');dur=e['dur']
    if p is None:el(n,'rest',**({'measure':'yes'} if dur==32 else {}))
    else:
        p+=12 if pid=='CB' else 0
        step,alt=[('C',0),('D',-1),('D',0),('E',-1),('E',0),('F',0),('G',-1),('G',0),('A',-1),('A',0),('B',-1),('B',0)][p%12]
        pitch=el(n,'pitch');el(pitch,'step',step)
        if alt:el(pitch,'alter',alt)
        el(pitch,'octave',p//12-1)
    el(n,'duration',dur);el(n,'type',{4:'eighth',8:'quarter',12:'quarter',16:'half',24:'half',32:'whole'}[dur])
    if dur in (12,24):el(n,'dot')
    if any(e.get(k) for k in ('slur','art','fermata')):
        no=el(n,'notations')
        if e.get('slur'):el(no,'slur',type=e['slur'],number=1)
        if e.get('art'):el(el(no,'articulations'),e['art'])
        if e.get('fermata'):el(no,'fermata')

def rest(m,dur,pid):
    for d in (32,16,8,4):
        while dur>=d:write_note(m,{'dur':d},pid);dur-=d
    assert not dur

def build(root,events,selected,full=True):
    s=E.Element('score-partwise',version='4.0');el(el(s,'work'),'work-title','Living Hope')
    ident=copy.deepcopy(root.find('identification'));s.append(ident)
    credit=E.Element('creator',type='arranger');credit.text='Additional strings: editorial arrangement'
    ident.insert(len(ident.findall('creator')),credit)
    defaults=el(s,'defaults');sc=el(defaults,'scaling');el(sc,'millimeters',5.6 if full else 7);el(sc,'tenths',40)
    w,h=(1500,2121) if full else (1200,1697)
    pg=el(defaults,'page-layout');el(pg,'page-height',h);el(pg,'page-width',w)
    ma=el(pg,'page-margins',type='both')
    for t in ('left-margin','right-margin','top-margin','bottom-margin'):el(ma,t,70)
    for kind,text,size,y in [('title','Living Hope',24,h-65),('subtitle','Piano with Strings | Piano arrangement: Dan Galbraith',10,h-115),
        ('composer','Brian Johnson and Phil Wickham',10,h-155)]:
        cr=el(s,'credit',page=1);el(cr,'credit-type',kind);el(cr,'credit-words',text,**{'font-size':size,'default-x':w/2,'default-y':y,'justify':'center','valign':'top'})
    # Source attribution remains both machine-readable and visible, without
    # copying its old four-page pagination into the expanded orchestral score.
    cr=el(s,'credit',page=1);el(cr,'credit-type','rights')
    el(cr,'credit-words','Source: PraiseCharts #71163 | CCLI #7106807\nOriginal copyright and permissions notice retained in the supplied source and score metadata.',
       **{'font-size':6,'default-x':w/2,'default-y':35,'justify':'center','valign':'bottom'})
    pl=el(s,'part-list')
    if full:
        g=el(pl,'part-group',number=1,type='start');el(g,'group-symbol','bracket');el(g,'group-barline','yes')
    for idx,pid in enumerate(selected,2):
        name,abbr,clef,line,program,*_=PARTS[pid]
        sp=el(pl,'score-part',id=pid);el(sp,'part-name',name);el(sp,'part-abbreviation',abbr)
        ins=el(sp,'score-instrument',id=pid+'I');el(ins,'instrument-name',name)
        mi=el(sp,'midi-instrument',id=pid+'I');el(mi,'midi-channel',idx);el(mi,'midi-program',program)
    if full:
        el(pl,'part-group',number=1,type='stop')
        piano=copy.deepcopy(root.find('./part-list/score-part'))
        for tag,txt in [('part-name','Piano'),('part-abbreviation','Pno.')]:
            piano.find(tag).text=txt;piano.find(tag).attrib.pop('print-object',None)
        pl.append(piano)
    sourcebars=clean_layout(root.find('part')).findall('measure')
    for pid in selected:
        part=el(s,'part',id=pid)
        for b,source in enumerate(sourcebars,1):
            m=el(part,'measure',number=source.get('number'))
            if full and b%4==1:el(m,'print',**({'new-system':'yes'} if b>1 else {}))
            if not full and b==35:el(m,'print',**{'new-page':'yes'})
            if b==1:
                a=el(m,'attributes');el(a,'divisions',8);el(el(a,'key'),'fifths',-3)
                tm=el(a,'time');el(tm,'beats',4);el(tm,'beat-type',4)
                cl=el(a,'clef');el(cl,'sign',PARTS[pid][2]);el(cl,'line',PARTS[pid][3])
                if pid=='CB':tr=el(a,'transpose');el(tr,'diatonic',0);el(tr,'chromatic',0);el(tr,'octave-change',-1)
                direction(m,text='Arco, dolce; discreet bow changes. Piano prominent.')
                if not full or pid=='V1':
                    d=direction(m,text='Quarter note = 71');el(d,'sound',tempo=71)
            if b in SECTIONS:
                title,dyn=SECTIONS[b]
                if not full or pid=='V1':direction(m,rehearsal=title)
                direction(m,dynamic='mp' if pid=='CB' and dyn=='f' else dyn)
            if b==35:direction(m,text='Second time: grow toward the chorus.' if pid=='V1' or not full else 'Poco a poco cresc.')
            for bl in source.findall("barline[@location='left']"):m.append(copy.deepcopy(bl))
            at=0
            for e in (x for x in events if x['part']==pid and x['bar']==b):
                assert e['on']>=at,(pid,b)
                rest(m,e['on']-at,pid);write_note(m,e,pid);at=e['on']+e['dur']
            rest(m,32-at,pid)
            for bl in source.findall('barline'):
                if bl.get('location')!='left':m.append(copy.deepcopy(bl))
    if full:s.append(clean_layout(root.find('part')))
    E.indent(s);return s

def validate(root,score,events,plan):
    assert canonical(clean_layout(root.find('part')))==canonical(clean_layout(score.findall('part')[-1])),'Original piano changed'
    bars=clean_layout(root.find('part')).findall('measure')
    for part in score.findall('part')[:-1]:
        pid=part.get('id');actual=[];assert len(part.findall('measure'))==62
        active_slur=False
        for b,m in enumerate(part.findall('measure'),1):
            at=0
            for n in m.findall('note'):
                assert n.find('chord') is None
                d=int(n.findtext('duration'));p=n.find('pitch')
                if p is not None:
                    midi=(int(p.findtext('octave'))+1)*12+STEP[p.findtext('step')]+int(p.findtext('alter','0'))-(12 if pid=='CB' else 0)
                    assert PARTS[pid][-2]<=midi<=PARTS[pid][-1]
                    actual.append((b,at,d,midi))
                for sl in n.findall('./notations/slur'):
                    if sl.get('type')=='start':assert not active_slur;active_slur=True
                    else:assert active_slur;active_slur=False
                at+=d
            assert at==32,(pid,b,at)
            assert [canonical(x) for x in m.findall('barline')]==[canonical(x) for x in bars[b-1].findall('barline')]
        assert not active_slur
        assert actual==[(e['bar'],e['on'],e['dur'],e['midi']) for e in events if e['part']==pid]
    for e in events:
        h=next(h for h in plan if h['bar']==e['bar'] and h['on']<=e['on']<h['on']+h['dur'])
        assert e['on']+e['dur']<=h['on']+h['dur']
        assert e['midi']%12 in ([h['bass']] if e['part']=='CB' else h['pcs'])
    return {'piano_musical_content_preserved':True,'measures':62,'string_notes':len(events),
            'notes_by_part':dict(collections.Counter(e['part'] for e in events)),
            'all_string_parts_monophonic':True,'source_repeats_and_endings_preserved':True,
            'source_sha256':hashlib.sha256((OUT/'original-piano.musicxml').read_bytes()).hexdigest()}

def main():
    root,plan,notes=read_source();events=compose(plan);score=build(root,events,list(PARTS))
    report=validate(root,score,events,plan);report['piano_pitched_segments']=len(notes)
    jobs=[]
    for name,tree in [('living-hope-piano-and-strings',score)]+[(f'living-hope-{pid}',build(root,events,[pid],False)) for pid in PARTS]:
        file=OUT/(name+'.musicxml');E.ElementTree(tree).write(file,encoding='utf-8',xml_declaration=True)
        jobs.append({'in':str(file),'out':str(file.with_suffix('.pdf'))})
    for name,data in [('arrangement-events',events),('harmonic-plan',plan),('validation',report),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
