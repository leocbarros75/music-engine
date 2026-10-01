"""Source parsing, exact integer timing, and MusicXML primitives."""
from pathlib import Path
import collections,copy
import xml.etree.ElementTree as E

OUT=Path(__file__).resolve().parent

STEP={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}

BARS=[]

def el(p,tag,text=None,**attrs):
    n=E.SubElement(p,tag,{k:str(v) for k,v in attrs.items()})
    if text is not None:n.text=str(text)
    return n

def canonical(x):
    return x.tag,tuple(sorted(x.attrib.items())),(x.text or '').strip(),tuple(canonical(c) for c in x)

def clean(x):
    x=copy.deepcopy(x)
    for n in x.iter():
        for a in ('default-x','default-y','relative-x','relative-y','end-length','font-family'):
            n.attrib.pop(a,None)
    return x

def read_source():
    root=E.parse(OUT/'original-piano.musicxml').getroot();notes=[];directions=collections.defaultdict(list)
    active={};beats=4;beat_type=4;BARS.clear()
    for b,m in enumerate(root.findall('./part/measure'),1):
        at=previous=end=0
        for x in m:
            if x.tag=='attributes':
                if x.find('divisions') is not None:assert x.findtext('divisions')=='8'
                if x.find('time') is not None:beats=int(x.findtext('time/beats'));beat_type=int(x.findtext('time/beat-type'))
            elif x.tag=='backup':at-=int(x.findtext('duration'))
            elif x.tag=='forward':at+=int(x.findtext('duration'))
            elif x.tag=='direction':directions[b].append((at+int(x.findtext('offset','0')),clean(x)))
            elif x.tag=='note':
                dur=int(x.findtext('duration','0'));on=previous if x.find('chord') is not None else at
                if x.find('chord') is None:previous=at;at+=dur
                end=max(end,on+dur)
                if x.find('pitch') is None:continue
                p=x.find('pitch');midi=(int(p.findtext('octave'))+1)*12+STEP[p.findtext('step')]+int(p.findtext('alter','0'))
                sid=f'm{b}-n{len(notes)+1}';staff=int(x.findtext('staff','1'));voice=x.findtext('voice','1')
                ties={t.get('type') for t in x.findall('tie')};key=(staff,voice,midi)
                chain=active.pop(key) if 'stop' in ties else sid
                if 'start' in ties:active[key]=chain
                notes.append(dict(id=sid,bar=b,on=on,dur=dur,midi=midi,staff=staff,voice=voice,chain=chain,xml=copy.deepcopy(x)))
        length=beats*32//beat_type;assert end==length,(b,end,length)
        BARS.append({'length':length,'beats':beats,'beat_type':beat_type,'start':sum(x['length'] for x in BARS)})
    assert not active
    return root,notes,directions

def octave(pc,target,lo,hi):
    return min((p for p in range(lo,hi+1) if p%12==pc),key=lambda p:(abs(p-target),p))

def direction(m,text=None,dynamic=None,rehearsal=None):
    d=el(m,'direction',placement='above' if text or rehearsal else 'below');dt=el(d,'direction-type')
    if text:el(dt,'words',text)
    if dynamic:el(el(dt,'dynamics'),dynamic)
    if rehearsal:el(dt,'rehearsal',rehearsal)
    return d

VALUES={32:('whole',False),24:('half',True),16:('half',False),12:('quarter',True),
        8:('quarter',False),6:('eighth',True),4:('eighth',False),3:('16th',True),2:('16th',False),1:('32nd',False)}

def chunks(on,dur):
    """Split uncommon/misgrouped lengths into conventional tied values."""
    if dur in VALUES and not (on%8 and dur>8):return [dur]
    result=[]
    while dur:
        limit=8-on%8 if on%8 else dur
        d=max(x for x in VALUES if x<=min(dur,limit))
        result.append(d);on+=d;dur-=d
    return result

def rest(m,on,dur):
    for length in chunks(on,dur) if dur else []:
        n=el(m,'note');el(n,'rest',**({'measure':'yes'} if length==32 else {}));el(n,'duration',length)
        typ,dot=VALUES[length];el(n,'type',typ)
        if dot:el(n,'dot')
        on+=length
