import copy,unittest
import arrange as a

class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root,cls.plan,cls.notes=a.read_source()
        cls.events=a.compose(cls.plan)
        cls.score=a.build(cls.root,cls.events,list(a.PARTS))

    def test_preservation_pitch_timing_harmony_and_repeats(self):
        self.assertTrue(a.validate(self.root,self.score,self.events,self.plan)['piano_musical_content_preserved'])

    def test_piano_pitch_change_is_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.findall('part')[-1].find('.//pitch/octave').text='0'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

    def test_piano_direction_change_is_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.findall('part')[-1].find('.//per-minute').text='100'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

    def test_clarinet_is_written_in_f_major_and_transposes_down(self):
        p=self.score.find("part[@id='CL']")
        self.assertEqual(p.findtext('./measure/attributes/key/fifths'),'-1')
        self.assertEqual(p.findtext('./measure/attributes/transpose/chromatic'),'-2')
        self.assertEqual(p.findtext('./measure/attributes/transpose/diatonic'),'-1')

    def test_breathing_rests_limit_continuous_playing(self):
        for pid in a.PARTS:
            end=-1;run=0
            for e in (e for e in self.events if e['part']==pid and e['bar']<62):
                start=(e['bar']-1)*32+e['on']
                run=run+e['dur'] if start==end else e['dur'];end=start+e['dur']
                self.assertLessEqual(run,32,(pid,e['bar'],run))

    def test_harmonic_suspensions_additions_and_slash_bass(self):
        self.assertEqual(set(next(h['pcs'] for h in self.plan if h['bar']==6)),{10,3,5})
        self.assertEqual(set(next(h['pcs'] for h in self.plan if h['bar']==2)),{8,10,0,3})
        for e in self.events:
            if e['part']=='BN':
                h=next(h for h in self.plan if h['bar']==e['bar'] and h['on']<=e['on']<h['on']+h['dur'])
                self.assertEqual(e['midi']%12,h['bass'])

    def test_parts_match_full_score(self):
        for pid in a.PARTS:
            part=a.build(self.root,self.events,[pid],False).find('part')
            combined=self.score.find(f"part[@id='{pid}']")
            self.assertEqual([a.canonical(n) for n in part.findall('.//note')],
                             [a.canonical(n) for n in combined.findall('.//note')])

    def test_piano_only_openings_and_final_release(self):
        self.assertFalse(any(e['bar'] in (1,5) for e in self.events))
        final=[e for e in self.events if e['bar']==62]
        self.assertEqual(len(final),4)
        self.assertTrue(all(e['fermata'] and e['dur']==32 for e in final))

    def test_corrupt_wind_duration_is_rejected(self):
        bad=copy.deepcopy(self.score);bad.find('./part/measure/note/duration').text='1'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

if __name__=='__main__':unittest.main()
