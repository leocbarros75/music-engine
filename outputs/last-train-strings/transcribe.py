"""Faithful piano-to-string-sections transcription of the supplied score.
Python standard library only. Run: python3 transcribe.py

Preserves every pitched source note segment (onset, duration, pitch class, ties),
with explicit octave adjustments, divisi, and selected added bass doublings.
The orchestration rules are editorial, not an automatic melody-understanding AI.
"""
from __future__ import annotations
import copy, collections, csv, hashlib, json
from dataclasses import dataclass, field
from pathlib import Path
import xml.etree.ElementTree as E

OUT=Path(__file__).resolve().parent
PARTS={
 'V1':('Violin I','Vln. I','G',2,41,55,93),
 'V2':('Violin II','Vln. II','G',2,41,55,93),
 'VA':('Viola','Vla.','C',3,42,48,81),
 'VC':('Violoncello','Vc.','F',4,43,36,76),
 'CB':('Double Bass','Cb.','F',4,44,28,64),
}
STEPS={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}

@dataclass
class SourceNote:
 id:str
 bar:int
 onset:int
 duration:int
 staff:int
 voice:str
 group:int
 midi:int
 xml:E.Element
 chain:str=''
 dest:str=''
 shift:int=0
 added:bool=False


def element(p,tag,text=None,**attrs):
 n=E.SubElement(p,tag,{k:str(v) for k,v in attrs.items()})
 if text is not None:n.text=str(text)
 return n

def clean_positions(n):
 for x in n.iter():
  for a in ('default-x','default-y','relative-x','relative-y','font-family','font-size'):
   x.attrib.pop(a,None)
 return n

def read_source(path):
 root=E.parse(path).getroot();notes=[];directions=collections.defaultdict(list);bars=[];div=0
 for b,m in enumerate(root.findall('./part/measure'),1):
  cursor=0;group=0;previous=0;max_end=0
  for x in m:
   if x.tag=='attributes':
    if x.find('divisions') is not None:div=int(x.findtext('divisions'))
    if x.find('time') is not None:assert x.findtext('time/beats')=='4' and x.findtext('time/beat-type')=='4'
   elif x.tag=='backup':cursor-=int(x.findtext('duration'))
   elif x.tag=='forward':cursor+=int(x.findtext('duration'))
   elif x.tag=='note':
    assert div==60,'This audited score uses 60 divisions throughout'
    duration=int(x.findtext('duration'))
    chord=x.find('chord') is not None
    onset=previous if chord else cursor
    if not chord:group+=1;previous=cursor;cursor+=duration
    max_end=max(max_end,onset+duration)
    p=x.find('pitch')
    if p is not None:
     midi=(int(p.findtext('octave'))+1)*12+STEPS[p.findtext('step')]+int(p.findtext('alter','0'))
     notes.append(SourceNote(f'm{b}-n{len(m.findall("note"))}-{len(notes)+1}',b,onset,duration,int(x.findtext('staff','1')),x.findtext('voice','1'),group,midi,copy.deepcopy(x)))
   elif x.tag=='direction':directions[b].append((cursor+int(x.findtext('offset','0')),copy.deepcopy(x)))
  assert max_end==240,(b,max_end)
  bars.append(m)
 # Chord-level articulations and tuplet boundaries often live on the bottom
 # source note only. Propagate them to each separated section member.
 groups=collections.defaultdict(list)
 for n in notes:groups[(n.bar,n.staff,n.voice,n.group)].append(n)
 for group in groups.values():
  shared=[]
  for n in group:
   for tag in ('articulations','tuplet'):
    shared.extend(copy.deepcopy(x) for x in n.xml.findall('./notations/'+tag))
  for n in group:
   no=n.xml.find('notations')
   if no is None and shared:no=E.SubElement(n.xml,'notations')
   for item in shared:
    if not any(x.tag==item.tag and x.attrib==item.attrib for x in no):no.append(copy.deepcopy(item))
 # Link ties before assigning instruments; a continuation may change chord rank.
 active={}
 for n in notes:
  ties={x.get('type') for x in n.xml.findall('tie')};key=(n.staff,n.voice,n.midi)
  if 'stop' in ties:
   assert key in active,('Orphan source tie',n.id)
   previous=active.pop(key)
   assert (previous.bar-1)*240+previous.onset+previous.duration==(n.bar-1)*240+n.onset,('Noncontiguous tie',n.id)
   n.chain=previous.chain
  else:n.chain=n.id
  if 'start' in ties:active[key]=n
 assert not active,('Unclosed source ties',active.keys())
 return root,bars,notes,directions


def orchestrate(notes):
 groups=collections.defaultdict(list)
 for n in notes:groups[(n.bar,n.staff,n.voice,n.group)].append(n)
 decisions={}
 for key,group in groups.items():
  ordered=sorted(group,key=lambda n:n.midi,reverse=True)
  for rank,n in enumerate(ordered):
   if n.chain in decisions:n.dest,n.shift=decisions[n.chain];continue
   if n.staff==1:
    dest='V1' if rank==0 else 'V2' if rank==1 else 'VA'
   else:
    # High LH writing is an inner voice, not automatically a bass instrument.
    if n.midi>=60:dest='V2' if rank==0 and len(group)>1 else 'VA'
    elif rank==len(group)-1:dest='VC'
    else:dest='VA' if n.midi>=48 else 'VC'
   shift=-12 if n.staff==1 and 73<=n.bar<=76 else 0
   low,high=PARTS[dest][-2:]
   while n.midi+shift<low:shift+=12
   while n.midi+shift>high:shift-=12
   n.dest=dest;n.shift=shift;decisions[n.chain]=(dest,shift)
 # Bass is an explicitly ADDED supporting doubling, not a fabricated harmony.
 # Only source bass attacks on quarter boundaries, >= eighth length, <= G3.
 # Preserve the whole tie chain for any selected attack; use standard low E.
 chains=collections.defaultdict(list)
 for n in notes:chains[n.chain].append(n)
 extras=[]
 for chain in chains.values():
  n=chain[0]
  group=groups[(n.bar,n.staff,n.voice,n.group)]
  if n.staff!=2 or n.midi!=min(x.midi for x in group) or n.midi>55 or n.onset%60 or n.duration<30:continue
  shift=-12 if n.midi-12>=28 else 0
  for original in chain:
   d=copy.deepcopy(original);d.dest='CB';d.shift=shift;d.added=True;d.id='double-'+original.id;extras.append(d)
 return notes+extras


def add_rest(measure,duration,voice,hidden=False,whole=False):
 """Use ordinary binary rests wherever possible; exact tuplet remainder only
 when source quintuplet/triplet boundaries require a nonbinary gap.
 """
 if duration==0:return
 if whole:
  n=element(measure,'note',**({'print-object':'no'} if hidden else {}));element(n,'rest',measure='yes');element(n,'duration',duration);element(n,'voice',voice);return
 standard=[(240,'whole',0),(180,'half',1),(120,'half',0),(90,'quarter',1),(60,'quarter',0),(45,'eighth',1),(30,'eighth',0),(15,'16th',0)]
 import math
 while duration:
  choices=[x for x in standard if x[0]<=duration]
  if choices:amount,typ,dot=choices[0];ratio=None
  else:
   amount=duration;typ='16th';dot=0;g=math.gcd(15,amount);ratio=(15//g,amount//g)
  n=element(measure,'note',**({'print-object':'no'} if hidden else {}));element(n,'rest');element(n,'duration',amount);element(n,'voice',voice);element(n,'type',typ)
  if dot:element(n,'dot')
  if ratio:
   tm=element(n,'time-modification');element(tm,'actual-notes',ratio[0]);element(tm,'normal-notes',ratio[1])
  duration-=amount


def write_note(n,voice,chord,stem=None):
 x=clean_positions(copy.deepcopy(n.xml))
 for tag in ('chord','staff','voice','stem','beam','lyric'):
  for child in x.findall(tag):x.remove(child)
 if chord:x.insert(0,E.Element('chord'))
 p=x.find('pitch');p.find('octave').text=str(int(p.findtext('octave'))+n.shift//12+(1 if n.dest=='CB' else 0))
 # Original engraving accidentals are safe to remove: altered pitches remain
 # explicit in <pitch>, and the notation program recalculates accidental display.
 for child in x.findall('accidental'):x.remove(child)
 i=list(x).index(x.find('type')) if x.find('type') is not None else len(x)
 v=E.Element('voice');v.text=str(voice);x.insert(i,v)
 if stem:
  s=E.Element('stem');s.text=stem
  # stem belongs after time-modification, before notations.
  ix=list(x).index(x.find('notations')) if x.find('notations') is not None else len(x);x.insert(ix,s)
 return x


def copied_direction(measure,onset,source):
 """Transfer expressive dynamics/hairpins/tempo, not piano pedals or ottava.
 MusicXML pitch already carries its octave; do not transpose an ottava twice.
 """
 x=clean_positions(copy.deepcopy(source))
 for tag in ('staff','offset'): 
  for child in x.findall(tag):x.remove(child)
 for dt in list(x.findall('direction-type')):
  for child in list(dt):
   if child.tag in ('pedal','octave-shift') or (child.tag=='words' and (child.text or '').strip()=='.4'):dt.remove(child)
  if len(dt)==0:x.remove(dt)
 if not x.findall('direction-type'):return
 for per in x.findall('./direction-type/metronome/per-minute'):per.text='121.4'
 if onset:
  off=E.Element('offset');off.text=str(onset)
  types=x.findall('direction-type');x.insert(list(x).index(types[-1])+1,off)
 measure.append(x)


def build(root,bars,notes,directions,selected,full=True):
 score=E.Element('score-partwise',version='4.0')
 element(element(score,'work'),'work-title','Last Train to London')
 # Explicit print credits below retain source authorship without replacing the title.
 ident=element(score,'identification');element(ident,'creator','Jeff Lynne',type='composer');element(ident,'creator','Piano: Zach V. | Strings: editorial transcription',type='arranger')
 enc=element(ident,'encoding');element(enc,'software','Source-preserving Python transcription');element(enc,'encoding-description','Five string sections; divisi where multiple notes/voices occur. Source pitches retained or octave adjusted; bass doublings separately audited.')
 defaults=element(score,'defaults');sc=element(defaults,'scaling');element(sc,'millimeters',6.5 if full else 7);element(sc,'tenths',40)
 pg=element(defaults,'page-layout');element(pg,'page-height',1828 if full else 1697);element(pg,'page-width',1293 if full else 1200)
 margin=element(pg,'page-margins',type='both')
 for tag in ('left-margin','right-margin','top-margin','bottom-margin'):element(margin,tag,70)
 # Explicit title/subtitle credits: movement-title is treated as the main title
 # by some importers, so do not use it for an instrumentation subtitle.
 page_w,page_h=(1293,1828) if full else (1200,1697)
 for kind,text,size,x,y,justify in [
  ('title','Last Train to London',22,page_w/2,page_h-70,'center'),
  ('subtitle','String orchestra | Piano arrangement: Zach V.',11,page_w/2,page_h-120,'center'),
  ('composer','Jeff Lynne',11,page_w-70,page_h-155,'right')]:
  cr=element(score,'credit',page=1);element(cr,'credit-type',kind);element(cr,'credit-words',text,**{'font-size':size,'default-x':x,'default-y':y,'justify':justify,'valign':'top'})
 pl=element(score,'part-list')
 if full:g=element(pl,'part-group',type='start',number=1);element(g,'group-symbol','bracket');element(g,'group-barline','yes')
 for idx,pid in enumerate(selected,1):
  nm,abbr,clef,line,program,lo,hi=PARTS[pid]
  sp=element(pl,'score-part',id=pid);element(sp,'part-name',nm);element(sp,'part-abbreviation',abbr)
  si=element(sp,'score-instrument',id=pid+'I');element(si,'instrument-name',nm)
  mi=element(sp,'midi-instrument',id=pid+'I');element(mi,'midi-channel',idx);element(mi,'midi-program',program)
 if full:element(pl,'part-group',type='stop',number=1)
 for pid in selected:
  part=element(score,'part',id=pid);mine=[n for n in notes if n.dest==pid]
  streams=sorted({(n.staff,n.voice) for n in mine});stream_ids={s:i+1 for i,s in enumerate(streams)}
  nm,abbr,clef,line,program,lo,hi=PARTS[pid]
  for b,original in enumerate(bars,1):
   m=element(part,'measure',number=b)
   if full and b in range(1,len(bars)+1,4):
    pr=element(m,'print',**({'new-system':'yes'} if b>1 else {}))
    if b>1:element(element(pr,'system-layout'),'system-distance',95)
   if not full and b in ((45,85) if pid in ('V1','VC') else () if pid=='CB' else (65,)):
    element(m,'print',**{'new-page':'yes'})
   if b==1:
    a=element(m,'attributes');element(a,'divisions',60);element(element(a,'key'),'fifths',1);t=element(a,'time');element(t,'beats',4);element(t,'beat-type',4)
    c=element(a,'clef');element(c,'sign',clef);element(c,'line',line)
    if pid=='CB':tr=element(a,'transpose');element(tr,'diatonic',0);element(tr,'chromatic',0);element(tr,'octave-change',-1)
    d=element(m,'direction',placement='above');dt=element(d,'direction-type')
    element(dt,'words',{'V1':'Arco; divisi. Discreet bow changes through ties.','V2':'Arco; divisi as written.','VA':'Arco; up to four-way divisi.','VC':'Arco, light détaché; up to three-way divisi.','CB':'Arco; light supporting pulse.'}[pid])
   for on,d in directions[b]:
    source_staff=int(d.findtext('staff','1'))
    if source_staff==1 or pid in ('VC','CB'):copied_direction(m,on,d)
   for source_bar in original.findall("barline[@location='left']"):m.append(copy.deepcopy(source_bar))
   events=[n for n in mine if n.bar==b]
   active_streams=sorted({(n.staff,n.voice) for n in events})
   if not events:add_rest(m,240,1,whole=True)
   for lane,stream in enumerate(active_streams):
    if lane:element(element(m,'backup'),'duration',240)
    voice=stream_ids[stream];seq=[n for n in events if (n.staff,n.voice)==stream]
    groups=collections.defaultdict(list)
    for n in seq:groups[(n.onset,n.duration)].append(n)
    at=0
    for (on,dur),chord in sorted(groups.items()):
     assert on>=at,(pid,b,stream,'overlap within source stream')
     add_rest(m,on-at,voice,hidden=lane>0)
     for j,n in enumerate(sorted(chord,key=lambda n:n.midi+n.shift)):
      m.append(write_note(n,voice,j>0,('up' if lane==0 else 'down') if len(active_streams)>1 else None))
     at=on+dur
    add_rest(m,240-at,voice,hidden=lane>0)
   for source_bar in original.findall("barline[@location='right']"):m.append(copy.deepcopy(source_bar))
 E.indent(score);return score


def output_events(root):
 result=[]
 for part in root.findall('part'):
  transpose=int(part.findtext('./measure/attributes/transpose/octave-change','0'))*12
  for m in part.findall('measure'):
   at=0;previous=0;end=0
   for n in m:
    if n.tag=='backup':at-=int(n.findtext('duration'))
    elif n.tag=='note':
     dur=int(n.findtext('duration'));ch=n.find('chord') is not None;on=previous if ch else at
     p=n.find('pitch')
     if p is not None:
      midi=(int(p.findtext('octave'))+1)*12+STEPS[p.findtext('step')]+int(p.findtext('alter','0'))+transpose
      result.append((part.get('id'),int(m.get('number')),on,dur,midi,tuple(sorted(x.get('type') for x in n.findall('tie')))))
     if not ch:previous=at;at+=dur
     end=max(end,on+dur)
   assert end==240,(part.get('id'),m.get('number'),end)
 return collections.Counter(result)


def main():
 root,bars,source,directions=read_source(OUT/'source.musicxml')
 assigned=orchestrate(source)
 # Source-note mapping includes no omission: every primary ID exactly once.
 assert len([n for n in assigned if not n.added])==len(source)
 assert len({n.id for n in source})==len(source)
 for n in assigned:assert PARTS[n.dest][-2]<=n.midi+n.shift<=PARTS[n.dest][-1]
 score=build(root,bars,assigned,directions,list(PARTS))
 expected=collections.Counter((n.dest,n.bar,n.onset,n.duration,n.midi+n.shift,tuple(sorted(x.get('type') for x in n.xml.findall('tie')))) for n in assigned)
 for filename,selected in [('last-train-string-score',list(PARTS))]+[('last-train-'+p,[p]) for p in PARTS]:
  result=score if len(selected)>1 else build(root,bars,assigned,directions,selected,False)
  path=OUT/(filename+'.musicxml');E.ElementTree(result).write(path,encoding='utf-8',xml_declaration=True)
  reopened=E.parse(path).getroot();got=output_events(reopened)
  assert got==collections.Counter({k:v for k,v in expected.items() if k[0] in selected}),filename
  for part in reopened.findall('part'):
   for m,src in zip(part.findall('measure'),bars):
    assert [(x.get('location'),x.findtext('bar-style'),[(c.tag,tuple(sorted(c.attrib.items())),(c.text or '').strip()) for c in x if c.tag!='bar-style']) for x in m.findall('barline')]==[(x.get('location'),x.findtext('bar-style'),[(c.tag,tuple(sorted(c.attrib.items())),(c.text or '').strip()) for c in x if c.tag!='bar-style']) for x in src.findall('barline')]
 changes=[{'source_id':n.id,'bar':n.bar,'onset_beats':n.onset/60,'duration_beats':n.duration/60,'source_staff':n.staff,'source_voice':n.voice,'source_midi':n.midi,'destination':n.dest,'sounding_midi':n.midi+n.shift,'octave_shift':n.shift//12,'added_doubling':n.added,'tie_chain':n.chain} for n in assigned]
 (OUT/'note-map.json').write_text(json.dumps(changes,indent=2))
 with (OUT/'note-map.csv').open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(changes[0]));w.writeheader();w.writerows(changes)
 max_div={}
 for pid in PARTS:
  maximum=0
  for b in range(1,len(bars)+1):
   ev=[n for n in assigned if n.dest==pid and n.bar==b]
   for t in {n.onset for n in ev}:maximum=max(maximum,sum(n.onset<=t<n.onset+n.duration for n in ev))
  max_div[pid]=maximum
 summary={'measures':len(bars),'source_pitched_note_segments':len(source),'primary_segments_preserved':len(source),'omitted_segments':0,'octave_adjusted_primary_segments':sum(n.shift!=0 for n in source),'added_bass_segments':sum(n.added for n in assigned),'maximum_simultaneous_notes_per_section':max_div,'source_sha256':hashlib.sha256((OUT/'source.musicxml').read_bytes()).hexdigest()}
 (OUT/'validation.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
