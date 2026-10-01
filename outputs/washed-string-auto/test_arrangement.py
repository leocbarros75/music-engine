"""Regression and deliberate corruption tests for this particular arrangement."""
import collections, copy, hashlib, unittest
import xml.etree.ElementTree as E
import arrange as a

class ArrangementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root,cls.records,cls.hs,cls.plan=a.read_source()
        cls.events=a.compose(cls.records,cls.plan)
        cls.score=a.build(cls.root,cls.events,cls.plan,list(a.PARTS),True)
    def test_complete_roundtrip(self):
        a.validate(self.root,self.records,self.hs,self.plan,self.events,self.score)
    def test_original_source_hashes(self):
        for file,expected in [('source-rhythm.musicxml','e762fcb4b764bd359d85683e18b24762d38a3cc660e9de7417ea25fa4d930b8a'),('source-rhythm.pdf','4dfc4ca3d17e4abb372361ec766b336e82e8f6ef4f910f0e7d5f52d9a919d601')]:
            self.assertEqual(hashlib.sha256((a.OUT/file).read_bytes()).hexdigest(),expected)
    def test_pickup_and_numbered_duration(self):
        self.assertEqual(a.BARS[0]['length'],8)
        self.assertEqual(len(a.BARS),124)
        self.assertTrue(all(b['length']==32 for b in a.BARS[1:]))
    def test_opening_and_editorial_provenance(self):
        self.assertEqual(sum(e['role']=='source opening melody' for e in self.events),46)
        self.assertEqual([h['bar'] for h in self.plan if h['origin']=='editorial opening harmonization'],list(range(9)))
        self.assertTrue(any(h['kind']=='none' for h in self.hs))
    def test_slashes_never_become_melody(self):
        used={sid for e in self.events for sid in e['sources']}
        classified={x['id']:x['classification'] for x in self.records}
        self.assertTrue(used)
        self.assertTrue(all(classified[sid]=='pitched notation' for sid in used))
    def test_slash_bass_and_anticipation(self):
        h=next(h for h in self.plan if h['bar']==9 and h['on']==0)
        self.assertEqual((h['root'],h['bass']),(11,3)) # B / D#
        self.assertTrue(any(h['bar']==9 and h['on']==28 and h['root']==6 and 11 in h['pcs'] for h in self.plan))
    def test_mode_preparation_rests(self):
        for pid,changes in a.MODE_CHANGES.items():
            for b in changes:
                last=max((e['on']+e['dur'] for e in self.events if e['part']==pid and e['bar']==b-1),default=0)
                self.assertLessEqual(last,a.BARS[b-1]['length']-8,(pid,b))
    def test_parts_match_score(self):
        full=a.decode(self.score)
        for pid in a.PARTS:
            part=a.build(self.root,self.events,self.plan,[pid])
            self.assertEqual(a.decode(part),collections.Counter({k:v for k,v in full.items() if k[0]==pid}))
    def test_wrong_bass_transposition_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='CB']/measure/attributes/transpose/octave-change").text='0'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_note_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='V1']/measure/note/pitch/octave").text='5'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_duration_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='V1']/measure/note/duration").text='8'
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_missing_tie_rejected(self):
        bad=copy.deepcopy(self.score)
        note=next(x for x in bad.findall('.//note') if x.find("tie[@type='start']") is not None)
        note.remove(note.find("tie[@type='start']"))
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_wrong_printed_chord_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='V1']").findall('measure')[9].find('harmony/root/root-step').text='C'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_missing_repeat_rejected(self):
        bad=copy.deepcopy(self.score)
        m=bad.find("part[@id='V1']").findall('measure')[60]
        m.remove(m.find('barline'))
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)

if __name__=='__main__':unittest.main(verbosity=2)
