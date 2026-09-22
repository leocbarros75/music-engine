"""Run `python3 -m unittest -v` in this folder."""
import collections, copy, unittest
import xml.etree.ElementTree as E
import transcribe as t

class TranscriptionTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.root,cls.bars,cls.source,cls.directions=t.read_source(t.OUT/'source.musicxml')
  cls.assigned=t.orchestrate(cls.source)
  cls.score=t.build(cls.root,cls.bars,cls.assigned,cls.directions,list(t.PARTS))

 def test_all_source_segments_accounted_for_once(self):
  primary=[n for n in self.assigned if not n.added]
  self.assertEqual(len(primary),1942)
  self.assertEqual(len({n.id for n in primary}),1942)
  self.assertTrue(all(n.dest for n in primary))

 def test_exact_timeline_and_pitch_class_in_export(self):
  expected=collections.Counter((n.dest,n.bar,n.onset,n.duration,n.midi+n.shift,tuple(sorted(x.get('type') for x in n.xml.findall('tie')))) for n in self.assigned)
  self.assertEqual(t.output_events(self.score),expected)
  self.assertTrue(all(n.shift%12==0 for n in self.assigned))

 def test_tie_chains_keep_instrument_and_register(self):
  chains=collections.defaultdict(set)
  for n in self.source:chains[n.chain].add((n.dest,n.shift))
  self.assertTrue(all(len(c)==1 for c in chains.values()))

 def test_sounding_ranges_include_bass_transposition(self):
  for n in self.assigned:
   lo,hi=t.PARTS[n.dest][-2:]
   self.assertTrue(lo<=n.midi+n.shift<=hi)
  self.assertEqual(self.score.findtext("./part[@id='CB']/measure/attributes/transpose/octave-change"),'-1')

 def test_triplet_durations_are_not_quantized(self):
  notes=[n for n in self.source if n.bar==4 and n.voice=='2']
  self.assertEqual({n.duration for n in notes},{40})
  self.assertEqual(sorted({n.onset for n in notes}),[0,40,80,120,160,200])

 def test_bass_additions_are_traceable_source_doublings(self):
  original={n.id:n for n in self.source}
  for n in self.assigned:
   if n.added:
    src=original[n.id.removeprefix('double-')]
    self.assertEqual((n.bar,n.onset,n.duration,n.midi),(src.bar,src.onset,src.duration,src.midi))
    self.assertEqual(n.dest,'CB')

 def test_export_contains_no_piano_pedals_or_ottavas(self):
  self.assertEqual(self.score.findall('.//pedal'),[])
  self.assertEqual(self.score.findall('.//octave-shift'),[])

 def test_corrupt_duration_is_detected(self):
  broken=copy.deepcopy(self.score)
  n=broken.find('./part/measure/note')
  n.find('duration').text='241'
  with self.assertRaises(AssertionError):t.output_events(broken)

if __name__=='__main__':unittest.main()
