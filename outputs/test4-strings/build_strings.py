"""Build an editorial string-quintet arrangement using Python's standard library.
All event durations are quarter-note beats; double-bass pitches are WRITTEN.
Run: python3 build_strings.py
"""
from pathlib import Path
import xml.etree.ElementTree as ET

MELODY = [
 [('F#5',1.5),('F#5',.5),('F#5',1),('G5',.5),('A5',.5)],
 [('G5',3),('G5',.5),('F#5',.5)],
 [('E5',1.5),('E5',.5),('E5',1),('F#5',.5),('G5',.5)],
 [('F#5',1),('D5',.5),('E5',.5),('F#5',1),('F#5',.5),('D5',.5)],
 [('D5',1),('D5',.5),('D5',.5),('D5',1),('E5',.5),('F#5',.5)],
 [('E5',2),('G5',1),('G5',1)],
 [('D5',1),('D5',.5),('E5',.5),('C#5',2)],
 [('D5',1),('D5',.5),('E5',.5),('E5',1),('F#5',1)],
 [('G5',2),('G5',1),('G5',1)],
 [('E5',2),('A5',2)],
 [('C#5',1),('E5',2),('E5',1)],
 [('E5',1),('D5',.5),('E5',.5),('F#5',2)],
 [('G5',1.5),('G5',.5),('C#5',1),('C#5',.5),('E5',.5)],
 [('G5',1.5),('G5',.5),('E5',2)],
 [('F#5',4)]
]
VIOLIN_II = [
 [('D5',2),('A4',1),('D5',1)],
 [('B4',2),('D5',2)],
 [('C#5',2),('A4',1),('C#5',1)],
 [('A4',2),('D5',1),('A4',1)],
 [('A4',2),('A4',1),('D5',1)],
 [('B4',1),('D5',1),('D5',2)],
 [('A4',2),('A4',1),('G4',1)],
 [('A4',2),('B4',1),('D5',1)],
 [('D5',1),('B4',1),('D5',2)],
 [('C#5',1),('B4',.5),('C#5',.5),('E5',2)],
 [('A4',1),('C#5',1),('A4',1),('C#5',1)],
 [('A4',2),('D5',2)],
 [('D5',2),('A4',2)],
 [('D5',2),('C#5',2)],
 [('D5',4)]
]
VIOLA = [
 [('A3',1),('D4',1),('F#4',1),('D4',1)],
 [('G3',1),('D4',1),('G4',1),('D4',1)],
 [('A3',1),('E4',1),('A3',1),('E4',1)],
 [('F#4',1),('D4',1),('A3',1),('E4',1)],
 [('F#4',1),('D4',1),('E4',1),('D4',1)],
 [('G3',1),('B3',1),('D4',1),('G4',1)],
 [('E4',1),('D4',1),('E4',2)],
 [('F#4',1),('D4',1),('A3',1),('D4',1)],
 [('G4',1),('D4',.5),('B3',.5),('G3',1),('D4',1)],
 [('G4',2),('G4',1),('E4',1)],
 [('F#4',1),('E4',1),('F#4',1),('E4',1)],
 [('F#4',1),('D4',1),('A3',1),('D4',1)],
 [('B3',1),('D4',1),('E4',1),('G4',1)],
 [('B3',1),('D4',1),('G4',1),('E4',1)],
 [('A3',4)]
]
CELLO = [
 [('D3',2),('A2',1),('D3',1)],
 [('D3',2),('G2',1),('B2',1)],
 [('D3',2),('A2',2)],
 [('D3',2),('A2',1.5),('C#3',.5)],
 [('B2',2),('A2',2)],
 [('G2',2),('D3',2)],
 [('A2',2),('E3',1),('A2',1)],
 [('D3',2),('E3',1),('F#3',1)],
 [('G2',1),('B2',1),('D3',1),('G3',1)],
 [('A2',2),('E3',1),('A2',1)],
 [('F#3',2),('C#3',1),('F#3',1)],
 [('B2',2),('F#3',1),('D3',1)],
 [('G2',2),('A2',2)],
 [('G2',2),('A2',2)],
 [('D3',4)]
]
BASS = [
 [('D3',4)],[('D3',4)],[('D3',4)],[('D3',4)],
 [('B2',2),('A2',2)],[('G2',2),('D3',2)],
 [('A2',4)],[('D3',2),('E3',1),('F#3',1)],
 [('G2',4)],[('G3',4)],[('F#3',4)],[('B2',4)],
 [('G2',2),('A2',2)],[('G2',2),('A2',2)],[('D3',4)]
]
PARTS = [
 ('V1','Violin I','Vln. I','G',2,41,MELODY,55,93),
 ('V2','Violin II','Vln. II','G',2,41,VIOLIN_II,55,88),
 ('VA','Viola','Vla.','C',3,42,VIOLA,48,81),
 ('VC','Violoncello','Vc.','F',4,43,CELLO,36,76),
 ('CB','Double Bass','Cb.','F',4,44,BASS,40,72),
]

def el(parent,tag,text=None,**attrs):
 node=ET.SubElement(parent,tag,{k:str(v) for k,v in attrs.items()})
 if text is not None:node.text=str(text)
 return node

def midi(p):
 return (int(p[-1])+1)*12+dict(C=0,D=2,E=4,F=5,G=7,A=9,B=11)[p[0]]+int('#' in p)

def direction(m,text=None,dynamic=None):
 d=el(m,'direction',placement='above' if text else 'below');dt=el(d,'direction-type')
 if text:el(dt,'words',text)
 else:el(el(dt,'dynamics'),dynamic)
 return d

def make_score(selected,title):
 root=ET.Element('score-partwise',version='4.0')
 el(el(root,'work'),'work-title',title)
 ident=el(root,'identification');el(ident,'creator','Editorial arrangement from supplied MIDI transcription',type='arranger')
 enc=el(ident,'encoding');el(enc,'software','Python / MusicXML');el(enc,'encoding-description','Clarified melody, newly arranged inner parts, source bass outline, editorial expression. Double bass written one octave above sounding pitch.')
 defaults=el(root,'defaults');sc=el(defaults,'scaling');el(sc,'millimeters',7);el(sc,'tenths',40)
 plist=el(root,'part-list')
 if len(selected)>1:
  g=el(plist,'part-group',type='start',number=1);el(g,'group-symbol','bracket');el(g,'group-barline','yes')
 for channel,(pid,name,abbr,clef,line,program,bars,low,high) in enumerate(selected,1):
  sp=el(plist,'score-part',id=pid);el(sp,'part-name',name);el(sp,'part-abbreviation',abbr)
  si=el(sp,'score-instrument',id=pid+'I');el(si,'instrument-name',name)
  mi=el(sp,'midi-instrument',id=pid+'I');el(mi,'midi-channel',channel);el(mi,'midi-program',program)
 if len(selected)>1:el(plist,'part-group',type='stop',number=1)
 for pid,name,abbr,clef,line,program,bars,low,high in selected:
  part=el(root,'part',id=pid)
  for b,events in enumerate(bars,1):
   assert sum(d for p,d in events)==4,(pid,b)
   m=el(part,'measure',number=b)
   if len(selected)>1 and b in (5,9,13):el(m,'print',**{'new-system':'yes'})
   if b==1:
    a=el(m,'attributes');el(a,'divisions',2);el(el(a,'key'),'fifths',2)
    t=el(a,'time');el(t,'beats',4);el(t,'beat-type',4)
    c=el(a,'clef');el(c,'sign',clef);el(c,'line',line)
    if pid=='CB':
     tr=el(a,'transpose');el(tr,'diatonic',0);el(tr,'chromatic',0);el(tr,'octave-change',-1)
    d=direction(m,'Andante cantabile (quarter = 76)');el(d,'sound',tempo=76)
    direction(m,'arco, dolce' if pid!='V1' else 'cantabile, espressivo')
   dynamics={1:'mp',5:'mf',9:'f',11:'mf',14:'p',15:'pp'}
   if b in dynamics:direction(m,dynamic=dynamics[b])
   if b==8:direction(m,'poco cresc.')
   if b==13:direction(m,'dim. e poco rit.')
   # Short local slurs denote manageable bow groups, rather than multi-bar breaths.
   slur=(pid in ('V1','V2','VA') and len(events)>1)
   for idx,(pitch,dur) in enumerate(events):
    assert low<=midi(pitch)<=high,(pid,b,pitch)
    n=el(m,'note');p=el(n,'pitch');el(p,'step',pitch[0])
    if '#' in pitch:el(p,'alter',1)
    el(p,'octave',pitch[-1]);el(n,'duration',int(dur*2));el(n,'type',{.5:'eighth',1:'quarter',1.5:'quarter',2:'half',3:'half',4:'whole'}[dur])
    if dur in (1.5,3):el(n,'dot')
    if b==15:el(el(n,'notations'),'fermata')
    elif slur and idx in (0,len(events)-1):el(el(n,'notations'),'slur',type='start' if idx==0 else 'stop',number=1)
   if b==15:el(el(m,'barline',location='right'),'bar-style','light-heavy')
 ET.indent(root)
 return root

def validate(path):
 r=ET.parse(path)
 for p in r.findall('./part'):
  assert len(p.findall('measure'))==15
  for m in p.findall('measure'):
   assert sum(int(n.findtext('duration')) for n in m.findall('note'))==8
   for n in m.findall('note'):
    value={'eighth':1,'quarter':2,'half':4,'whole':8}[n.findtext('type')]
    assert int(n.findtext('duration'))==value*(1.5 if n.find('dot') is not None else 1)
   slurs=[s.get('type') for s in m.findall('./note/notations/slur')]
   assert slurs in ([],['start','stop'])
 # MusicXML bass transposition belongs to each bass part, including standalone export.
 if r.find("./part[@id='CB']") is not None:
  assert r.findtext("./part[@id='CB']/measure/attributes/transpose/octave-change")=='-1'

if __name__=='__main__':
 out=Path(__file__).resolve().parent
 exports=[('test4-strings-score',PARTS)]+[(f'test4-{p[0]}',[p]) for p in PARTS]
 for filename,selected in exports:
  path=out/(filename+'.musicxml')
  ET.ElementTree(make_score(selected,'Piano Theme — String Ensemble' if len(selected)>1 else 'Piano Theme — '+selected[0][1])).write(path,encoding='utf-8',xml_declaration=True)
  validate(path)
  print('Validated',path.name)
