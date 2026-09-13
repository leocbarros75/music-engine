"""Rebuild melody plus piano using only the Python standard library.
Durations are quarter-note beats; pitches are concert pitch.
"""
from pathlib import Path
import itertools, json, zipfile
import xml.etree.ElementTree as E

MELODY = [[('F#4', 1.5), ('F#4', 0.5), ('F#4', 1), ('G4', 0.5), ('A4', 0.5)], [('G4', 3), ('G4', 0.5), ('F#4', 0.5)], [('E4', 1.5), ('E4', 0.5), ('E4', 1), ('F#4', 0.5), ('G4', 0.5)], [('F#4', 1), ('D4', 0.5), ('E4', 0.5), ('F#4', 1), ('F#4', 0.5), ('D4', 0.5)], [('D4', 1), ('D4', 0.5), ('D4', 0.5), ('D4', 1), ('E4', 0.5), ('F#4', 0.5)], [('E4', 2), ('G4', 1), ('G4', 1)], [('D4', 1), ('D4', 0.5), ('E4', 0.5), ('C#4', 2)], [('D4', 1), ('D4', 0.5), ('E4', 0.5), ('E4', 1), ('F#4', 1)], [('G4', 2), ('G4', 1), ('G4', 1)], [('E4', 2), ('A4', 2)], [('C#4', 1), ('E4', 2), ('E4', 1)], [('E4', 1), ('D4', 0.5), ('E4', 0.5), ('F#4', 2)], [('G4', 1.5), ('G4', 0.5), ('C#4', 1), ('C#4', 0.5), ('E4', 0.5)], [('G4', 1.5), ('G4', 0.5), ('E4', 2)], [('F#4', 4)]]
# Two harmonic slots per bar; RH chords last two beats each.
HARMONY=[('D','D'),('G','G'),('A','A'),('D','D'),('Bm','A'),('G','G'),('A','A'),('D','D'),('G','G'),('A','A'),('F#m','F#m'),('Bm','Bm'),('G','A'),('G','A'),('D','D')]
# Walking bass is composed explicitly, not obtained from the voicing optimizer.
# Beat-four approach notes lead into the following measure; source pedal basses
# are adapted to a mobile line, so this is an arrangement, not literal cleanup.
BASS=[
 ['D3','F#3','A2','C#3'], ['D3','G2','B2','C#3'],
 ['D3','A2','C#3','E3'], ['D3','F#3','A2','A#2'],
 ['B2','D3','A2','F#2'], ['G2','B2','D3','G#2'],
 ['A2','C#3','E3','C#3'], ['D3','A2','E3','F#3'],
 ['G3','D3','B2','F#2'], ['G2','A2','C#3','E#3'],
 ['F#3','C#3','A2','A#2'], ['B2','D3','F#3','F#2'],
 ['G2','B2','A2','F#2'], ['G2','B2','A2','C#3'], ['D3']]
TRIADS={'D':(2,6,9),'G':(7,11,2),'A':(9,1,4),'Bm':(11,2,6),'F#m':(6,9,1)}
NAMES={0:'C',1:'C#',2:'D',3:'D#',4:'E',5:'F',6:'F#',7:'G',8:'G#',9:'A',10:'A#',11:'B'}
def pitch(n):return NAMES[n%12]+str(n//12-1)
def midi(s):return (int(s[-1])+1)*12+{'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[s[0]]+int('#' in s)
def candidates(name):
 pcs=set(TRIADS[name])
 return [c for c in itertools.combinations(range(57,75),3) if {n%12 for n in c}==pcs and c[-1]-c[0]<=12]
def choose_voicings():
 # Dynamic programming: globally minimize summed semitone motion of the three
 # ordered chord voices, plus a small register cost. No neural model is used here.
 seq=[h for bar in HARMONY for h in bar]
 states={c:(.08*abs(sum(c)/3-64),[c]) for c in candidates(seq[0])}
 for h in seq[1:]:
  new={}
  for c in candidates(h):
   cost,path=min((v[0]+sum(abs(x-y) for x,y in zip(prev,c))+.08*abs(sum(c)/3-64),v[1]) for prev,v in states.items())
   new[c]=(cost,path+[c])
  states=new
 return min(states.values(),key=lambda x:x[0])[1]
VOICINGS=choose_voicings()
def el(p,t,text=None,**attrs):
 n=E.SubElement(p,t,{k:str(v) for k,v in attrs.items()})
 if text is not None:n.text=str(text)
 return n
def direction(m,words,staff=None):
 d=el(m,'direction',placement='above');el(el(d,'direction-type'),'words',words)
 if staff:el(d,'staff',staff)
 return d
def notes(m,chord,beats,staff=None):
 for j,p in enumerate(chord):
  n=el(m,'note')
  if j:el(n,'chord')
  x=el(n,'pitch');el(x,'step',p[0])
  if '#' in p:el(x,'alter',1)
  el(x,'octave',p[-1]);el(n,'duration',int(beats*2))
  if staff:el(n,'voice',staff)
  el(n,'type',{.5:'eighth',1:'quarter',1.5:'quarter',2:'half',3:'half',4:'whole'}[beats])
  if beats in (1.5,3):el(n,'dot')
  if staff:el(n,'staff',staff)
  if m.get('number')=='15':el(el(n,'notations'),'fermata')
def score(include_melody=True,include_piano=True):
 r=E.Element('score-partwise',version='4.0');el(el(r,'work'),'work-title','Theme — Melody and Walking Piano')
 i=el(r,'identification');el(i,'creator','Editorial arrangement from supplied MIDI transcription',type='arranger')
 en=el(i,'encoding');el(en,'software','Python / MusicXML');el(en,'encoding-description','Clarified melody; optimized RH triad voicings; composed walking bass. Tempo editorial; straight eighths.')
 pl=el(r,'part-list')
 parts=[]
 if include_melody:parts.append(('M','Melody',74,1))
 if include_piano:parts.append(('P','Piano',1,2))
 for pid,name,program,ch in parts:
  sp=el(pl,'score-part',id=pid);el(sp,'part-name',name);el(sp,'part-abbreviation','Mel.' if pid=='M' else 'Pno.')
  si=el(sp,'score-instrument',id=pid+'I');el(si,'instrument-name',name)
  mi=el(sp,'midi-instrument',id=pid+'I');el(mi,'midi-channel',ch);el(mi,'midi-program',program)
 for pid,name,program,ch in parts:
  part=el(r,'part',id=pid)
  for b in range(15):
   m=el(part,'measure',number=b+1)
   if b in (4,8,12):el(m,'print',**{'new-system':'yes'})
   if b==0:
    a=el(m,'attributes');el(a,'divisions',2);el(el(a,'key'),'fifths',2)
    t=el(a,'time');el(t,'beats',4);el(t,'beat-type',4)
    if pid=='P':el(a,'staves',2)
    c=el(a,'clef',**({'number':1} if pid=='P' else {}));el(c,'sign','G');el(c,'line',2)
    if pid=='P':c=el(a,'clef',number=2);el(c,'sign','F');el(c,'line',4)
    d=direction(m,'Andante, quarter = 76; straight eighths',1 if pid=='P' else None);el(d,'sound',tempo=76)
    if pid=='P':direction(m,'RH legato chords; LH steady, lightly detached. Pedal sparingly.',1)
   if b==14:direction(m,'rit., let the final chord settle',1 if pid=='P' else None)
   if pid=='M':
    for p,d in MELODY[b]:notes(m,[p],d)
   else:
    for slot in range(1 if b==14 else 2):notes(m,[pitch(x) for x in VOICINGS[2*b+slot]],4 if b==14 else 2,1)
    el(el(m,'backup'),'duration',8)
    for p in BASS[b]:notes(m,[p],4 if b==14 else 1,2)
   if b==14:el(el(m,'barline',location='right'),'bar-style','light-heavy')
 E.indent(r);return r

def validate(path):
 r=E.parse(path)
 for part in r.findall('part'):
  for m in part.findall('measure'):
   totals={}
   for n in m.findall('note'):
    st=n.findtext('staff','1');d=int(n.findtext('duration'))
    value={'eighth':1,'quarter':2,'half':4,'whole':8}[n.findtext('type')]
    assert d==value*(1.5 if n.find('dot') is not None else 1)
    if n.find('chord') is None:totals[st]=totals.get(st,0)+d
   assert all(v==8 for v in totals.values()),(part.get('id'),m.get('number'),totals)
   assert len(totals)==(2 if part.get('id')=='P' else 1)
 for v in VOICINGS:assert v[-1]-v[0]<=12
 for bar in BASS:
  for p in bar:assert 40<=midi(p)<=55

if __name__=='__main__':
 out=Path(__file__).resolve().parent
 for name,mel,pno in [('test4-melody-piano',True,True),('test4-piano-only',False,True),('test4-melody-only',True,False)]:
  p=out/(name+'.musicxml');E.ElementTree(score(mel,pno)).write(p,encoding='utf-8',xml_declaration=True);validate(p);print('Validated',p.name)
 rows=[]
 for b in range(15):
  entries=[]
  for s in range(2):
   h=HARMONY[b][s];v=VOICINGS[b*2+s];inv=TRIADS[h].index(v[0]%12)
   entries.append({'triad':h,'notes':[pitch(n) for n in v],'RH_position':['root position','first inversion','second inversion'][inv]})
  rows.append({'measure':b+1,'RH':entries,'LH':BASS[b]})
 (out/'voicing-analysis.json').write_text(json.dumps(rows,indent=2))
 print('Maximum between-chord single-voice movement:',max(abs(a-b) for x,y in zip(VOICINGS,VOICINGS[1:]) for a,b in zip(x,y)),'semitones')
