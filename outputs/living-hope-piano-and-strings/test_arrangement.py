import copy, unittest
import arrange as a

class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root,cls.plan,cls.notes=a.read_source()
        cls.events=a.compose(cls.plan)
        cls.score=a.build(cls.root,cls.events,list(a.PARTS))

    def test_preservation_timing_ranges_endings_and_export(self):
        self.assertTrue(a.validate(self.root,self.score,self.events,self.plan)['piano_musical_content_preserved'])

    def test_corrupt_piano_pitch_rejected(self):
        score=copy.deepcopy(self.score)
        score.findall('part')[-1].find('.//pitch/octave').text='0'
        with self.assertRaises(AssertionError):a.validate(self.root,score,self.events,self.plan)

    def test_corrupt_duration_rejected(self):
        score=copy.deepcopy(self.score)
        score.find('./part/measure/note/duration').text='1'
        with self.assertRaises(AssertionError):a.validate(self.root,score,self.events,self.plan)

    def test_suspension_does_not_become_major(self):
        h=next(h for h in self.plan if h['bar']==6)
        self.assertEqual(set(h['pcs']),{10,3,5})  # Bb Eb F; no D

    def test_added_second_retains_third(self):
        h=next(h for h in self.plan if h['bar']==2)
        self.assertEqual(set(h['pcs']),{8,10,0,3})  # Ab Bb C Eb

    def test_slash_bass_preserved(self):
        for b,on,pc in [(30,16,10),(34,0,3),(40,0,2),(41,0,0),(45,16,7),(58,16,7)]:
            h=next(h for h in self.plan if h['bar']==b and h['on']==on)
            self.assertEqual(h['bass'],pc)
        for e in self.events:
            if e['part']=='CB':
                h=next(h for h in self.plan if h['bar']==e['bar'] and h['on']<=e['on']<h['on']+h['dur'])
                self.assertEqual(e['midi']%12,h['bass'])

    def test_harmony_carries_through_bar_48(self):
        self.assertEqual(next(h['name'] for h in self.plan if h['bar']==48),'Eb')

    def test_separate_parts_equal_score(self):
        for pid in a.PARTS:
            part=a.build(self.root,self.events,[pid],False).find('part')
            scorepart=self.score.find(f"part[@id='{pid}']")
            self.assertEqual([a.canonical(n) for n in part.findall('.//note')],
                             [a.canonical(n) for n in scorepart.findall('.//note')])

    def test_final_fermata_and_opening_space(self):
        self.assertFalse(any(e['bar']==1 for e in self.events))
        final=[e for e in self.events if e['bar']==62]
        self.assertEqual(len(final),5)
        self.assertTrue(all(e['fermata'] and e['dur']==32 for e in final))

if __name__=='__main__':unittest.main()
