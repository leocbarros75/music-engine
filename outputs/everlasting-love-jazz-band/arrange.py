"""Piece-specific jazz ballad accompaniment; the supplied piano is protected.

Run with Python 3. No third-party library is needed to generate MusicXML.
All event pitches are sounding MIDI numbers; transposition happens at export.
"""
from pathlib import Path
import collections, copy, hashlib, itertools, json
import xml.etree.ElementTree as E
import source as n
from harmony import harmony

OUT=Path(__file__).resolve().parent
# name, abbreviation, clef, GM program, sounding range, written-up (diatonic, semitones)
PARTS={
 'AS1':('Alto Saxophone 1 in Eb','A. Sax. 1','G',66,(58,81),(5,9)),
 'AS2':('Alto Saxophone 2 in Eb','A. Sax. 2','G',66,(55,77),(5,9)),
 'TS1':('Tenor Saxophone 1 in Bb','T. Sax. 1','G',67,(49,73),(8,14)),
 'TS2':('Tenor Saxophone 2 in Bb','T. Sax. 2','G',67,(46,69),(8,14)),
 'BS':('Baritone Saxophone in Eb','B. Sax.','G',68,(37,62),(12,21)),
 'TP1':('Trumpet 1 in Bb','Tpt. 1','G',57,(55,79),(1,2)),
 'TP2':('Trumpet 2 in Bb','Tpt. 2','G',57,(55,76),(1,2)),
 'TP3':('Trumpet 3 in Bb','Tpt. 3','G',57,(53,74),(1,2)),
 'TP4':('Trumpet 4 in Bb','Tpt. 4','G',57,(52,72),(1,2)),
 'TB1':('Trombone 1','Tbn. 1','F',58,(43,69),(0,0)),
 'TB2':('Trombone 2','Tbn. 2','F',58,(40,65),(0,0)),
 'TB3':('Trombone 3','Tbn. 3','F',58,(38,62),(0,0)),
 'BT':('Bass Trombone','B. Tbn.','F',58,(34,58),(0,0)),
 'GT':('Rhythm Guitar','Gtr.','G',27,(48,72),(7,12)),
 'BA':('Acoustic Bass','Bass','F',44,(28,55),(7,12)),
 'DR':('Drum Set','Dr.','percussion',1,(0,127),(0,0)),
}
SAX=('BS','TS2','TS1','AS2','AS1')
TPT=('TP4','TP3','TP2','TP1');TBN=('BT','TB3','TB2','TB1')
LABEL={1:'Introduction',4:'A - Verse 1',14:'B - Verse 2',22:'C - Chorus',31:'D - Verse 3',
       40:'E - Instrumental',46:'F - Verse 4',57:'G - Chorus',65:'H - Chorus',75:'Closing',79:'Final release'}
DRUMS={'kick':('Bass drum',36,'F',4,'normal'),
       'snare':('Snare / brushes',38,'C',5,'normal'),
       'hat':('Closed hi-hat',42,'G',5,'x'),
       'ride':('Ride cymbal',51,'F',5,'x')}

def piano_layout(part):
    """Remove only coordinates, forced page breaks, and measure widths."""
    p=n.clean(part)
    for m in p.findall('measure'):
        m.attrib.pop('width',None)
        for x in m.findall('print'):m.remove(x)
    return p

def ordered_voicing(pcs,ids,centers,previous=None,required=()):
    """Exhaustive local search: ordered voices, smooth motion, harmonic coverage.

    Each candidate stays within a center +-6-semitone window and player range.
    This is local optimization, not a claim of a globally optimal arrangement.
    """
    opts=[[p for p in range(max(PARTS[pid][4][0],c-6),min(PARTS[pid][4][1],c+6)+1)
           if p%12 in pcs] for pid,c in zip(ids,centers)]
    best=None;old=previous or centers
    for v in itertools.product(*opts):
        if any(x>=y for x,y in zip(v,v[1:])):continue
        if any(y-x>12 for x,y in zip(v[1:],v[2:])):continue
        classes={p%12 for p in v}
        cost=sum(abs(p-q)+2*max(0,abs(p-q)-5)**2 for p,q in zip(v,old))
        cost+=sum(abs(p-c)*.25 for p,c in zip(v,centers))
        cost+=8*len(set(required)-classes)+3*len(set(pcs)-classes)
        if best is None or (cost,v)<best:best=(cost,v)
    assert best is not None,(pcs,ids)
    return dict(zip(ids,best[1]))

def color_harmony(h,piano):
    """Conservative diatonic sixth/ninth colors, screened against the piano.

    Source sus, power, and seventh qualities stay intact. Extensions are allowed
    only on major triads, in F major, with no semitone pitch-class clash against
    any piano note overlapping this harmony span. Conservative by design.
    """
    pcs=set(h['pcs']);added=[]
    if h['kind']=='major':
        active={p['midi']%12 for p in piano if p['bar']==h['bar'] and
                p['on']<h['on']+h['dur'] and p['on']+p['dur']>h['on']}
        for interval in (9,2):
            pc=(h['root']+interval)%12
            if pc in {0,2,4,5,7,9,10} and pc not in pcs and all((pc-x)%12 not in (1,11) for x in active):
                pcs.add(pc);added.append(pc)
    h['arrangement_pcs']=sorted(pcs);h['added_color_pcs']=added
    return sorted(pcs)

def compose(plan,piano):
    events=[];old={};bass_previous=36
    def add(pid,h,on,dur,pitches,role,art=None,slur=None):
        if dur<=0:return
        pitches=[pitches] if isinstance(pitches,int) else list(pitches)
        assert h['on']<=on<on+dur<=h['on']+h['dur']
        if pid!='DR':assert all(PARTS[pid][4][0]<=p<=PARTS[pid][4][1] for p in pitches)
        events.append(dict(part=pid,bar=h['bar'],on=on,dur=dur,pitches=pitches,role=role,art=art,slur=slur))
    for i,h in enumerate(plan):
        b,a,d=h['bar'],h['on'],h['dur'];end=a+d;L=n.BARS[b-1]['length']
        big=22<=b<=30 or 40<=b<=45 or 57<=b<=73
        pcs=color_harmony(h,piano)
        required=[(h['root']+3)%12 if h['kind'].startswith('minor') else (h['root']+4)%12] if h['kind'] not in ('suspended-fourth','power') else []
        if 'seventh' in h['kind']:required.append((h['root']+(10 if h['kind']=='minor-seventh' else 11))%12)
        sax=ordered_voicing(pcs,SAX,(47,55,61,67,73),old.get('sax'),required);old['sax']=[sax[p] for p in SAX]
        h['sax_voicing']=sax
        # Two-bar pads followed by breathing space; verses use the lower quartet.
        active_sax=b in (1,2,79) or (b%4 in (2,3) if not big else b%4 in (1,2,3))
        if active_sax:
            ids=SAX if big or b in (1,2,79) else SAX[:-1]
            start=a if big or b in (1,79) else a+min(4,d//4)
            stop=end if b==79 else max(start,end-min(4,d//4))
            for pid in ids:add(pid,h,start,stop-start,sax[pid],'legato saxophone harmony')
        # Short independent upper-sax answers at selected phrase ends.
        if b in (7,13,17,21,25,33,38,49,53,61,69,73) and end==L and d>=12:
            p=sax['AS1'];neighbors=[q for q in range(p-3,p+4) if q!=p and q%12 in pcs and PARTS['AS1'][4][0]<=q<=PARTS['AS1'][4][1]]
            q=min(neighbors,key=lambda q:abs(q-p),default=p)
            # Replace a pad if the line was already present; avoid overlapping voices.
            events[:]=[e for e in events if not (e['part']=='AS1' and e['bar']==b and a<=e['on']<end)]
            add('AS1',h,end-12,4,p,'phrase-end answer',slur='start')
            add('AS1',h,end-8,4,q,'chord-tone neighbor')
            add('AS1',h,end-4,2,p,'answer resolution',slur='stop')
        # Brass choirs alternate. Full ensemble only at the last climax and release.
        brass=None
        if b in (14,22,31,46,57,65,75) and a==0:brass='tbn'
        if b in (26,30,40,44,61,69,73,79) and a==0:brass='tpt'
        if brass:
            ids=TBN if brass=='tbn' else TPT
            centers=(40,48,54,60) if brass=='tbn' else (58,63,68,73)
            vv=ordered_voicing(pcs,ids,centers,old.get(brass),required);old[brass]=[vv[p] for p in ids]
            if brass=='tbn':vv['BT']=n.octave(h['bass'],40,*PARTS['BT'][4])
            start=a;dur=min(d,12 if b==79 else 8)
            for pid in ids:add(pid,h,start,dur,vv[pid],'soft brass response',art='tenuto')
            if b in (73,79):
                others=TBN if brass=='tpt' else TPT
                vv2=ordered_voicing(pcs,others,(40,48,54,60) if others==TBN else (58,63,68,73),required=required)
                for pid in others:add(pid,h,start,dur,vv2[pid],'climactic brass support',art='tenuto')
        # Bass has a two-feel foundation. Later choruses open into quiet quarters.
        walking=65<=b<=73
        positions=sorted({a}|{t for t in range(0,L,8 if walking else 16) if a<=t<end})
        for j,on in enumerate(positions):
            rootbeat=(on==a)
            pc=h['bass'] if rootbeat else (h['root']+7)%12
            if pc not in pcs and not rootbeat:pc=h['root']
            p=n.octave(pc,bass_previous,28,48)
            if j==len(positions)-1 and walking and d>=16 and i+1<len(plan):
                # Diatonic/chord-tone preparation of the next bass, no chromatic rewrite.
                target=n.octave(plan[i+1]['bass'],p,28,48)
                p=min((x for x in range(28,49) if x%12 in h['pcs']),key=lambda x:(abs(x-target)+.35*abs(x-p),x))
            dur=(positions[j+1] if j+1<len(positions) else end)-on
            add('BA',h,on,dur,p,'quarter-note chorus bass' if walking else 'two-feel bass');bass_previous=p
        # Compact guitar voicings: every other bar, one light response per harmony.
        if b%2==0 or b in (1,79):
            # Select three distinct chord classes in a <=9-semitone sounding span.
            candidates=[v for v in itertools.combinations([p for p in range(50,65) if p%12 in pcs],3)
                        if v[-1]-v[0]<=9 and len({p%12 for p in v})==3]
            v=min(candidates,key=lambda v:sum(abs(p-c) for p,c in zip(v,(53,57,61)))+4*len(set(required)-{p%12 for p in v})) if candidates else tuple(sorted({n.octave(pc,57,48,65) for pc in h['pcs']}))[:3]
            start=a+min(4,d//4);dur=min(4,end-start)
            if b==79:start=a;dur=d
            add('GT',h,start,dur,v,'sparse guitar comp',art='tenuto')
    # Drum notation is a compact example groove, not an inferred piano part.
    for b,meta in enumerate(n.BARS,1):
        L=meta['length'];big=22<=b<=30 or 40<=b<=45 or 57<=b<=73
        if b in (1,2,3,78):continue
        for tick in range(0,L,8):
            sounds=['ride' if big else 'hat']
            if tick%16==0:sounds.append('kick')
            else:sounds.append('snare')
            if b==79:
                if tick:continue
                sounds=['ride','kick']
            events.append(dict(part='DR',bar=b,on=tick,dur=min(8,L-tick),pitches=sounds,role='brush ballad groove',art=None,slur=None))
    events.sort(key=lambda e:(list(PARTS).index(e['part']),e['bar'],e['on']))
    return events

def spelling(midi,pid):
    # Flat-oriented concert spelling suits the source's F major key.
    letter,alt=(('C',0),('D',-1),('D',0),('E',-1),('E',0),('F',0),('G',-1),('G',0),('A',-1),('A',0),('B',-1),('B',0))[midi%12]
    dia,chrom=PARTS[pid][5];idx='CDEFGAB'.index(letter)+dia;octv=midi//12-1+idx//7
    step='CDEFGAB'[idx%7];alt=midi+chrom-((octv+1)*12+n.STEP[step])
    assert -1<=alt<=1,(midi,pid,step,alt)
    return step,alt,octv

def write_event(m,e):
    pid=e['part'];lengths=n.chunks(e['on'],e['dur'])
    for j,dur in enumerate(lengths):
        for k,p in enumerate(e['pitches']):
            note=n.el(m,'note')
            if k:n.el(note,'chord')
            if pid=='DR':
                _,gm,step,octv,head=DRUMS[p];pitch=n.el(note,'unpitched');n.el(pitch,'display-step',step);n.el(pitch,'display-octave',octv)
            else:
                step,alt,octv=spelling(p,pid);pitch=n.el(note,'pitch');n.el(pitch,'step',step)
                if alt:n.el(pitch,'alter',alt)
                n.el(pitch,'octave',octv)
            n.el(note,'duration',dur)
            if pid!='DR':
                if j:n.el(note,'tie',type='stop')
                if j<len(lengths)-1:n.el(note,'tie',type='start')
            if pid=='DR':n.el(note,'instrument',id='DR-'+p)
            typ,dot=n.VALUES[dur];n.el(note,'type',typ)
            if dot:n.el(note,'dot')
            if pid=='DR':n.el(note,'stem','up');n.el(note,'notehead',head)
            no=n.el(note,'notations')
            if pid!='DR':
                if j:n.el(no,'tied',type='stop')
                if j<len(lengths)-1:n.el(no,'tied',type='start')
            if k==0:
                if e['slur']=='start' and j==0:n.el(no,'slur',type='start',number=1)
                if e['slur']=='stop' and j==len(lengths)-1:n.el(no,'slur',type='stop',number=1)
                if e['art']:n.el(n.el(no,'articulations'),e['art'])
                if e['bar']==79 and e['on']+e['dur']==n.BARS[-1]['length'] and j==len(lengths)-1:n.el(no,'fermata')
            if not len(no):note.remove(no)

def descriptor(pl,pid,index):
    name,abbr,_,program,_,_=PARTS[pid];sp=n.el(pl,'score-part',id=pid)
    n.el(sp,'part-name',name);n.el(sp,'part-abbreviation',abbr)
    ids=list(DRUMS) if pid=='DR' else ['I']
    for key in ids:
        ins=n.el(sp,'score-instrument',id='DR-'+key if pid=='DR' else pid+'I')
        n.el(ins,'instrument-name',DRUMS[key][0] if pid=='DR' else name)
    port=(index-1)//15+1;channel=(index-1)%15+1;channel+=channel>=10
    n.el(sp,'midi-device',port=2 if pid=='DR' else port)
    for key in ids:
        mi=n.el(sp,'midi-instrument',id='DR-'+key if pid=='DR' else pid+'I')
        n.el(mi,'midi-channel',10 if pid=='DR' else channel);n.el(mi,'midi-program',program)
        if pid=='DR':n.el(mi,'midi-unpitched',DRUMS[key][1]+1) # XML is 1-based; GM note is 0-based.

def build(root,events,selected,full=False,piano_only=False):
    s=E.Element('score-partwise',version='4.0');n.el(n.el(s,'work'),'work-title','The Everlasting Love of God')
    ident=copy.deepcopy(root.find('identification'));s.append(ident)
    cr=E.Element('creator',type='arranger');cr.text='Jazz band accompaniment: editorial arrangement'
    ident.insert(len(ident.findall('creator')),cr)
    defaults=n.el(s,'defaults');sc=n.el(defaults,'scaling');n.el(sc,'millimeters',5.2 if full else 7);n.el(sc,'tenths',40)
    w,h=(2285,3230) if full else (1200,1697);pg=n.el(defaults,'page-layout');n.el(pg,'page-height',h);n.el(pg,'page-width',w)
    ma=n.el(pg,'page-margins',type='both')
    for tag in ('left-margin','right-margin','top-margin','bottom-margin'):n.el(ma,tag,70)
    subtitle='Jazz ballad | Original piano: Jeff Moore' if full else 'Piano | Original music preserved' if piano_only else PARTS[selected[0]][0]+' | Jazz ballad'
    for kind,text,size,y in [('title','The Everlasting Love of God',23,h-90 if full else h-65),('subtitle',subtitle,11,h-135 if full else h-110),('composer','Matt Boswell, Matt Papa and Matt Redman',10,h-175 if full else h-148)]:
        c=n.el(s,'credit',page=1);n.el(c,'credit-type',kind);n.el(c,'credit-words',text,**{'font-size':size,'default-x':w/2,'default-y':y,'justify':'center','valign':'top'})
    pl=n.el(s,'part-list')
    for i,pid in enumerate(selected,1):
        if full and pid in ('AS1','TP1','TB1','GT'):
            g=n.el(pl,'part-group',number={'AS1':1,'TP1':2,'TB1':3,'GT':4}[pid],type='start');n.el(g,'group-symbol','bracket');n.el(g,'group-barline','yes')
        descriptor(pl,pid,i)
        if full and pid in ('BS','TP4','BT','DR'):n.el(pl,'part-group',number={'BS':1,'TP4':2,'BT':3,'DR':4}[pid],type='stop')
    # Rhythm order in score: guitar, preserved piano, bass, drums.
    if full or piano_only:
        sp=copy.deepcopy(root.find('./part-list/score-part'))
        sp.find('part-name').text='Piano';sp.find('part-abbreviation').text='Pno.'
        for tag in ('part-name','part-abbreviation'):sp.find(tag).attrib.pop('print-object',None)
        for x in list(sp):
            if x.tag in ('midi-instrument','midi-device'):sp.remove(x)
        n.el(sp,'midi-device',port=3);mi=n.el(sp,'midi-instrument',id=sp.find('score-instrument').get('id'));n.el(mi,'midi-channel',1);n.el(mi,'midi-program',1)
        idx=next((i for i,x in enumerate(pl) if x.tag=='score-part' and x.get('id')=='BA'),len(pl));pl.insert(idx,sp)
    for pid in selected:
        part=n.el(s,'part',id=pid)
        for b,src in enumerate(root.findall('./part/measure'),1):
            m=n.el(part,'measure',number=src.get('number'));meta=n.BARS[b-1]
            if full and b%4==1:n.el(m,'print',**({'new-page':'yes'} if b>1 else {}))
            if not full and b in (31,57):n.el(m,'print',**{'new-page':'yes'})
            elif not full and pid in ('GT','BA') and b in (5,9,13,17,21,25,29,35,39,43,47,51,55,61,65,69,73,77):
                n.el(m,'print',**{'new-system':'yes'})
            if b==1 or meta['beats']!=n.BARS[b-2]['beats']:
                a=n.el(m,'attributes')
                if b==1:
                    n.el(a,'divisions',8)
                    if pid!='DR':n.el(n.el(a,'key'),'fifths',2 if pid in ('AS1','AS2','BS') else 1 if pid.startswith('TP') or pid.startswith('TS') else -1)
                tm=n.el(a,'time');n.el(tm,'beats',meta['beats']);n.el(tm,'beat-type',meta['beat_type'])
                if b==1:
                    c=n.el(a,'clef');n.el(c,'sign',PARTS[pid][2])
                    if pid!='DR':n.el(c,'line',2 if PARTS[pid][2]=='G' else 4)
                    dia,chrom=PARTS[pid][5]
                    if chrom:
                        octaves=chrom//12;tr=n.el(a,'transpose');n.el(tr,'diatonic',-(dia-7*octaves));n.el(tr,'chromatic',-(chrom-12*octaves))
                        if octaves:n.el(tr,'octave-change',-octaves)
            def direct(**kw):return n.direction(m,**kw)
            if b==1:
                text=('Dolce, legato; breathe in rests.' if pid in SAX else
                      'Soft, warm tone; tenuto responses.' if pid in TPT+TBN else
                      'Light comp; let piano lead. Written pitches sound 8vb.' if pid=='GT' else
                      'Pizz.; relaxed two-feel. Written pitches sound 8vb.' if pid=='BA' else
                      'Brushes; light cymbal pulse. Pattern may be varied softly.')
                direct(text=text)
                if not full or pid=='AS1':
                    d=direct(text='Jazz ballad - quarter = 72; even eighths');n.el(d,'sound',tempo=72)
            if b in LABEL:
                if not full or pid=='AS1':direct(rehearsal=LABEL[b])
                direct(dynamic='mp' if b in (57,65) and pid not in TPT+TBN+('DR',) else 'pp' if pid in TPT+TBN+('DR',) else 'p')
            if b==65 and pid=='BA':direct(text='Quiet quarter-note feel')
            if b==75 and pid=='BA':direct(text='Return to two-feel')
            if b==78:direct(text='Molto rit. - follow piano')
            for d in src.findall('direction'):
                if d.find('.//segno') is not None or d.find('.//coda') is not None:
                    d=n.clean(d)
                    for x in list(d):
                        if x.tag in ('staff','offset'):d.remove(x)
                    m.append(d)
            # Exact supplied chord symbols are useful on the rhythm parts.
            if pid in ('GT','BA'):
                cursor=0
                for x in src:
                    if x.tag=='backup':cursor-=int(x.findtext('duration'))
                    elif x.tag=='forward':cursor+=int(x.findtext('duration'))
                    elif x.tag=='note' and x.find('chord') is None:cursor+=int(x.findtext('duration','0'))
                    elif x.tag=='harmony':
                        hh=n.clean(x);off=hh.find('offset');value=cursor+int(hh.findtext('offset','0'))
                        if off is not None:hh.remove(off)
                        if value:n.el(hh,'offset',value)
                        for st in hh.findall('staff'):hh.remove(st)
                        m.append(hh)
            for bl in src.findall("barline[@location='left']"):m.append(n.clean(bl))
            at=0
            for e in (e for e in events if e['part']==pid and e['bar']==b):
                assert e['on']>=at,(pid,b,e,at)
                n.rest(m,at,e['on']-at);write_event(m,e);at=e['on']+e['dur']
            n.rest(m,at,meta['length']-at)
            for bl in src.findall('barline'):
                if bl.get('location')!='left':m.append(n.clean(bl))
    if full or piano_only:
        piano=piano_layout(root.find('part'));idx=next((i for i,x in enumerate(s) if x.tag=='part' and x.get('id')=='BA'),len(s));s.insert(idx,piano)
    E.indent(s);return s

def decode(score):
    """Decode sounding notes using the EXPORT'S transpose, not configuration."""
    result=[]
    for part in score.findall('part'):
        pid=part.get('id')
        if pid=='P1':continue
        shift=0
        for b,m in enumerate(part.findall('measure'),1):
            tr=m.find('./attributes/transpose')
            if tr is not None:shift=int(tr.findtext('chromatic','0'))+12*int(tr.findtext('octave-change','0'))
            at=prior=0
            for note in m.findall('note'):
                dur=int(note.findtext('duration'));on=prior if note.find('chord') is not None else at
                if note.find('chord') is None:prior=at;at+=dur
                typ,dot=n.VALUES[dur];assert note.findtext('type')==typ and (note.find('dot') is not None)==dot
                p=note.find('pitch');u=note.find('unpitched')
                if p is not None:val=(int(p.findtext('octave'))+1)*12+n.STEP[p.findtext('step')]+int(p.findtext('alter','0'))+shift
                elif u is not None:val=note.find('instrument').get('id').removeprefix('DR-')
                else:continue
                result.extend((pid,b,t,val) for t in range(on,on+dur))
            assert at==n.BARS[b-1]['length'],(pid,b,at)
    return collections.Counter(result)

def validate(root,score,events,plan):
    piano=score.find("part[@id='P1']")
    assert n.canonical(piano_layout(root.find('part')))==n.canonical(piano_layout(piano)),'Piano changed'
    expected=collections.Counter((e['part'],e['bar'],t,p) for e in events for p in e['pitches'] for t in range(e['on'],e['on']+e['dur']))
    assert decode(score)==expected,'Export pitch or timing mismatch'
    for part in score.findall('part'):
        assert len(part.findall('measure'))==79
        if part.get('id')=='P1':continue
        for src,m in zip(root.findall('./part/measure'),part.findall('measure')):
            assert [n.canonical(n.clean(x)) for x in src.findall('barline')]==[n.canonical(x) for x in m.findall('barline')]
    for e in events:
        if e['part']=='DR':assert set(e['pitches'])<=set(DRUMS);continue
        h=next(h for h in plan if h['bar']==e['bar'] and h['on']<=e['on']<h['on']+h['dur'])
        assert e['on']+e['dur']<=h['on']+h['dur']
        assert all(p%12 in set(h['arrangement_pcs'])|{h['bass']} for p in e['pitches'])
        assert all(PARTS[e['part']][4][0]<=p<=PARTS[e['part']][4][1] for p in e['pitches'])
        if e['part']=='GT':assert max(e['pitches'])-min(e['pitches'])<=9
    for key,(_,gm,_,_,_) in DRUMS.items():
        mi=score.find(f"./part-list/score-part[@id='DR']/midi-instrument[@id='DR-{key}']")
        assert mi.findtext('midi-channel')=='10' and int(mi.findtext('midi-unpitched'))==gm+1
    return {'measures':79,'piano_musical_content_preserved':True,'event_pitch_and_timing_round_trip':True,
            'source_sha256':hashlib.sha256((OUT/'original-piano.musicxml').read_bytes()).hexdigest(),
            'arrangement_events':len(events),'piano_pitched_segments':len(root.findall('./part/measure/note/pitch')),
            'review_status':'Structural and engraving checks; no live player or audio review.'}

def main():
    root,piano,_=n.read_source();plan=harmony(root);events=compose(plan,piano)
    score=build(root,events,list(PARTS),True);report=validate(root,score,events,plan)
    jobs=[]
    outputs=[('everlasting-love-jazz-band',score)]+[(f'everlasting-love-{pid}',build(root,events,[pid])) for pid in PARTS]+[('everlasting-love-piano',build(root,events,[],piano_only=True))]
    for name,tree in outputs:
        f=OUT/(name+'.musicxml');E.ElementTree(tree).write(f,encoding='utf-8',xml_declaration=True)
        reopened=E.parse(f).getroot()
        if name=='everlasting-love-jazz-band':validate(root,reopened,events,plan)
        elif name=='everlasting-love-piano':assert n.canonical(piano_layout(root.find('part')))==n.canonical(piano_layout(reopened.find('part')))
        else:
            pid=tree.find('part').get('id');assert decode(reopened)==collections.Counter((e['part'],e['bar'],t,p) for e in events if e['part']==pid for p in e['pitches'] for t in range(e['on'],e['on']+e['dur']))
        jobs.append({'in':str(f),'out':str(f.with_suffix('.pdf'))})
    activity={pid:{'events':sum(e['part']==pid for e in events),'active_quarter_beats':sum(e['dur'] for e in events if e['part']==pid)/8} for pid in PARTS}
    for name,data in [('harmony-plan',plan),('arrangement-events',events),('validation',report),('part-activity',activity),('engrave-jobs',jobs)]:
        (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
