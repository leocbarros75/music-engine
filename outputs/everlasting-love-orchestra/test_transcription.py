"""Run: python3 -m unittest discover -s . -p 'test_*.py' -v"""
import copy, unittest, collections
import transcribe as t
class TranscriptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root,cls.notes,cls.directions=t.read_source();cls.events=t.reduce(cls.notes)
        cls.score=t.build(cls.root,cls.notes,cls.events,cls.directions,list(t.PARTS),True)
    def test_full_validation(self):
        report,_=t.validate(self.root,self.notes,self.events,self.score)
        self.assertEqual(report['new_pitch_classes'],0)
    def test_transposing_keys(self):
        for p in self.score.findall('part'):
            pid=p.get('id');a=p.find('./measure/attributes')
            expected=1 if pid in ('T1','T2','CL') else 0 if pid in ('H1','H2') else -1
            self.assertEqual(int(a.findtext('key/fifths')),expected)
            self.assertEqual(int(a.findtext('transpose/chromatic','0'))+12*int(a.findtext('transpose/octave-change','0')),-t.SHIFT.get(pid,(0,0))[1])
    def test_each_part_matches_score(self):
        allnotes=t.decode(self.score)
        for pid in t.PARTS:
            part=t.build(self.root,self.notes,self.events,self.directions,[pid],False)
            self.assertEqual(t.decode(part),collections.Counter({k:v for k,v in allnotes.items() if k[0]==pid}))
    def test_source_active_at_every_retained_tick(self):
        byid={n['id']:n for n in self.notes}
        for e in self.events:
            for tick in range(e['on'],e['on']+e['dur']):
                self.assertTrue(any(byid[s]['on']<=tick<byid[s]['on']+byid[s]['dur'] for s in e['sources']))
    def test_no_overlap_and_ranges(self):
        for pid in t.PARTS:
            seq=[e for e in self.events if e['part']==pid];end=0
            for e in seq:
                start=t.BARS[e['bar']-1]['start']+e['on'];self.assertGreaterEqual(start,end);end=start+e['dur']
                self.assertTrue(t.PARTS[pid][-2]<=e['midi']<=t.PARTS[pid][-1])
    def test_breathing_bound(self):
        for pid,stats in t.playability(self.events).items():
            if pid not in t.WIND:continue
            self.assertLessEqual(stats['max_continuous_beats_except_final'],8,pid)
    def test_meter_changes_preserved(self):
        for p in self.score.findall('part'):
            beats=4
            for i,m in enumerate(p.findall('measure')):
                tm=m.find('attributes/time')
                if tm is not None:beats=int(tm.findtext('beats'))
                self.assertEqual(beats,t.BARS[i]['beats'])
    def test_timpani_fixed_tuning(self):
        self.assertTrue(all(e['midi'] in (41,48) for e in self.events if e['part']=='TI'))
    def test_navigation_marks(self):
        for p in self.score.findall('part'):
            for symbol in ('segno','coda'):
                self.assertEqual(len(p.findall('.//'+symbol)),len(self.root.find('part').findall('.//'+symbol)))
    def test_violin_one_preserves_upper_line(self):
        for e in (e for e in self.events if e['part']=='V1'):
            for tick in range(e['on'],e['on']+e['dur']):
                active=[n['midi'] for n in self.notes if n['bar']==e['bar'] and n['staff']==1 and n['on']<=tick<n['on']+n['dur']]
                self.assertEqual(e['midi'],t.octave(max(active)%12,max(active),55,88))
    def test_corrupt_pitch_rejected(self):
        bad=copy.deepcopy(self.score);p=bad.find('.//note/pitch/octave');p.text=str(int(p.text)+1)
        with self.assertRaises(AssertionError):t.validate(self.root,self.notes,self.events,bad)
    def test_corrupt_duration_rejected(self):
        bad=copy.deepcopy(self.score);bad.find('.//note/duration').text='1'
        with self.assertRaises(AssertionError):t.validate(self.root,self.notes,self.events,bad)
    def test_ties_match_adjacent_events(self):
        for pid in t.PARTS:
            seq=[e for e in self.events if e['part']==pid]
            for i,e in enumerate(seq):
                if e['tie_start']:
                    nxt=seq[i+1];self.assertTrue(nxt['tie_stop']);self.assertEqual(e['midi'],nxt['midi'])
                    self.assertEqual(t.BARS[e['bar']-1]['start']+e['on']+e['dur'],t.BARS[nxt['bar']-1]['start']+nxt['on'])
if __name__=='__main__':unittest.main()
