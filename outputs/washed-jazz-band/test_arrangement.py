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
        events=[a.event('AS1',b,0,a.BARS[b]['length'],71,'deliberately unbroken') for b in range(124)]
        with self.assertRaises(AssertionError):a.breath_audit(events)
    def test_parts_match_score(self):
        full=a.decode(self.score)
        for pid in a.PARTS:
            part=a.build(self.root,self.events,self.plan,[pid])
            self.assertEqual(a.decode(part),collections.Counter({k:v for k,v in full.items() if k[0]==pid}))
    def test_wrong_trumpet_transposition_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='TP2']/measure/attributes/transpose/chromatic").text='0'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_note_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='AS1']/measure/note/pitch/octave").text='7'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_duration_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='AS1']/measure/note/duration").text='8'
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_missing_tie_rejected(self):
        bad=copy.deepcopy(self.score)
        note=next(x for x in bad.findall('.//note') if x.find("tie[@type='start']") is not None)
        note.remove(note.find("tie[@type='start']"))
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_wrong_printed_chord_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='AS1']").findall('measure')[9].find('harmony/root/root-step').text='C'
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_missing_repeat_rejected(self):
        bad=copy.deepcopy(self.score)
        m=bad.find("part[@id='AS1']").findall('measure')[60]
        m.remove(m.find('barline'))
        with self.assertRaises(AssertionError):
            a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)

    def test_seventeen_parts_piano_two_staves(self):
        self.assertEqual(len(self.score.findall('part')),17)
        self.assertEqual(self.score.findtext("part[@id='PI']/measure/attributes/staves"),'2')
        self.assertTrue(self.score.find("part[@id='PI']/measure/backup") is not None)
    def test_transpositions_and_readable_keys(self):
        for pid,(dia,chrom) in a.TRANSPOSE.items():
            part=a.build(self.root,self.events,self.plan,[pid]);tr=part.find('part/measure/attributes/transpose')
            self.assertEqual(int(tr.findtext('chromatic'))+12*int(tr.findtext('octave-change','0')),-chrom)
            key=part.findtext('part/measure/attributes/key/fifths')
            self.assertEqual(key,'-4' if pid in ('AS1','AS2','BS') else '-5' if pid in ('TS1','TS2')+a.TPT else '5')
            a.validate_written_harmony(part,self.hs,pid)
    def test_rootless_comp_and_hand_spans(self):
        for e in self.events:
            if e['part']=='PI':
                self.assertLessEqual(max(e['pitches'])-min(e['pitches']),12)
                h=a.h_at(self.plan,e['bar'],e['on'])
                if h['piano_rootless']:self.assertTrue(all(p%12!=h['root'] for p in e['pitches']))
    def test_bass_slash_at_actual_harmony_starts(self):
        for h in self.plan:
            if not h['bar']:continue
            e=next(e for e in self.events if e['part']=='BA' and e['bar']==h['bar'] and e['on']==h['on'])
            self.assertEqual(e['midi']%12,h['bass'])
    def test_chromatic_bass_resolutions_on_repeats(self):
        self.assertGreater(sum(e['role']=='chromatic bass approach' for e in self.events),20)
        a.validate_musical_constraints(self.events,self.plan)
    def test_bad_bass_approach_rejected(self):
        bad=copy.deepcopy(self.events);next(e for e in bad if e['role']=='chromatic bass approach')['resolution_target']+=12
        with self.assertRaises(AssertionError):a.validate_musical_constraints(bad,self.plan)
    def test_guitar_chord_span(self):
        for e in self.events:
            if e['part']=='GT':self.assertEqual(len(e['pitches']),3);self.assertLessEqual(e['pitches'][-1]-e['pitches'][0],9)
    def test_drum_ids_display_and_mapping(self):
        a.decode(a.build(self.root,self.events,self.plan,['DR']))
        for e in self.events:
            if e['part']=='DR':self.assertLessEqual(len(e['pitches']),3)
    def test_wrong_drum_mapping_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part-list/score-part[@id='DR']/midi-instrument[@id='DR_hat']/midi-unpitched").text='20'
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_wrong_drum_display_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='DR']").findall('measure')[5].find('note/unpitched/display-step').text='D'
        with self.assertRaises(AssertionError):a.decode(bad)
    def test_wrong_tenor_octave_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='TS1']/measure/attributes/transpose/octave-change").text='0'
        with self.assertRaises(AssertionError):a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_baritone_octave_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='BS']/measure/attributes/transpose/octave-change").text='0'
        with self.assertRaises(AssertionError):a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_piano_backup_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='PI']").findall('measure')[9].find('backup/duration').text='8'
        with self.assertRaises(AssertionError):a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_wrong_piano_chord_member_rejected(self):
        bad=copy.deepcopy(self.score)
        bad.find("part[@id='PI']").findall('measure')[9].find('note/pitch/octave').text='7'
        with self.assertRaises(AssertionError):a.validate(self.root,self.records,self.hs,self.plan,self.events,bad)
    def test_written_chord_transposition_corruption(self):
        for pid in ('AS1','TS1','TP1'):
            bad=a.build(self.root,self.events,self.plan,[pid]);bad.find('part').findall('measure')[9].find('harmony/root/root-step').text='G'
            with self.assertRaises(AssertionError):a.validate_written_harmony(bad,self.hs,pid)
    def test_harmony_voice_follows_later_changes(self):
        # Tenor 2 is unoccupied by the source cue, so must respond to later
        # harmonies in this multichord bar rather than silently dropping out.
        e=[e for e in self.events if e['part']=='TS2' and e['bar']==9]
        self.assertTrue(any(x['on']>=8 for x in e))
    def test_wrong_piano_hand_width_rejected(self):
        bad=copy.deepcopy(self.events);e=next(e for e in bad if e['part']=='PI');e['pitches'][-1]+=24
        with self.assertRaises(AssertionError):a.validate_musical_constraints(bad,self.plan)

if __name__=='__main__':unittest.main()
