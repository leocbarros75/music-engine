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
        events=[a.event('OB',b,0,a.BARS[b]['length'],71,'deliberately unbroken') for b in range(124)]
        with self.assertRaises(AssertionError):a.breath_audit(events)
    def test_transposing_parts_and_spelling(self):
        for pid in ('CL','T1','T2','H1','H2'):
            part=a.build(self.root,self.events,self.plan,[pid])
            self.assertEqual(part.findtext('part/measure/attributes/key/fifths'),'7' if pid in ('CL','T1','T2') else '6')
            a.validate_written_harmony(part,self.hs,pid)
            notes=part.findall('.//note/pitch')
            # A concert A#3 becomes B#3 for Bb trumpet, E#4 for F horn.
            m=E.Element('measure');a.write_event(m,a.event(pid,1,0,8,58,'transposition probe'))
            pitch=m.find('note/pitch')
            self.assertEqual(pitch.findtext('step'),'B' if pid in ('CL','T1','T2') else 'E')
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
        bad.find("part[@id='FL1']").findall('measure')[9].find('harmony/root/root-step').text='C'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_missing_repeat_rejected(self):
        bad=copy.deepcopy(self.score)
        m=bad.find("part[@id='FL1']").findall('measure')[60]
        m.remove(m.find('barline'))
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)

    def test_nineteen_parts_and_routing(self):
        self.assertEqual(len(self.score.findall('part')),19)
        self.assertTrue(all(1<=int(x.text)<=16 for x in self.score.findall('.//midi-channel')))
    def test_family_activity_hierarchy(self):
        f=a.activity_audit(self.events)['family_mean_sounding_percent']
        self.assertGreater(f['strings'],f['woodwinds'])
        self.assertGreater(f['woodwinds'],f['brass'])
        self.assertGreater(f['brass'],f['percussion'])
    def test_performed_ties(self):a.validate_performed_ties(self.score)
    def test_fixed_drums(self):
        self.assertEqual({e['midi'] for e in self.events if e['part']=='TI'},{42,47})
    def test_double_bass_written_octave(self):
        part=a.build(self.root,self.events,self.plan,['CB'])
        self.assertEqual(part.findtext('part/measure/attributes/transpose/octave-change'),'-1')
        self.assertEqual(part.findtext('part/measure/attributes/key/fifths'),'5')
    def test_tuba_concert_pitch(self):
        self.assertIsNone(self.score.find("part[@id='TU']/measure/attributes/transpose"))
    def test_wrong_clarinet_transposition(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='CL']/measure/attributes/transpose/chromatic").text='0'
        with self.assertRaises(AssertionError):a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_double_bass_octave(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='CB']/measure/attributes/transpose/octave-change").text='0'
        with self.assertRaises(AssertionError):a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_independent_counterlines_and_ornaments(self):
        for b in (13,37,81,97):
            self.assertTrue(any(e['bar']==b and e['layer']=='lead' for e in self.events))
            self.assertTrue(any(e['bar']==b and e['layer']=='counterline' for e in self.events))
        self.assertTrue(any(e['role']=='ostinato diatonic approach' for e in self.events))
    def test_bad_neighbor_rejected(self):
        bad=copy.deepcopy(self.events)
        next(e for e in bad if e['role']=='diatonic neighbor')['midi']+=12
        with self.assertRaises(AssertionError):a.validate_musical_constraints(bad,self.plan)
    def test_untuned_timpani_rejected(self):
        bad=copy.deepcopy(self.events)
        next(e for e in bad if e['part']=='TI')['midi']=44
        with self.assertRaises(AssertionError):a.validate_musical_constraints(bad,self.plan)
    def test_bad_mode_preparation_rejected(self):
        bad=copy.deepcopy(self.events);bad.append(a.event('VA',8,28,4,59,'bad preparation'))
        with self.assertRaises(AssertionError):a.validate_musical_constraints(bad,self.plan)
    def test_overlapping_events_rejected(self):
        bad=copy.deepcopy(self.events);bad.append(copy.deepcopy(next(e for e in bad if e['part']=='V1')))
        with self.assertRaises(AssertionError):a.validate_musical_constraints(bad,self.plan)
    def test_wrong_display_type_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='V1']/measure/note/type").text='whole'
        with self.assertRaises(AssertionError):a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)

if __name__=='__main__':unittest.main()
