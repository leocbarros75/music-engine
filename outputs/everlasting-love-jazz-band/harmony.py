"""Read supplied chord symbols with slash basses and added degrees."""
import source as n

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
