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
        events=[a.event('FL',b,0,a.BARS[b]['length'],71,'deliberately unbroken') for b in range(124)]
        with self.assertRaises(AssertionError):a.breath_audit(events)
    def test_bridge_lead_distribution(self):
        self.assertEqual([a.leader(b) for b in (65,67,69)],['FL','OB','CL'])
        for b in range(65,105):
            leads=[e for e in self.events if e['bar']==b and e['layer']=='lead']
            self.assertTrue(leads)
            self.assertTrue(all(e['part']==a.leader(b) for e in leads))
    def test_clarinet_written_pitch_and_spelling(self):
        part=a.build(self.root,self.events,self.plan,['CL'])
        self.assertEqual(part.findtext('part/measure/attributes/key/fifths'),'7')
        a.validate_written_harmony(part,self.hs,'CL')
        notes=part.findall('.//note/pitch')
        self.assertTrue(any(p.findtext('step')=='E' and p.findtext('alter')=='1' for p in notes))
        self.assertTrue(any(p.findtext('step')=='B' and p.findtext('alter')=='1' for p in notes))
        for note in notes:
            if note.findtext('step')=='B' and note.findtext('alter')=='1':
                self.assertEqual(a.midi(note)%12,0)
    def test_wrong_clarinet_harmony_rejected(self):
        part=a.build(self.root,self.events,self.plan,['CL'])
        part.find('part').findall('measure')[9].find('harmony/root/root-step').text='D'
        with self.assertRaises(AssertionError):a.validate_written_harmony(part,self.hs,'CL')
    def test_parts_match_score(self):
        full=a.decode(self.score)
        for pid in a.PARTS:
            part=a.build(self.root,self.events,self.plan,[pid])
            self.assertEqual(a.decode(part),collections.Counter({k:v for k,v in full.items() if k[0]==pid}))
    def test_wrong_clarinet_transposition_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='CL']/measure/attributes/transpose/chromatic").text='0'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_note_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='FL']/measure/note/pitch/octave").text='5'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_duration_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='FL']/measure/note/duration").text='8'
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_missing_tie_rejected(self):
        bad=copy.deepcopy(self.score)
        note=next(x for x in bad.findall('.//note') if x.find("tie[@type='start']") is not None)
        note.remove(note.find("tie[@type='start']"))
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_wrong_printed_chord_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='FL']").findall('measure')[9].find('harmony/root/root-step').text='C'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_missing_repeat_rejected(self):
        bad=copy.deepcopy(self.score)
        m=bad.find("part[@id='FL']").findall('measure')[60]
        m.remove(m.find('barline'))
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)

if __name__=='__main__':unittest.main(verbosity=2)
