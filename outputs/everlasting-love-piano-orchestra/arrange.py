"""The Everlasting Love of God: unchanged piano with restrained orchestral accompaniment.
Standard-library Python. Piece-specific composition with inspectable density and source checks.
"""
from pathlib import Path
import copy,collections,itertools,json,hashlib
import xml.etree.ElementTree as E
import notation as n
from piano_layout import clean_layout
OUT=Path(__file__).resolve().parent
STRINGS=('V1','V2','VA','VC','CB');WOODS=('FL1','FL2','OB','CL','BN')
BRASS=('H1','H2','T1','T2','TB1','TB3','BT','TU');PERC=('TI',)
FAMILIES={'strings':STRINGS,'woodwinds':WOODS,'brass':BRASS,'percussion':PERC}
LABEL={1:'Introduction',4:'A - Verse 1',14:'B - Verse 2',22:'C - Chorus',31:'D - Verse 3',
40:'E - Instrumental',46:'F - Verse 4',57:'G - Chorus',65:'H - Chorus',75:'Closing',79:'Final release'}
NAMES=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']

def harmony(root):
    result=[];last=None
    kinds={'major':[0,4,7],'minor':[0,3,7],'minor-seventh':[0,3,7,10],
           'major-seventh':[0,4,7,11],'major-ninth':[0,4,7,11,14],
           'suspended-fourth':[0,5,7],'power':[0,7]}
    for b,m in enumerate(root.findall('./part/measure'),1):
        at=0;found=[]
        for x in m:
            if x.tag=='backup':at-=int(x.findtext('duration'))
            elif x.tag=='forward':at+=int(x.findtext('duration'))
            elif x.tag=='note' and x.find('chord') is None:at+=int(x.findtext('duration','0'))
            elif x.tag=='harmony':
                rt=(n.STEP[x.findtext('root/root-step')]+int(x.findtext('root/root-alter','0')))%12
                kind=x.findtext('kind');intervals=list(kinds[kind])
                for d in x.findall('degree'):
                    deg=int(d.findtext('degree-value'));alt=int(d.findtext('degree-alter'));base=[0,2,4,5,7,9,11][(deg-1)%7]
                    action=d.findtext('degree-type')
                    if action in ('alter','subtract'):intervals=[i for i in intervals if i%12!=base]
                    if action in ('add','alter'):intervals.append(base+alt)
                bs=x.find('bass');bass=(n.STEP[bs.findtext('bass-step')]+int(bs.findtext('bass-alter','0')))%12 if bs is not None else rt
                h={'bar':b,'on':at+int(x.findtext('offset','0')),'root':rt,'bass':bass,'kind':kind,'pcs':sorted({(rt+i)%12 for i in intervals})}
                found.append(h)
        if not found or found[0]['on']>0:
            assert last is not None;found.insert(0,dict(last,bar=b,on=0))
        for i,h in enumerate(found):
            h['dur']=(found[i+1]['on'] if i+1<len(found) else n.BARS[b-1]['length'])-h['on'];assert h['dur']>0
            result.append(h)
        last=found[-1]
    return result

def near(pc,target,lo,hi):return n.octave(pc,target,lo,hi)

def voice(h,previous,piano):
    """Four-note ordered chord search, minimizing motion and close piano-line friction."""
    ids=('VC','VA','V2','V1');centers=(48,57,64,71);ranges=((43,55),(53,65),(60,72),(65,77))
    opts=[[p for p in range(lo,hi+1) if p%12 in h['pcs']] for lo,hi in ranges]
    tops=[]
    for tick in range(h['on'],h['on']+h['dur'],4):
        active=[x['midi'] for x in piano if x['bar']==h['bar'] and x['staff']==1 and x['on']<=tick<x['on']+x['dur']]
        if active:tops.append(max(active))
    best=None
    for pitches in itertools.product(*opts):
        if not all(pitches[i]<pitches[i+1] for i in range(3)):continue
        if any(pitches[i+1]-pitches[i]>12 for i in range(1,3)):continue
        old=previous or centers
        motion=sum(abs(p-q) for p,q in zip(pitches,old));leap=sum(max(0,abs(p-q)-5)**2 for p,q in zip(pitches,old))
        friction=sum(abs(pitches[-1]-top)==1 for top in tops)
        missing=len(set(h['pcs'])-{p%12 for p in pitches})
        cost=motion+2*leap+5*missing+3*friction+sum(abs(p-c) for p,c in zip(pitches,centers))*.25
        if best is None or (cost,pitches)<best:best=(cost,pitches)
    return dict(zip(ids,best[1]))

def compose(plan,piano):
    events=[];previous=None
    def add(pid,h,on,dur,pitch,role,slur=None):
        if dur<=0:return
        assert on>=h['on'] and on+dur<=h['on']+h['dur'],(pid,h,on,dur)
        lo,hi=n.PARTS[pid][-2:];assert lo<=pitch<=hi,(pid,pitch)
        events.append(dict(part=pid,bar=h['bar'],on=on,dur=dur,midi=pitch,role=role,
                           slur=slur,breath=False,trim=0,tie_start=False,tie_stop=False))
    for h in plan:
        b,a,d=h['bar'],h['on'],h['dur'];end=a+d;L=n.BARS[b-1]['length'];v=voice(h,previous,piano)
        previous=[v[x] for x in ('VC','VA','V2','V1')];h['voicing']=v
        big=22<=b<=30 or 40<=b<=45 or 57<=b<=73
        # Unbroken harmonic presence in strings; no piano melody copying.
        for pid in ('V1','V2','VC'):
            if pid=='V1' and big and d>=16 and b%4==0:
                # Develop a short chord-tone neighbor figure by sequence.
                p=v[pid];alts=[q for q in range(max(65,p-4),min(77,p+4)+1) if q%12 in h['pcs'] and q!=p]
                q=min(alts,key=lambda q:abs(q-p),default=p)
                add(pid,h,a,d-8,p,'cantabile string support')
                add(pid,h,end-8,4,q,'developed chord-tone figure','start');add(pid,h,end-4,4,p,'figure return','stop')
            else:add(pid,h,a,d,v[pid],'sustained harmonic strand')
        if big and d>=16:
            for off in range(4,d,8):add('VA',h,a+off,min(4,d-off),v['VA'],'light syncopated inner pulse')
        else:add('VA',h,a,d,v['VA'],'warm inner strand')
        # Sparse bass avoids heavy duplication of the pianist's left hand.
        bass=near(h['bass'],36,28,45)
        if b%2==0 or big or b in (1,79):add('CB',h,a,min(d,16),bass,'light harmonic foundation')
        # Woodwind duet colors: rotate pairs, favor later beats and phrase ends.
        pairs=(('CL','BN'),('OB','CL'),('FL1','OB'),('FL2','BN'))
        if b%4 in (0,2) or b in (29,45,57,65,79):
            pair=pairs[(b//4)%4]
            for j,pid in enumerate(pair):
                length=min(12 if b==79 else 8,max(0,d-4));start=end-length-4
                if length==0:continue
                target={'FL1':76,'FL2':72,'OB':67,'CL':60,'BN':48}[pid]
                ref=v['V1'] if pid.startswith('FL') else v['V2'] if pid in ('OB','CL') else v['VC']
                pitch=near(ref%12,target,*n.PARTS[pid][-2:])
                add(pid,h,start,length,pitch,'short woodwind reply')
        # Brass only at selected arrivals, always briefer than woodwind activity.
        if b in (22,29,40,45,57,65,73,79) and a==0:
            parts=('H1','H2') if b in (22,40) else ('H1','H2','T1','TB1') if b in (29,57,65) else ('T2','TB3','BT','TU') if b in (45,73) else ('H1','H2','T1','T2','TB1','TB3','BT','TU')
            for pid in parts:
                ref=v['V2'] if pid in ('H1','T1') else v['VA'] if pid in ('H2','T2','TB1') else v['VC']
                pc=h['bass'] if pid in ('BT','TU') else ref%12
                target={'H1':58,'H2':53,'T1':67,'T2':63,'TB1':53,'TB3':48,'BT':41,'TU':34}[pid]
                add(pid,h,a,min(8,d),near(pc,target,*n.PARTS[pid][-2:]),'reserved brass arrival')
        # F2/C3 drums articulate large arrivals and a few internal pulses.
        if b in (22,29,40,45,57,61,65,69,73,79):
            pc=h['bass'] if h['bass'] in (0,5) else h['root'] if h['root'] in (0,5) else None
            if pc is not None:
                add('TI',h,a,min(4,d),41 if pc==5 else 48,'soft timpani punctuation')
                if big and d>=24 and b in (40,57,65):add('TI',h,a+16,4,41 if pc==5 else 48,'secondary rhythmic pulse')
    # Sustain common tones across harmony changes and barlines in bowed strings.
    events.sort(key=lambda e:(list(n.PARTS).index(e['part']),e['bar'],e['on']))
    for pid in STRINGS:
        seq=[e for e in events if e['part']==pid]
        for x,y in zip(seq,seq[1:]):
            if x['midi']==y['midi'] and n.BARS[x['bar']-1]['start']+x['on']+x['dur']==n.BARS[y['bar']-1]['start']+y['on'] and not x['slur'] and not y['slur']:
                # Keep bow/sustain groups at two bars maximum.
                if x['bar']==y['bar'] or x['bar']%2==1:x['tie_start']=True;y['tie_stop']=True
    return events

def fake_sources(events):
    notes=[]
    for i,e in enumerate(events):
        sid=f'orchestra-{i+1}';e['sources']=[sid];e['chain']=sid;e['source_midi']=e['midi']
        note=E.Element('note');p=n.el(note,'pitch');m=e['midi'];step,alt=[('C',0),('D',-1),('D',0),('E',-1),('E',0),('F',0),('G',-1),('G',0),('A',-1),('A',0),('B',-1),('B',0)][m%12]
        n.el(p,'step',step)
        if alt:n.el(p,'alter',alt)
        n.el(p,'octave',m//12-1)
        if e['bar']==79 and e['on']+e['dur']==n.BARS[-1]['length']:n.el(n.el(note,'notations'),'fermata')
        notes.append(dict(id=sid,xml=note))
    return notes

def build(root,events,notes,selected,full):
    # Reuse tested pitch/duration writer; replace the transcription's directions.
    s=n.build(root,notes,events,collections.defaultdict(list),selected,full)
    for cr in s.findall('./identification/creator'):
        if cr.get('type')=='arranger' and 'editorial' in (cr.text or ''):cr.text='Additional orchestra: editorial accompaniment'
    for c in s.findall('credit'):
        if c.findtext('credit-type')=='subtitle':c.find('credit-words').text='Piano with Orchestra | Original piano: Jeff Moore'
    for part in s.findall('part'):
        pid=part.get('id');family=next(f for f,ids in FAMILIES.items() if pid in ids)
        for b,m in enumerate(part.findall('measure'),1):
            for d in list(m.findall('direction')):m.remove(d)
            def put(d):
                m.remove(d);idx=next((i for i,x in enumerate(m) if x.tag in ('note','barline')),len(m));m.insert(idx,d)
            if b==1:
                text={'strings':'Dolce, sotto il pianoforte; arco. Stagger bow changes.',
                      'woodwinds':'Dolce; short replies beneath the piano.',
                      'brass':'Sempre sotto; blend, never cover the piano.',
                      'percussion':'F2 / C3; soft mallets. Damp at rests; no rolls.'}[family]
                put(n.direction(m,text=text))
                if not full or pid=='FL1':
                    d=n.direction(m,text='Quarter note = 72');n.el(d,'sound',tempo=72);put(d)
            if b in LABEL:
                if not full or pid=='FL1':put(n.direction(m,rehearsal=LABEL[b]))
                dyn='pp' if family in ('brass','percussion') else 'mp' if b in (22,40,57,65) else 'p'
                put(n.direction(m,dynamic=dyn))
            if b==78:put(n.direction(m,text='Molto rit. - follow piano'))
            # Copy source navigation glyphs, omitting its piano dynamics.
            for src in root.findall('./part/measure')[b-1].findall('direction'):
                if src.find('.//segno') is not None or src.find('.//coda') is not None:
                    d=copy.deepcopy(src)
                    for x in list(d):
                        if x.tag in ('staff','offset'):d.remove(x)
                    for x in d.iter():
                        for at in ('default-x','default-y','relative-x','relative-y','font-family'):x.attrib.pop(at,None)
                    m.append(d);put(d)
    if full:
        pl=s.find('part-list');sp=copy.deepcopy(root.find('./part-list/score-part'))
        for tag,text in [('part-name','Piano'),('part-abbreviation','Pno.')]:sp.find(tag).text=text;sp.find(tag).attrib.pop('print-object',None)
        # Piano gets its own MIDI port so it cannot share a program with a wind.
        for x in list(sp):
            if x.tag in ('midi-instrument','midi-device'):sp.remove(x)
        n.el(sp,'midi-device',port=3);mi=n.el(sp,'midi-instrument',id=sp.find('score-instrument').get('id'));n.el(mi,'midi-channel',1);n.el(mi,'midi-program',1)
        pl.append(sp);s.append(clean_layout(root.find('part')))
        # A3-size page: 21 staves, four bars per page.
        s.find('./defaults/scaling/millimeters').text='5.2'
        s.find('./defaults/page-layout/page-width').text='2285';s.find('./defaults/page-layout/page-height').text='3230'
    E.indent(s);return s

def density(events):
    def block(first,last):
        total=sum(n.BARS[b-1]['length'] for b in range(first,last+1));out={}
        for fam,ids in FAMILIES.items():
            es=[e for e in events if e['part'] in ids and first<=e['bar']<=last]
            ticks=sum(e['dur'] for e in es)
            out[fam]={'notes':len(es),'part_beats':ticks/8,'mean_part_activity_percent':round(100*ticks/(total*len(ids)),2)}
        return out
    starts=sorted(set(LABEL)-{79});blocks=[]
    for i,a in enumerate(starts):
        z=starts[i+1]-1 if i+1<len(starts) else 79
        blocks.append({'first_bar':a,'last_bar':z,'families':block(a,z)})
    return {'whole_piece':block(1,79),'sections':blocks}

def validate(root,score,events,plan):
    assert n.canonical(clean_layout(root.find('part')))==n.canonical(clean_layout(score.findall('part')[-1])),'Piano musical content changed'
    # Notation library decoder reads monophonic orchestra only.
    tmp=copy.deepcopy(score);tmp.remove(tmp.findall('part')[-1])
    expected=collections.Counter((e['part'],e['bar'],t,e['midi']) for e in events for t in range(e['on'],e['on']+e['dur']))
    assert n.decode(tmp)==expected
    for e in events:
        h=next(h for h in plan if h['bar']==e['bar'] and h['on']<=e['on']<h['on']+h['dur'])
        assert e['on']+e['dur']<=h['on']+h['dur']
        assert e['midi']%12 in (set(h['pcs'])|{h['bass']})
        assert n.PARTS[e['part']][-2]<=e['midi']<=n.PARTS[e['part']][-1]
    for part in tmp.findall('part'):
        for orig,m in zip(root.findall('./part/measure'),part.findall('measure')):
            assert [n.canonical(n.clean(x)) for x in orig.findall('barline')]==[n.canonical(x) for x in m.findall('barline')]
    report=density(events)
    for b in [{'families':report['whole_piece']}]+report['sections']:
        f=b['families']
        assert f['strings']['part_beats']>f['woodwinds']['part_beats']>f['brass']['part_beats'],b
        assert f['strings']['mean_part_activity_percent']>f['woodwinds']['mean_part_activity_percent']>f['brass']['mean_part_activity_percent'],b
    return {'piano_musical_content_preserved':True,'measures':79,'orchestral_notes':len(events),'family_hierarchy_passed_each_section':True,
            'source_sha256':hashlib.sha256((OUT/'original-piano.musicxml').read_bytes()).hexdigest()}

def main():
    root,source,_=n.read_source();plan=harmony(root);events=compose(plan,source);notes=fake_sources(events)
    score=build(root,events,notes,list(n.PARTS),True);report=validate(root,score,events,plan)
    jobs=[]
    for name,tree in [('everlasting-love-piano-orchestra',score)]+[(f'everlasting-love-{pid}',build(root,events,notes,[pid],False)) for pid in n.PARTS]:
        file=OUT/(name+'.musicxml');E.ElementTree(tree).write(file,encoding='utf-8',xml_declaration=True);jobs.append({'in':str(file),'out':str(file.with_suffix('.pdf'))})
    for name,data in [('harmony-plan',plan),('arrangement-events',events),('validation',report),('family-balance',density(events)),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2));print(json.dumps(density(events)['whole_piece'],indent=2))
if __name__=='__main__':main()
