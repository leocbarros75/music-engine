import copy
from notation import el

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
    # Keep the source's mp-to-mf range readable as one visual object.
    # This changes display encoding, not the instruction or any note.
    for dt in x.findall('.//direction-type'):
        dyn=dt.find('dynamics')
        if dyn is not None and len(dyn)>1:
            label=' '.join((n.text or '') if n.tag=='other-dynamics' else n.tag for n in dyn)
            dt.remove(dyn);el(dt,'words',label,**{'font-style':'italic'})
    # Two simultaneous below-staff instructions in source m35 otherwise
    # collide. Join their text into one instruction without changing meaning.
    for m in x.findall('measure'):
        if m.get('number')!='35':continue
        range_word=next((w for w in m.findall('./direction/direction-type/words') if w.text=='mp - mf'),None)
        if range_word is not None:
            for d in list(m.findall('direction')):
                w=d.find('./direction-type/words')
                if w is not None and w.text=='2x - more motion':
                    range_word.text+='; '+w.text;m.remove(d)
    return x

