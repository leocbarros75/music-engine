"""MusicXML primitives; all output timing uses eight units per quarter."""
import copy
import xml.etree.ElementTree as E

STEP={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}

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

def beam_measure(m):
    """Explicit metrical beams for fast notes, since importer defaults vary."""
    at=0;groups=[];group=[]
    for n in m.findall('note'):
        dur=int(n.findtext('duration'))
        eligible=(n.find('pitch') is not None or n.find('unpitched') is not None) and n.findtext('type') in ('eighth','16th','32nd')
        if not eligible or (group and group[-1][1]//8!=at//8):
            if group:groups.append(group);group=[]
        if eligible:group.append((n,at))
        at+=dur
    if group:groups.append(group)
    for group in groups:
        if len(group)<2:continue
        for j,(n,_) in enumerate(group):
            levels={'eighth':1,'16th':2,'32nd':3}[n.findtext('type')]
            for level in range(1,levels+1):
                left=j>0 and {'eighth':1,'16th':2,'32nd':3}[group[j-1][0].findtext('type')]>=level
                right=j+1<len(group) and {'eighth':1,'16th':2,'32nd':3}[group[j+1][0].findtext('type')]>=level
                value='continue' if left and right else 'end' if left else 'begin' if right else 'forward hook' if j==0 else 'backward hook'
                beam=E.Element('beam',number=str(level));beam.text=value
                no=n.find('notations');n.insert(list(n).index(no) if no is not None else len(n),beam)
