"""Musically meaningful regression checks. Run: python3 -m unittest -v"""
import copy
import unittest
from pathlib import Path
import xml.etree.ElementTree as E
import arrange as a

class ArrangementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=E.parse(Path(__file__).with_name('source.musicxml')).getroot()
        cls.hs,_=a.scan(cls.source.find('part'))
        cls.v=a.choose_voicings(cls.hs)
        cls.bars,cls.analysis=a.accompaniment(cls.hs,cls.v)
        cls.out=a.build(cls.source,cls.hs,cls.bars)

    def test_harmony_cursor_and_slash_bass(self):
        h=[x for x in self.hs if x.measure==2]
        self.assertEqual([x.onset for x in h],[a.F(0),a.F(2)])
        self.assertEqual(h[1].label,'G/B');self.assertEqual(h[1].bass,11)

    def test_original_melody_and_form_preserved(self):
        self.assertEqual(a.validate(self.source,self.out,self.bars)['melody_notes_and_rests'],147)

    def test_voicings_contain_source_triads(self):
        for h,v in zip(self.hs,self.v):
            self.assertEqual({n%12 for n in v},h.pcs)
            self.assertLessEqual(v[-1]-v[0],12)

    def test_neighbor_is_stepwise_and_resolves(self):
        for b in a.NEIGHBOR_BARS:
            ev=self.bars[b]['rh'];anchor,neighbor,resolution=ev[1:4]
            self.assertEqual(anchor['pitches'],resolution['pitches'])
            self.assertIn(neighbor['pitches'][0]-anchor['pitches'][0],(1,2))
            h=next(h for h in self.hs if h.measure==b)
            self.assertNotIn(neighbor['pitches'][0]%12,h.pcs)
            self.assertEqual(sum(x['beats'] for x in ev[:2]),a.F(5,2))

    def test_chromatic_spelling(self):
        self.assertEqual(a.name(68,8,'major'),'Ab4')
        self.assertEqual(a.name(68,8,'diminished'),'G#4')
        self.assertEqual(a.name(68,4,'major'),'G#4')

    def test_validator_detects_hand_collision(self):
        bad=copy.deepcopy(self.bars)
        bad[1]['lh'][0]['pitches']=[bad[1]['rh'][0]['pitches'][0]]
        with self.assertRaisesRegex(AssertionError,'Hand overlap'):
            a.validate(self.source,self.out,bad)

if __name__=='__main__':unittest.main()
