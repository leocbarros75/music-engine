import unittest,copy,collections
import arrange as a
n=a.n
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.root,cls.piano,_=n.read_source();cls.plan=a.harmony(cls.root);cls.events=a.compose(cls.plan,cls.piano);cls.notes=a.fake_sources(cls.events);cls.score=a.build(cls.root,cls.events,cls.notes,list(n.PARTS),True)
 def test_piano_and_harmony(self):self.assertTrue(a.validate(self.root,self.score,self.events,self.plan)['piano_musical_content_preserved'])
 def test_piano_pitch_corruption_rejected(self):
  bad=copy.deepcopy(self.score);bad.findall('part')[-1].find('.//pitch/octave').text='0'
  with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)
 def test_piano_tempo_corruption_rejected(self):
  bad=copy.deepcopy(self.score);bad.findall('part')[-1].find('.//per-minute').text='100'
  with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)
 def test_orchestra_duration_corruption_rejected(self):
  bad=copy.deepcopy(self.score);bad.find('.//note/duration').text='1'
  with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)
 def test_family_hierarchy_every_section(self):
  for block in a.density(self.events)['sections']:
   f=block['families']
   for metric in ('part_beats','mean_part_activity_percent'):
    self.assertGreater(f['strings'][metric],f['woodwinds'][metric]);self.assertGreater(f['woodwinds'][metric],f['brass'][metric])
 def test_transpositions(self):
  for p in self.score.findall('part')[:-1]:
   pid=p.get('id');att=p.find('./measure/attributes')
   self.assertEqual(int(att.findtext('transpose/chromatic','0'))+12*int(att.findtext('transpose/octave-change','0')),-n.SHIFT.get(pid,(0,0))[1])
 def test_parts_match_full(self):
  for pid in n.PARTS:
   p=a.build(self.root,self.events,self.notes,[pid],False).find('part');q=self.score.find(f"part[@id='{pid}']")
   self.assertEqual([n.canonical(x) for x in p.findall('.//note')],[n.canonical(x) for x in q.findall('.//note')])
 def test_meter_changes(self):
  for p in self.score.findall('part')[:-1]:
   beats=4
   for i,m in enumerate(p.findall('measure')):
    tm=m.find('attributes/time')
    if tm is not None:beats=int(tm.findtext('beats'))
    self.assertEqual(beats,n.BARS[i]['beats'])
 def test_wind_breathing(self):
  for pid in a.WOODS+a.BRASS:
   end=-1;run=0
   for e in (e for e in self.events if e['part']==pid):
    start=n.BARS[e['bar']-1]['start']+e['on'];run=run+e['dur'] if start==end else e['dur'];end=start+e['dur'];self.assertLessEqual(run,24)
 def test_ties_and_slurs(self):
  for pid in n.PARTS:
   seq=[e for e in self.events if e['part']==pid];sl=False
   for i,e in enumerate(seq):
    if e['slur']=='start':self.assertFalse(sl);sl=True
    if e['slur']=='stop':self.assertTrue(sl);sl=False
    if e['tie_start']:
     nxt=seq[i+1];self.assertTrue(nxt['tie_stop']);self.assertEqual(e['midi'],nxt['midi']);self.assertEqual(n.BARS[e['bar']-1]['start']+e['on']+e['dur'],n.BARS[nxt['bar']-1]['start']+nxt['on'])
   self.assertFalse(sl)
 def test_timpani_tuning(self):self.assertTrue(all(e['midi'] in (41,48) for e in self.events if e['part']=='TI'))
 def test_source_copy_note_count(self):self.assertEqual(len(self.piano),1345)
if __name__=='__main__':unittest.main()
