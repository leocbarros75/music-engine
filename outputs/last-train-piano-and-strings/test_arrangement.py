"""Musical integrity checks; run python3 -m unittest -v in this folder."""
import copy, unittest
import arrange as a

class ArrangementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=a.unpack()
        cls.events,cls.plan=a.compose(a.piano_events(cls.source))
        cls.score=a.build(cls.source,cls.events,list(a.PARTS),True)

    def test_piano_export_ranges_timing_and_repeats(self):
        self.assertTrue(a.validate(self.source,self.score,self.events)['piano_musical_xml_preserved'])

    def test_modified_piano_pitch_is_rejected(self):
        broken=copy.deepcopy(self.score)
        broken.findall('part')[-1].find('.//pitch/octave').text='1'
        with self.assertRaises(AssertionError):a.validate(self.source,broken,self.events)

    def test_wrong_string_duration_is_rejected(self):
        broken=copy.deepcopy(self.score)
        broken.find('./part/measure/note/duration').text='1'
        with self.assertRaises(AssertionError):a.validate(self.source,broken,self.events)

    def test_every_new_note_fits_local_editorial_harmony(self):
        for e in self.events:
            if e['part']=='CB':continue  # bass follows source bass, including inversions
            h=next(h for h in self.plan if h['bar']==e['bar'] and h['on']<=e['on']<h['on']+h['dur'])
            self.assertIn(e['midi']%12,a.CHORDS[h['chord']])
            self.assertLessEqual(e['on']+e['dur'],h['on']+h['dur'])

    def test_intended_piano_only_breaks(self):
        self.assertFalse(any(e['bar'] in (5,6,103,110,123) for e in self.events))

    def test_slurs_are_closed_short_and_monophonic(self):
        for pid in a.PARTS:
            active=None
            for e in (x for x in self.events if x['part']==pid):
                time=(e['bar']-1)*240+e['on']
                if e['slur']=='start':
                    self.assertIsNone(active);active=time
                if e['slur']=='stop':
                    self.assertIsNotNone(active)
                    self.assertLessEqual(time+e['dur']-active,240);active=None
            self.assertIsNone(active)

    def test_individual_parts_match_full_score_notes(self):
        for pid in a.PARTS:
            separate=a.build(self.source,self.events,[pid],False).find('part')
            full=self.score.find(f"part[@id='{pid}']")
            self.assertEqual([a.canonical(x) for x in separate.findall('.//note')],
                             [a.canonical(x) for x in full.findall('.//note')])

    def test_bass_punctuation_uses_source_bass_pitch_class(self):
        source=a.piano_events(self.source)
        for e in self.events:
            if e['part']!='CB':continue
            bass=[n['midi'] for n in source if n['bar']==e['bar'] and n['staff']==2 and n['on']==0]
            self.assertTrue(bass)
            self.assertEqual(e['midi']%12,min(bass)%12)

if __name__=='__main__':unittest.main()
