import copy,unittest
import transcribe as t

class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root,cls.notes,cls.directions=t.read_source()
        cls.events=t.reduce(cls.notes)
        cls.score=t.build(cls.root,cls.notes,cls.events,cls.directions,list(t.PARTS),True)

    def test_roundtrip_ranges_repeats_source_mapping(self):
        report,_=t.validate(self.root,self.notes,self.events,self.score)
        self.assertEqual(report['new_pitch_classes'],0)

    def test_source_sustains_cover_every_retained_event(self):
        lookup={n['id']:n for n in self.notes}
        for e in self.events:
            for time in range(e['on'],e['on']+e['dur']):
                self.assertTrue(any(lookup[s]['on']<=time<lookup[s]['on']+lookup[s]['dur'] for s in e['sources']))

    def test_flute_is_original_upper_envelope_plus_octave(self):
        for e in self.events:
            if e['part']!='FL':continue
            for time in range(e['on'],e['on']+e['dur']):
                active=[n['midi'] for n in self.notes if n['bar']==e['bar'] and n['staff']==1 and n['on']<=time<n['on']+n['dur']]
                self.assertEqual(e['midi'],max(active)+12)

    def test_clarinet_transposition_and_key(self):
        p=self.score.find("part[@id='CL']")
        self.assertEqual(p.findtext('./measure/attributes/key/fifths'),'-1')
        self.assertEqual(p.findtext('./measure/attributes/transpose/chromatic'),'-2')
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='CL']/measure/note/pitch/octave").text='1'
        with self.assertRaises(AssertionError):t.validate(self.root,self.notes,self.events,bad)

    def test_written_breath_releases_are_exactly_an_eighth(self):
        for e in self.events:
            if e['trim']:
                self.assertEqual(e['trim'],4);self.assertTrue(e['breath']);self.assertFalse(e['tie_start'])
                self.assertEqual(e['on']+e['dur'],28)

    def test_tie_endpoints_are_contiguous_and_same_pitch(self):
        for pid in t.PARTS:
            seq=[e for e in self.events if e['part']==pid]
            for i,e in enumerate(seq):
                if e['tie_start']:
                    n=seq[i+1];self.assertTrue(n['tie_stop']);self.assertEqual(e['midi'],n['midi'])
                    self.assertEqual((e['bar']-1)*32+e['on']+e['dur'],(n['bar']-1)*32+n['on'])
                if e['tie_stop']:self.assertTrue(i and seq[i-1]['tie_start'])

    def test_slurs_close_and_never_cross_a_breath(self):
        for pid in t.PARTS:
            opened=False
            for e in (e for e in self.events if e['part']==pid):
                if e['slur']=='start':self.assertFalse(opened);opened=True
                if opened:self.assertFalse(e['breath'])
                if e['slur']=='stop':self.assertTrue(opened);opened=False
            self.assertFalse(opened)

    def test_parts_match_full_score(self):
        for pid in t.PARTS:
            part=t.build(self.root,self.notes,self.events,self.directions,[pid],False)
            actual=t.decode(part)
            expected={k:v for k,v in t.decode(self.score).items() if k[0]==pid}
            self.assertEqual(actual,expected)

    def test_corrupt_duration_rejected(self):
        score=copy.deepcopy(self.score);score.find('./part/measure/note/duration').text='1'
        with self.assertRaises(AssertionError):t.validate(self.root,self.notes,self.events,score)

if __name__=='__main__':unittest.main()
