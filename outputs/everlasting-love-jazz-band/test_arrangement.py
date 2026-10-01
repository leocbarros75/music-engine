"""Musical invariants and deliberate-corruption tests for this score."""
import copy, unittest
import arrange as a

class ArrangementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root,cls.piano,_=a.n.read_source()
        cls.plan=a.harmony(cls.root);cls.events=a.compose(cls.plan,cls.piano)
        cls.score=a.build(cls.root,cls.events,list(a.PARTS),True)

    def test_complete_score(self):
        self.assertTrue(a.validate(self.root,self.score,self.events,self.plan)['piano_musical_content_preserved'])

    def test_source_facts(self):
        self.assertEqual(len(self.piano),1345)
        self.assertEqual(sum(b['length'] for b in a.n.BARS),299*8)
        self.assertEqual(len(self.root.findall('.//harmony')),158)

    def test_piano_pitch_change_rejected(self):
        bad=copy.deepcopy(self.score);bad.find("part[@id='P1']/.//pitch/octave").text='0'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

    def test_piano_tempo_change_rejected(self):
        bad=copy.deepcopy(self.score);bad.find("part[@id='P1']/.//per-minute").text='100'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

    def test_wrong_tenor_octave_rejected(self):
        bad=copy.deepcopy(self.score);bad.find("part[@id='TS1']/measure/attributes/transpose/octave-change").text='0'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

    def test_wrong_alto_transposition_rejected(self):
        bad=copy.deepcopy(self.score);bad.find("part[@id='AS1']/measure/attributes/transpose/chromatic").text='-2'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

    def test_duration_change_rejected(self):
        bad=copy.deepcopy(self.score);bad.find('.//note/duration').text='1'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

    def test_percussion_mapping_change_rejected(self):
        bad=copy.deepcopy(self.score);bad.find("./part-list/score-part[@id='DR']/midi-instrument/midi-unpitched").text='1'
        with self.assertRaises(AssertionError):a.validate(self.root,bad,self.events,self.plan)

    def test_actual_transpose_and_keys(self):
        expected={'AS1':(-9,2),'AS2':(-9,2),'TS1':(-14,1),'TS2':(-14,1),'BS':(-21,2),'TP1':(-2,1),'TP2':(-2,1),'TP3':(-2,1),'TP4':(-2,1),'GT':(-12,-1),'BA':(-12,-1)}
        for pid,(shift,key) in expected.items():
            att=self.score.find(f"part[@id='{pid}']/measure/attributes")
            self.assertEqual(int(att.findtext('transpose/chromatic'))+12*int(att.findtext('transpose/octave-change','0')),shift)
            self.assertEqual(int(att.findtext('key/fifths')),key)

    def test_individual_parts_match_score(self):
        for pid in a.PARTS:
            part=a.build(self.root,self.events,[pid]).find('part')
            full=self.score.find(f"part[@id='{pid}']")
            self.assertEqual([a.n.canonical(x) for x in part.findall('.//note')],[a.n.canonical(x) for x in full.findall('.//note')])

    def test_meters_navigation_and_slurs(self):
        for part in self.score.findall('part'):
            beats=4;active=False
            for i,m in enumerate(part.findall('measure')):
                tm=m.find('attributes/time')
                if tm is not None:beats=int(tm.findtext('beats'))
                self.assertEqual(beats,a.n.BARS[i]['beats'])
                if part.get('id')=='P1':continue
                for sl in m.findall('.//slur'):
                    if sl.get('type')=='start':self.assertFalse(active);active=True
                    if sl.get('type')=='stop':self.assertTrue(active);active=False
            if part.get('id')!='P1':
                self.assertFalse(active)
                self.assertEqual(len(part.findall('.//segno')),len(self.root.findall('.//segno')))
                self.assertEqual(len(part.findall('.//coda')),len(self.root.findall('.//coda')))

    def test_horn_breathing_space(self):
        for pid in a.SAX+a.TPT+a.TBN:
            end=-1;run=0
            for e in (e for e in self.events if e['part']==pid and e['bar']!=79):
                start=a.n.BARS[e['bar']-1]['start']+e['on']
                run=run+e['dur'] if start==end else e['dur'];end=start+e['dur']
                self.assertLessEqual(run,28) # no uninterrupted segment longer than 3.5 beats

if __name__=='__main__':unittest.main()
