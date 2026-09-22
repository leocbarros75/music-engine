"""O Espirito de Deus: source-preserving melody + professional piano.

Python 3 standard library. Run `python3 arrange.py --source source.musicxml`.
The source harmony supplies the harmonic plan; voicing search and texture design
are editorial. This is a piece-specific arranging example, not a universal AI
accompaniment generator. See PROCESS.md for musical rationale and limitations.
"""
from __future__ import annotations
import argparse, copy, hashlib, itertools, json
from dataclasses import dataclass
from fractions import Fraction as F
from pathlib import Path
import xml.etree.ElementTree as E

STEPS={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
INTERVALS={'major':(0,4,7),'minor':(0,3,7),'diminished':(0,3,6)}
SPELLINGS={0:'C',1:'C#',2:'D',3:'Eb',4:'E',5:'F',6:'F#',7:'G',8:'Ab',9:'A',10:'Bb',11:'B'}
TEXTURES={3:'answer',5:'answer',7:'answer',9:'answer',11:'answer',13:'answer',17:'answer',18:'answer',20:'broad',21:'final'}
# Only selected held-melody bars receive an actual upper-neighbor figure.
NEIGHBOR_BARS={3,5,7,11,13,18}

@dataclass
class Harmony:
    measure:int
    onset:F
    root:int
    kind:str
    bass:int
    label:str
    duration:F=F(0)
    @property
    def pcs(self):return {(self.root+i)%12 for i in INTERVALS[self.kind]}

def el(parent,tag,text=None,**attrs):
    n=E.SubElement(parent,tag,{k:str(v) for k,v in attrs.items()})
    if text is not None:n.text=str(text)
    return n

def name(midi,root=None,kind=None):
    # Spell G# as the leading note in E major / G# diminished, not Ab.
    pc=midi%12
    s='G#' if pc==8 and (root==4 or (root==8 and kind=='diminished')) else SPELLINGS[pc]
    return s+str(midi//12-1)

def pitch_tuple(note):
    p=note.find('pitch')
    return None if p is None else (p.findtext('step'),int(p.findtext('alter','0')),int(p.findtext('octave')))

def scan(part):
    """Honor MusicXML cursor movements: harmony may follow a backup.
    Return actual harmonic onsets and a source note signature for verification.
    """
    div=None;harmonies=[];signatures=[]
    for m in part.findall('measure'):
        b=int(m.get('number'));cursor=F(0);previous=F(0);max_end=F(0);hs=[];ns=[]
        for n in m:
            if n.tag=='attributes':
                d=n.findtext('divisions')
                if d:div=int(d)
            elif n.tag in ('backup','forward'):
                amount=F(int(n.findtext('duration')),div);cursor+=amount if n.tag=='forward' else -amount
            elif n.tag=='note':
                dur=F(int(n.findtext('duration')),div)
                onset=previous if n.find('chord') is not None else cursor
                ns.append((str(onset),str(dur),pitch_tuple(n),tuple(t.get('type') for t in n.findall('tie')),n.findtext('voice'),n.findtext('staff'),E.tostring(n.find('lyric'),encoding='unicode') if n.find('lyric') is not None else None))
                previous=onset
                if n.find('chord') is None:cursor+=dur
                max_end=max(max_end,onset+dur)
            elif n.tag=='harmony':
                rt=n.find('root');root=(STEPS[rt.findtext('root-step')]+int(rt.findtext('root-alter','0')))%12
                kind=n.findtext('kind');assert kind in INTERVALS,kind
                bs=n.find('bass');bass=root if bs is None else (STEPS[bs.findtext('bass-step')]+int(bs.findtext('bass-alter','0')))%12
                suffix={'major':'','minor':'m','diminished':'dim'}[kind]
                label=('G#' if root==8 and kind=='diminished' else SPELLINGS[root])+suffix
                if bass!=root:label+='/'+SPELLINGS[bass]
                offset=F(int(n.findtext('offset','0')),div)
                hs.append(Harmony(b,cursor+offset,root,kind,bass,label))
        assert max_end==4,(b,max_end)
        assert hs and hs[0].onset==0,(b,'Harmony required at start')
        for i,h in enumerate(hs):h.duration=(hs[i+1].onset if i+1<len(hs) else F(4))-h.onset
        harmonies.extend(hs);signatures.append(ns)
    return harmonies,signatures

def choose_voicings(harmonies):
    """Dynamic programming on complete RH triads, lowest-to-highest.
    Minimize three-voice semitone motion plus weak register and span costs.
    Notes are sequentialized later; chord optimization is not strict SATB proof.
    """
    def candidates(h):
        return [v for v in itertools.combinations(range(57,77),3) if {p%12 for p in v}==h.pcs and v[-1]-v[0]<=12]
    def local(v):return .06*abs(sum(v)/3-66)+.025*(v[-1]-v[0])
    states={v:(local(v),[v]) for v in candidates(harmonies[0])}
    for h in harmonies[1:]:
        new={}
        for v in candidates(h):
            cost,path=min((old_cost+sum(abs(a-b) for a,b in zip(old,v))+local(v),path) for old,(old_cost,path) in states.items())
            new[v]=(cost,path+[v])
        states=new
    return min(states.values(),key=lambda x:x[0])[1]

def upper_neighbor(p,h):
    """Use a diatonic step outside the triad; return to the SAME anchor.
    Neighbor tones here are ornamental, not replacement harmonies.
    """
    scale={0,2,4,5,7,9,11} if h.root not in (4,8) else {0,2,4,5,8,9,11}
    for delta in (1,2):
        n=p+delta
        if n%12 in scale and n%12 not in h.pcs:return n
    raise ValueError('No neighbor for this anchor')

def accompaniment(harmonies,voicings):
    bars={b:{'rh':[],'lh':[]} for b in range(1,22)};analysis=[]
    def event(seq,pitches,dur,role='chord'):
        seq.append({'pitches':list(pitches),'beats':F(dur),'role':role})
    for h,v in zip(harmonies,voicings):
        b=h.measure;rh=bars[b]['rh'];lh=bars[b]['lh'];style=TEXTURES.get(b,'flow')
        # C-major closing sonority; broad whole-note resolution.
        if style=='final':
            event(rh,(60,64,67,72),4);event(lh,(36,48),4)
        elif style=='broad':
            event(rh,v,h.duration)
            bass=36+h.bass
            event(lh,(bass,bass+12),h.duration)
        elif style=='answer':
            # Left hand articulates spacious quarter-note arpeggios.
            bass=36+h.bass
            upper=sorted(p for p in range(bass+1,min(bass+20,v[0])) if p%12 in h.pcs)
            pool=[bass,upper[0],upper[1],upper[-1]]
            for i in range(int(h.duration)):event(lh,(pool[i%4],),1,'arpeggio')
            # RH block on beat one, a melodic response after the singer settles.
            # All current answer bars carry one four-beat source harmony.
            assert h.duration==4
            event(rh,v,2)
            if b in NEIGHBOR_BARS:
                anchor=v[-1];neighbor=upper_neighbor(anchor,h)
                for n in (anchor,neighbor,anchor,v[1]):event(rh,(n,),F(1,2),'neighbor' if n==neighbor else 'arpeggio')
                ornament={'anchor':name(anchor,h.root,h.kind),'neighbor':name(neighbor,h.root,h.kind),'resolution':name(anchor,h.root,h.kind),'onset_beat':3.5}
            else:
                for n in (v[1],v[2],v[1],v[0]):event(rh,(n,),F(1,2),'arpeggio')
                ornament=None
        else:
            # Flowing accompaniment during rhythmically active vocal measures.
            bass=36+h.bass
            upper=sorted(p for p in range(bass+1,min(bass+20,v[0])) if p%12 in h.pcs)
            pool=[bass,upper[0],upper[1],upper[-1],upper[1],upper[0],upper[1],upper[0]]
            for i in range(int(h.duration*2)):event(lh,(pool[i%8],),F(1,2),'arpeggio')
            if h.duration==4:
                event(rh,v,2);event(rh,(v[0],v[2]),2)
            else:event(rh,v,h.duration)
        analysis.append({'measure':b,'onset':float(h.onset),'duration':float(h.duration),'source_chord':h.label,'rh_voicing':[name(p,h.root,h.kind) for p in v],'texture':style,'neighbor':ornament if style=='answer' else None})
    return bars,analysis

def direction(m,words=None,dynamic=None,staff=1):
    d=el(m,'direction',placement='above' if words else 'below');dt=el(d,'direction-type')
    if words:el(dt,'words',words)
    else:el(el(dt,'dynamics'),dynamic)
    el(d,'staff',staff);return d

def write_events(m,seq,staff,roots):
    onset=F(0);accidentals={}
    for i,e in enumerate(seq):
        duration=e['beats'];ps=e['pitches']
        current_harmony=next(h for h in roots if h.onset<=onset<h.onset+h.duration)
        root=current_harmony.root
        # Beam eighth notes in quarter-beat pairs; neighbors remain easy to read.
        beam=None
        if duration==F(1,2):
            before=i>0 and seq[i-1]['beats']==F(1,2) and int((onset-F(1,2)))==int(onset)
            after=i+1<len(seq) and seq[i+1]['beats']==F(1,2) and int(onset+F(1,2))==int(onset)
            if before:beam='end'
            elif after:beam='begin'
        for j,p in enumerate(ps):
            n=el(m,'note')
            if j:el(n,'chord')
            text=name(p,root,current_harmony.kind);step=text[0];alt=1 if '#' in text else -1 if 'b' in text else 0;octave=p//12-1
            pe=el(n,'pitch');el(pe,'step',step)
            if alt:el(pe,'alter',alt)
            el(pe,'octave',octave);el(n,'duration',int(duration*4));el(n,'voice',staff)
            el(n,'type',{F(1,2):'eighth',F(1):'quarter',F(2):'half',F(4):'whole'}[duration])
            if alt!=accidentals.get((step,octave),0):el(n,'accidental',{-1:'flat',0:'natural',1:'sharp'}[alt])
            accidentals[(step,octave)]=alt
            el(n,'staff',staff)
            if beam:el(n,'beam',beam,number=1)
            if m.get('number')=='21':el(el(n,'notations'),'fermata')
        onset+=duration
    assert onset==4

def build(source,harmonies,bars):
    root=copy.deepcopy(source)
    root.find('work/work-title').text='O Espírito de Deus'
    if root.find('movement-title') is not None:root.remove(root.find('movement-title'))
    for credit in root.findall('credit'):root.remove(credit)
    # Let engraving software lay out the new three-staff score.
    for n in root.iter():
        for a in ('default-x','default-y','relative-x','relative-y'):n.attrib.pop(a,None)
    original=root.find('part')
    for m in original.findall('measure'):
        m.attrib.pop('width',None)
        for pr in m.findall('print'):m.remove(pr)
    plist=root.find('part-list');sp=plist.find('score-part')
    for tag in ('part-name-display','part-abbreviation-display'):
        for e in sp.findall(tag):sp.remove(e)
    sp.find('part-name').attrib.clear();sp.find('part-name').text='Melody'
    sp.find('part-abbreviation').attrib.clear();sp.find('part-abbreviation').text='Mel.'
    mi=el(sp,'midi-instrument',id='instrument-1');el(mi,'midi-channel',1);el(mi,'midi-program',54)
    ps=el(plist,'score-part',id='Piano');el(ps,'part-name','Piano');el(ps,'part-abbreviation','Pno.')
    si=el(ps,'score-instrument',id='piano-I');el(si,'instrument-name','Piano')
    mi=el(ps,'midi-instrument',id='piano-I');el(mi,'midi-channel',2);el(mi,'midi-program',1)
    piano=el(root,'part',id='Piano')
    for b,src in enumerate(original.findall('measure'),1):
        m=el(piano,'measure',number=b)
        left=src.find("barline[@location='left']")
        if left is not None:m.append(copy.deepcopy(left))
        if b==1:
            a=el(m,'attributes');el(a,'divisions',4);el(el(a,'key'),'fifths',0)
            t=el(a,'time');el(t,'beats',4);el(t,'beat-type',4);el(a,'staves',2)
            for staff,sign,line in ((1,'G',2),(2,'F',4)):
                c=el(a,'clef',number=staff);el(c,'sign',sign);el(c,'line',line)
            d=direction(m,'Andante cantabile (suggested quarter = 72)');el(d,'sound',tempo=72)
            direction(m,'Legato; keep piano beneath the voice. Change pedal with harmony.')
            d=E.Element('direction',placement='above');el(el(d,'direction-type'),'words','Andante cantabile');el(d,'sound',tempo=72)
            # Place tempo before the first melody note, after initial attributes.
            src.insert(1,d)
        if b in (1,4,7,10,13,16,19):
            pr=E.Element('print',**({'new-system':'yes'} if b!=1 else {}));src.insert(0,pr)
        dyn={1:'p',4:'mp',10:'mf',14:'mf',19:'mp',20:'p',21:'pp'}
        if b in dyn:direction(m,dynamic=dyn[b])
        if b==10:direction(m,'Più cantabile')
        if b==19:direction(m,'Poco rit. verso la fine')
        hs=[h for h in harmonies if h.measure==b]
        write_events(m,bars[b]['rh'],1,hs);el(el(m,'backup'),'duration',16);write_events(m,bars[b]['lh'],2,hs)
        right=src.find("barline[@location='right']")
        if right is not None:m.append(copy.deepcopy(right))
    E.indent(root);return root

def validate(source,out,bars):
    _,before=scan(source.find('part'));_,after=scan(out.find('part'))
    assert before==after,'Source melody or ties changed'
    for original,new in zip(source.findall('./part/measure'),out.findall('./part/measure')):
        assert [E.tostring(x) for x in original.findall('barline')]==[E.tostring(x) for x in new.findall('barline')],'Repeat/ending change'
    counts={'melody_notes_and_rests':sum(len(x) for x in before),'measures':len(before),'neighbor_figures':len(NEIGHBOR_BARS)}
    for b,staves in bars.items():
        for staff,seq in staves.items():
            assert sum(e['beats'] for e in seq)==4
            for e in seq:
                assert max(e['pitches'])-min(e['pitches'])<=12,(b,staff,e)
                assert all(21<=n<=108 for n in e['pitches'])
    # Reject simultaneous hand overlap: LH arpeggios must not restrike a held RH pitch.
    for b,staves in bars.items():
        spans={}
        for staff,seq in staves.items():
            at=F(0);spans[staff]=[]
            for e in seq:
                spans[staff].append((at,at+e['beats'],e['pitches']));at+=e['beats']
        for r0,r1,rp in spans['rh']:
            for l0,l1,lp in spans['lh']:
                if max(r0,l0)<min(r1,l1):assert max(lp)<min(rp),(b,'Hand overlap')
    # Check serialized piano timeline and displayed rhythmic values.
    for m in out.findall("./part[@id='Piano']/measure"):
        totals={1:0,2:0}
        for n in m.findall('note'):
            d=int(n.findtext('duration'));assert d=={'eighth':2,'quarter':4,'half':8,'whole':16}[n.findtext('type')]
            if n.find('chord') is None:totals[int(n.findtext('staff'))]+=d
        assert totals=={1:16,2:16}
    return counts

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=Path(__file__).with_name('source.musicxml'));args=ap.parse_args()
    source=E.parse(args.source).getroot();hs,_=scan(source.find('part'))
    voicings=choose_voicings(hs);bars,analysis=accompaniment(hs,voicings)
    root=build(source,hs,bars)
    out=Path(__file__).resolve().parent;path=out/'o-espirito-melody-piano.musicxml'
    E.ElementTree(root).write(path,encoding='utf-8',xml_declaration=True)
    reopened=E.parse(path).getroot();checks=validate(source,reopened,bars)
    checks['source_sha256']=hashlib.sha256(args.source.read_bytes()).hexdigest()
    checks['rh_max_voice_transition_semitones']=max(abs(a-b) for v,w in zip(voicings,voicings[1:]) for a,b in zip(v,w))
    (out/'analysis.json').write_text(json.dumps({'checks':checks,'harmonic_plan':analysis},ensure_ascii=False,indent=2))
    print(json.dumps(checks,indent=2));print(path)

if __name__=='__main__':main()
