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
    def test_repeat_aware_breathing(self):
        audit=a.breath_audit(self.events)
        self.assertTrue(all(x['longest_run_quarters']<=12 for x in audit.values()))
        self.assertEqual(len(a.playback_route()),136)
        self.assertEqual(a.playback_route().count(53),2)
        self.assertEqual(a.playback_route().count(59),1)
        self.assertEqual(a.playback_route().count(61),1)
    def test_unbroken_phrase_rejected(self):
        events=[a.event('T1',b,0,a.BARS[b]['length'],71,'deliberately unbroken') for b in range(124)]
        with self.assertRaises(AssertionError):a.breath_audit(events)
    def test_bridge_lead_distribution(self):
        self.assertEqual([a.leader(b) for b in (65,67,69)],['T1','H1','TB1'])
        for b in range(65,105):
            leads=[e for e in self.events if e['bar']==b and e['layer']=='lead']
            self.assertTrue(leads)
            self.assertTrue(all(e['part']==a.leader(b) for e in leads))
    def test_transposing_parts_and_spelling(self):
        for pid in a.TRANSPOSE:
            part=a.build(self.root,self.events,self.plan,[pid])
            self.assertEqual(part.findtext('part/measure/attributes/key/fifths'),'7' if pid.startswith('T') else '6')
            a.validate_written_harmony(part,self.hs,pid)
            notes=part.findall('.//note/pitch')
            # A concert A#3 becomes B#3 for Bb trumpet, E#4 for F horn.
            m=E.Element('measure');a.write_event(m,a.event(pid,1,0,8,58,'transposition probe'))
            pitch=m.find('note/pitch')
            self.assertEqual(pitch.findtext('step'),'B' if pid.startswith('T') else 'E')
            self.assertEqual(pitch.findtext('alter'),'1')
            self.assertEqual(a.midi(pitch)-a.TRANSPOSE[pid][1],58)
            for p in notes:
                if p.findtext('step')=='B' and p.findtext('alter')=='1':self.assertEqual(a.midi(p)%12,0)
    def test_wrong_written_harmony_rejected(self):
        for pid in ('T2','H1'):
            part=a.build(self.root,self.events,self.plan,[pid])
            part.find('part').findall('measure')[9].find('harmony/root/root-step').text='D'
            with self.assertRaises(AssertionError):a.validate_written_harmony(part,self.hs,pid)
    def test_wrong_horn_transposition_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='H1']/measure/attributes/transpose/chromatic").text='-2'
        with self.assertRaises(AssertionError):a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_trumpet_recovery_measures(self):
        report=a.activity_audit(self.events)
        for pid in ('T1','T2'):self.assertLess(report[pid]['nominal_sounding_percent'],35)
        self.assertTrue(set(range(37,53)).issubset(report['T1']['fully_silent_numbered_measures']))
    def test_low_register_spacing(self):
        for h in self.plan:
            v=h['voicing']
            if 'BT' in v:self.assertGreaterEqual(v['BT']-v['TU'],7)
            low=[v[p] for p in ('BT','TB2','TB1') if p in v]
            self.assertTrue(all(x<y for x,y in zip(low,low[1:])))
    def test_parts_match_score(self):
        full=a.decode(self.score)
        for pid in a.PARTS:
            part=a.build(self.root,self.events,self.plan,[pid])
            self.assertEqual(a.decode(part),collections.Counter({k:v for k,v in full.items() if k[0]==pid}))
    def test_wrong_trumpet_transposition_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='T2']/measure/attributes/transpose/chromatic").text='0'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_note_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='T1']/measure/note/pitch/octave").text='5'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_duration_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='T1']/measure/note/duration").text='8'
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_missing_tie_rejected(self):
        bad=copy.deepcopy(self.score)
        note=next(x for x in bad.findall('.//note') if x.find("tie[@type='start']") is not None)
        note.remove(note.find("tie[@type='start']"))
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_wrong_printed_chord_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='T1']").findall('measure')[9].find('harmony/root/root-step').text='C'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_missing_repeat_rejected(self):
        bad=copy.deepcopy(self.score)
        m=bad.find("part[@id='T1']").findall('measure')[60]
        m.remove(m.find('barline'))
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)

if __name__=='__main__':unittest.main(verbosity=2)
