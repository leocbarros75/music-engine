import { useEffect } from "react";
import type { Settings } from "../types";

const ENSEMBLE_OPTIONS: Array<{ label: string; value: Settings["ensemble"] }> = [
  { label: "choral (SATB)", value: "choral" },
  { label: "piano", value: "piano" },
  { label: "piano with melody (RH)", value: "piano_with_melody" },
  { label: "string ensemble (auto)", value: "string_ensemble" },
  { label: "piano → string quartet", value: "piano_string_quartet" },
  { label: "SATB → string quartet", value: "satb_string_quartet" },
  { label: "piano + strings (complement)", value: "piano_with_strings" },
  { label: "wind ensemble (auto)", value: "woodwind_ensemble" },
  { label: "piano → wind quartet", value: "piano_woodwind_quartet" },
  { label: "choral → wind (SATB)", value: "satb_woodwind_quartet" },
  { label: "piano + winds (complement)", value: "piano_with_woodwinds" },
  { label: "brass ensemble (auto)", value: "brass_ensemble" },
  { label: "piano → brass quintet", value: "piano_brass_quartet" },
  { label: "choral → brass (SATB)", value: "satb_brass_quartet" },
  { label: "piano + brass (complement)", value: "piano_with_brass" },
  { label: "re-instrument (swap instruments)", value: "reinstrument" },
  // Label says "worship" for clarity; the VALUE stays "orchestra" — eight code
  // paths and every saved setting key off that string.
  { label: "worship orchestra (auto)", value: "orchestra" },
  { label: "piano → worship orchestra", value: "piano_orchestra" },
  { label: "SATB → worship orchestra", value: "satb_orchestra" },
  { label: "symphonic orchestra (classical / romantic)", value: "symphonic_orchestra" }
];

// Symphonic roster — mirrors SYMPHONIC_PARTS in the engine (ids must match).
// romanticOnly parts don't exist in the classical period, so they're hidden there.
const SYMPHONIC_ROSTER: Array<{ id: string; name: string; section: string; romanticOnly?: boolean }> = [
  { id: "SY_FL",    name: "Flute",           section: "Woodwinds" },
  { id: "SY_OB",    name: "Oboe",            section: "Woodwinds" },
  { id: "SY_CL",    name: "Clarinet in Bb",  section: "Woodwinds" },
  { id: "SY_BSN",   name: "Bassoon",         section: "Woodwinds" },
  { id: "SY_HN12",  name: "Horn 1-2",        section: "Brass" },
  { id: "SY_HN34",  name: "Horn 3-4",        section: "Brass", romanticOnly: true },
  { id: "SY_TPT",   name: "Trumpet 1-2",     section: "Brass" },
  { id: "SY_TBN12", name: "Trombone 1-2",    section: "Brass", romanticOnly: true },
  { id: "SY_TBN3",  name: "Trombone 3/Tuba", section: "Brass", romanticOnly: true },
  { id: "SY_TIMP",  name: "Timpani",         section: "Percussion" },
  { id: "SY_VLN1",  name: "Violin I",        section: "Strings" },
  { id: "SY_VLN2",  name: "Violin II",       section: "Strings" },
  { id: "SY_VLA",   name: "Viola",           section: "Strings" },
  { id: "SY_VC",    name: "Cello",           section: "Strings" },
  { id: "SY_CB",    name: "Contrabass",      section: "Strings" },
];

/** The symphonic roster for the selected period (classical drops the romantic-only desks). */
function symphonicRosterFor(period: string | undefined) {
  return SYMPHONIC_ROSTER.filter((r) => period !== "classical" || !r.romanticOnly);
}

// Period styles — used for strings, choral, woodwind, brass, orchestra.
// Each maps directly to a voice-leading profile in the engine.
const PERIOD_STYLE_OPTIONS: Array<{ label: string; value: Settings["style"]; help: string }> = [
  {
    label: "Baroque",
    value: "baroque",
    help: "Strict counterpoint — Bach/Handel-style voice-leading, close spacing, no parallel 5ths/8ths (1600–1750)."
  },
  {
    label: "Classical",
    value: "classical",
    help: "Balanced voice-leading — Haydn/Mozart clarity, phrase symmetry, moderate spacing (1750–1820)."
  },
  {
    label: "Romantic",
    value: "romantic",
    help: "Flexible harmony — Brahms/Dvořák richness, wider spacing, chromatic colour, expressive leaps (1820–1900)."
  },
  {
    label: "Modern",
    value: "modern",
    help: "Extended harmony — tonal, modal, or atonal sub-modes; relaxed parallel and spacing rules (1900–present)."
  }
];

// Pop/worship/folk styles — used only for piano, where the LH pattern
// and rhythm engine respond to genre (funk grooves, waltz bass, etc.).
const PIANO_STYLE_OPTIONS: Array<{ label: string; value: Settings["style"]; help: string }> = [
  { label: "Classical",  value: "classical", help: "Balanced period voice-leading adapted for piano." },
  { label: "Baroque",    value: "baroque",   help: "Strict counterpoint — Bach/Handel texture." },
  { label: "Romantic",   value: "romantic",  help: "Expressive harmony — Chopin/Liszt-style richness." },
  { label: "Modern",     value: "modern",    help: "Extended harmony — tonal, modal, or atonal sub-modes." },
  { label: "Worship",    value: "worship",   help: "Hymn-style chordal writing with devotional phrasing." },
  { label: "Pop",        value: "pop",       help: "Contemporary pop chord patterns and rhythms." },
  { label: "Rock",       value: "rock",      help: "Driving rock rhythms with power-chord voicings." },
  { label: "Funk",       value: "funk",      help: "Syncopated funk grooves with 16th-note patterns." },
  { label: "Samba",      value: "samba",     help: "Brazilian samba rhythm patterns." },
  { label: "Latino",     value: "latino",    help: "Latin rhythmic patterns and harmonic colour." }
];
const LEVEL_OPTIONS: Settings["level"][] = ["beginner", "intermediate", "advanced", "professional"];
const ACCOMP_OPTIONS: Settings["accompaniment"][] = [
  "homophonic",
  "chordal",
  "polyphonic",
  "alberti_bass",
  "heterophonic"
];
const ACCOMP_HELP: Record<Settings["accompaniment"], string> = {
  homophonic: "Vertical texture: voices move together (shared rhythm).",
  chordal: "Block chord texture (piano-focused).",
  polyphonic: "Horizontal texture: independent melodic contours with shared harmony.",
  alberti_bass: "Patterned bass accompaniment (future refinement).",
  heterophonic: "Melody variants layered (future refinement)."
};
const TEXTURE_OPTIONS: Array<{ label: string; value: Settings["textureMode"]; help: string }> = [
  { label: "Homophony (homorhythmic)", value: "homophony_homorhythmic", help: "All voices share the same rhythm." },
  {
    label: "Homophony (melody + accompaniment)",
    value: "homophony_melody_accompaniment",
    help: "Melody leads; accompaniment supports."
  },
  { label: "Polyphony (counterpoint)", value: "polyphony", help: "Independent lines with shared harmony." },
  { label: "Heterophony", value: "heterophony", help: "Variations of the same melody." },
  { label: "Biphony (drone)", value: "biphony", help: "Melody plus sustained pitch." },
  { label: "Monophony", value: "monophony", help: "Single melodic line." }
];
const POLYPHONIC_PROFILES: Array<{ label: string; value: NonNullable<Settings["styleProfile"]>; help: string }> = [
  { label: "Baroque", value: "baroque", help: "Strict counterpoint and spacing." },
  { label: "Classical", value: "classical", help: "Balanced voice-leading rules." },
  { label: "Romantic", value: "romantic", help: "More flexible spacing and motion." },
  { label: "Modern", value: "modern", help: "Adaptive rules (tonal/modal/atonal)." }
];
const MODERN_MODES: Array<{ label: string; value: NonNullable<Settings["modernMode"]>; help: string }> = [
  { label: "Modern tonal", value: "modernTonal", help: "Extended harmony, tonal anchors." },
  { label: "Modal", value: "modal", help: "Controlled parallels allowed." },
  { label: "Atonal", value: "atonal", help: "No tonal resolution rules." }
];
const BASS_ACTIVITY_OPTIONS: Array<{ label: string; value: NonNullable<Settings["bassActivity"]>; help: string }> = [
  { label: "Less active (40%)", value: "less_active", help: "Occasional motion, mostly stable tones." },
  { label: "Active (60%)", value: "active", help: "More 8th-note motion, passing/neighbor tones." },
  { label: "High active (100%)", value: "high_active", help: "Continuous motion where possible." }
];
// Per-voice activity for string polyphony — includes "grounded" (hold note, no subdivision)
// so Violin I and Double Bass can be locked while inner voices move independently.
const STRING_ACTIVITY_OPTIONS: Array<{ label: string; value: string; help: string }> = [
  { label: "Grounded (hold)", value: "grounded", help: "Hold the chord tone; no rhythmic subdivision." },
  { label: "Less active (30%)", value: "less_active", help: "Occasional motion, mostly stable tones." },
  { label: "Active (60%)", value: "active", help: "More 8th-note motion; passing/neighbor tones." },
  { label: "High active (100%)", value: "high_active", help: "Continuous motion where possible." }
];
// Adler-based string texture modes (from "The Study of Orchestration", 3rd ed.)
const STRING_TEXTURE_OPTIONS: Array<{
  label: string;
  value: NonNullable<Settings["stringTexture"]>;
  help: string;
}> = [
  {
    label: "Melody + Harmony (Adler default)",
    value: "melody_harmony",
    help: "Violin I = foreground melody; Violin II + Viola = inner harmony; Cello = bass; D.Bass = Cello -8va. Standard SATB-like texture."
  },
  {
    label: "Melody + Pizzicato",
    value: "melody_pizzicato",
    help: "Violin I plays the melody arco; all other strings play pizzicato chord support on the beat."
  },
  {
    label: "Cello Melody",
    value: "cello_melody",
    help: "Cello sings in the foreground (lyrical D-string or C-string register); violins and viola provide soft background harmony."
  },
  {
    label: "Homophonic Block",
    value: "homophonic_block",
    help: "All 5 voices move in block chords with Adler overtone spacing: wide intervals in bass, close intervals in treble."
  },
  {
    label: "Counterpoint (independent voices)",
    value: "counterpoint",
    help: "Each instrument has an independent melodic line with staggered entrances, motif imitation, and passing tones — like the Haydn/Mozart string quartet examples. Activates the full counterpoint engine."
  }
];

// Reference examples for the string engine — pieces that calibrate each texture mode.
const STRING_EXAMPLE_OPTIONS: Array<{ label: string; value: string; texture: NonNullable<Settings["stringTexture"]>; help: string }> = [
  // melody_harmony
  {
    label: "Haydn — String Quartet Op. 76 No. 3 'Emperor', 2nd mvt",
    value: "haydn_op76_no3_mvt2",
    texture: "melody_harmony",
    help: "Prototype melody + inner harmony texture. Vln I carries the chorale theme (G4–E5); inner voices in 3rds/6ths below; cello on root bass. Adjacent-voice spacings 4–9 st."
  },
  {
    label: "Haydn — String Quartet Op. 64 No. 3, 1st mvt (Vivace assai, Bb major)",
    value: "haydn_op64_no3_mvt1",
    texture: "melody_harmony",
    help: "Close-voiced opening on Bb triad (all four voices within 16 st). Vln I leads with staccato melodic line; viola provides brief F4 pedal before joining counterpoint."
  },
  {
    label: "Mozart — String Quartet No. 14 in G major K387, 1st mvt",
    value: "mozart_k387_mvt1",
    texture: "melody_harmony",
    help: "Tight Vln I–II coupling in parallel 3rds (3–4 st gap). G major, Allegro vivace. Cello functional bass descending to A2. All voices active counterpoint."
  },
  {
    label: "Mozart — String Quartet No. 15 in D minor K421, 1st mvt",
    value: "mozart_k421_mvt1",
    texture: "melody_harmony",
    help: "Textbook inner-voice ostinato: Vln II and Viola play repeated staccato 8ths in parallel 3rds (A3/F3). Cello has slow half-note chromatic bass descent (D3–C3–Bb2–A2). Lowest Vc: D2."
  },
  {
    label: "Mozart — K545 Piano Sonata arr. for String Quartet, 1st mvt",
    value: "mozart_k545_arr_mvt1",
    texture: "melody_harmony",
    help: "K545 arranged for strings. Viola plays Alberti-bass ostinato (C–G–E–G eighths). Vln I and II exchange melody and run in parallel 3rds in scalar passages. Cello = sparse downbeat bass."
  },
  {
    label: "Mozart — String Quartet No. 19 in C major K465 'Dissonance', 1st mvt",
    value: "mozart_k465_mvt1",
    texture: "homophonic_block",
    help: "Opens with famous chromatic Adagio introduction: cello repeats C3 in staccato 8ths (pedal), upper voices enter chromatically. Wide spacing by m4: Vln I G5–Vln II B4–Vla D4–Vc B2 (span 32 st). Lowest Vc: F#2."
  },
  {
    label: "Dvořák — String Quartet No. 10 in E♭ major Op. 51",
    value: "dvorak_op51",
    texture: "melody_harmony",
    help: "Late-Romantic melody-harmony texture. Vln I leads with lyrical Slavic-inflected themes; Vln II and Vla provide close inner-voice support; Vc on characteristic bass lines."
  },
  {
    label: "Beethoven — String Quartet No. 1 in F major Op. 18 No. 1 (complete)",
    value: "beethoven_op18_no1",
    texture: "melody_harmony",
    help: "Early Beethoven quartet — all 4 movements (Allegro con brio, Adagio affettuoso, Scherzo, Allegro). 4 voices: Violin I/II, Viola, Cello. Dense independent counterpoint, motif imitation between violins, chromatic development. Source: OpenScore/CC0."
  },
  // cello_melody
  {
    label: "Dvořák — String Quartet No. 12 Op. 96 'American'",
    value: "dvorak_op96_american",
    texture: "cello_melody",
    help: "Cello carries rich lyrical counter-melodies throughout; characteristic pentatonic folk idiom. Cello D-string used prominently. Reference for warm cello-foreground texture."
  },
  // homophonic_block
  // melody_pizzicato
  {
    label: "Haydn — String Quartet Op. 64 No. 5 'The Lark', 1st mvt (D major)",
    value: "haydn_op64_no5_mvt1",
    texture: "melody_pizzicato",
    help: "Lower three voices play staccato ostinato (note–rest–note–rest in 8ths) for 7 bars before Vln I enters alone at A5 (MIDI 81) and soars to F#6. Cello drops to D2 for wide bass."
  },
  // counterpoint / full-quartet references
  {
    label: "Mozart — String Quartet No. 15 in D minor K421 (complete, all 4 mvts)",
    value: "mozart_k421",
    texture: "counterpoint",
    help: "Complete D-minor quartet: all four movements. Classical clarity — Alberti cello, light inner voices, melody in Violin I. Source: OpenScore/CC0."
  },
  {
    label: "Haydn — String Quartet Op. 64 No. 5 'The Lark' (complete, all 4 mvts)",
    value: "haydn_lark",
    texture: "counterpoint",
    help: "Complete 'Lark' quartet in D major: all four movements. Characteristic Haydn: arpeggiated inner voices, surprise rests, motivic development. Source: OpenScore/CC0."
  },
  {
    label: "Brahms — String Quartet No. 1 in C minor Op. 51 No. 1 (complete)",
    value: "brahms_op51_no1",
    texture: "counterpoint",
    help: "Complete Brahms quartet: all four movements. Dense chromatic counterpoint, cross-rhythms (hemiolia), walking bass with passing tones. Source: OpenScore/CC0."
  },
  {
    label: "Bach — Chamber Work (Flute, 2 Violins, Viola da gamba)",
    value: "bach_chamber_bwv",
    texture: "counterpoint",
    help: "Baroque 4-voice chamber texture: independent contrapuntal lines, walking bass in Viola da gamba, steady 8th-note inner voices. Maps to string quartet: Flute→Vln I, Violins→Vln II/Vla, Gamba→Cello."
  },
  {
    label: "Vivaldi — String Concerto (Solo Violin + Strings)",
    value: "vivaldi_concerto",
    texture: "counterpoint",
    help: "Vivaldi concerto for violin and string orchestra: Violins 1/2, Viola, Cello. Characteristic ostinato bass, running 8th-note sequences, homophonic inner voices. Maps to quartet: Solo→Vln I, Violins 1→Vln II, Viola→Vla, Cello→Vc."
  },
  {
    label: "Bach — Violin Concerto No. 1 in A minor BWV 1041",
    value: "bach_violin_concerto_bwv1041",
    texture: "counterpoint",
    help: "Bach's A minor violin concerto arranged for 2 voices (Recorder + Violin). Baroque melodic independence, running 8th passages, ornamental figuration. Maps Recorder→Vln I melody reference."
  }
];

// ── Woodwind ensemble auto — texture + reference examples (parity with strings)
const WIND_TEXTURE_OPTIONS: Array<{
  label: string;
  value: NonNullable<Settings["woodwindTexture"]>;
  help: string;
}> = [
  {
    label: "Melody + Harmony (default)",
    value: "melody_harmony",
    help: "Flute = foreground melody; Oboe/Clarinet = inner harmony; Bassoon = bass; Horn = sustained pad. Standard wind-choir texture."
  },
  {
    label: "Chamber (balanced dialogue)",
    value: "chamber",
    help: "Conversational balance between the wind voices, as in a Mozart/Reicha wind quintet — moderate voice independence."
  },
  {
    label: "Chorale (homophonic block)",
    value: "chorale",
    help: "All voices move together in balanced block chords with strict voice-leading (hymn / Bach-chorale style)."
  },
  {
    label: "Counterpoint (independent voices)",
    value: "contrapuntal",
    help: "Each instrument has an independent imitative line — like Nielsen's wind quintet. Activates the counterpoint profile."
  }
];

// Reference wind-ensemble pieces — each sets a composer/period style + texture.
const WIND_EXAMPLE_OPTIONS: Array<{ label: string; value: string; texture: NonNullable<Settings["woodwindTexture"]>; composer: string; help: string }> = [
  { value: "mozart_k361_gran_partita", label: "Mozart — Gran Partita K.361", texture: "chamber", composer: "mozart",
    help: "Classical wind serenade (calibrated): all voices active & stepwise, active Horn — chamber independence." },
  { value: "mozart_k388_serenade", label: "Mozart — Serenade K.388", texture: "chamber", composer: "mozart",
    help: "Darker C-minor wind octet — balanced chamber dialogue." },
  { value: "mozart_k452_quintet", label: "Mozart — Quintet K.452", texture: "chamber", composer: "mozart",
    help: "Conversational classical balance between the wind voices." },
  { value: "beethoven_op16_quintet", label: "Beethoven — Quintet Op.16", texture: "melody_harmony", composer: "beethoven",
    help: "Classical-dramatic: stronger contrast, more independent lines." },
  { value: "reicha_quintet", label: "Reicha — Wind Quintet Op.88/91", texture: "chamber", composer: "haydn",
    help: "Foundational wind-quintet idiom — equal, conversational voices." },
  { value: "danzi_quintet", label: "Danzi — Wind Quintet Op.56/67", texture: "melody_harmony", composer: "mozart",
    help: "Graceful early-Romantic quintet — singing flute/oboe over light support." },
  { value: "nielsen_quintet", label: "Nielsen — Wind Quintet Op.43", texture: "contrapuntal", composer: "brahms",
    help: "Romantic/modern (calibrated): smooth stepwise lines, melodic bassoon, strong individual entrances — independent counterpoint." },
  { value: "sousa_march", label: "Sousa — Concert band march", texture: "melody_harmony", composer: "haydn",
    help: "Concert-band march (calibrated): very stepwise melody over an oom-pah accompaniment." },
  { value: "bach_chorale_winds", label: "Bach — Chorale (winds)", texture: "chorale", composer: "bach",
    help: "Strict 4/5-part chorale: balanced block voicing, no parallels." },
  { value: "handel_winds", label: "Handel — Wind movement", texture: "melody_harmony", composer: "handel",
    help: "Baroque clarity: walking bassoon bass, balanced upper voices." },
];

const STRING_INSTRUMENTATION_OPTIONS: Array<{ label: string; value: NonNullable<Settings["instrumentation"]>; help: string }> = [
  { label: "Auto arranger", value: "auto", help: "Use the current string arranging engine." },
  {
    label: "Piano -> String Quartet (Copy)",
    value: "piano_copy_to_string_quartet",
    help: "Copy piano voices directly: RH top->Violin I, RH inner->Violin II, LH top->Viola, LH bottom->Cello."
  },
  {
    label: "SATB -> String Quartet (Legacy)",
    value: "satb_to_string_quartet",
    help: "Legacy alias of the copy instrumentation mode."
  }
];
const WOODWIND_INSTRUMENTATION_OPTIONS: Array<{ label: string; value: NonNullable<Settings["instrumentation"]>; help: string }> = [
  { label: "Auto arranger", value: "auto", help: "Use the current woodwind arranging engine." },
  {
    label: "Piano -> Woodwind Quartet (Copy)",
    value: "piano_copy_to_woodwind_quartet",
    help: "Copy piano voices directly: RH top->Flute, RH inner->Oboe, LH top->Clarinet, LH bottom->Bassoon."
  },
  {
    label: "SATB -> Woodwind Quartet (Legacy)",
    value: "satb_to_woodwind_quartet",
    help: "Legacy alias of the copy instrumentation mode."
  }
];
type LhPatternValue = NonNullable<Settings["lhPattern"]>;
const LH_PATTERN_OPTIONS: Array<{ label: string; value: LhPatternValue; help: string }> = [
  { value: "auto",               label: "Auto (by style & time signature)", help: "Engine picks the best pattern based on style and time signature." },
  { value: "alberti",            label: "Alberti Bass",                     help: "Root–5th–3rd–5th in 8ths. Source: Mozart K.545." },
  { value: "block_beats",        label: "Block Chords",                     help: "Root+3rd+5th chord on every beat. Source: Stevens patterns." },
  { value: "boom_chick",         label: "Boom-Chick",                       help: "Root on beats 1+3, chord stab on 2+4. Source: Stevens / gospel." },
  { value: "broken_ascending",   label: "Broken Ascending",                 help: "Ascending root–3rd–5th–oct arpeggio in 16ths. Source: Stevens." },
  { value: "waltz_bass",         label: "Waltz Bass",                       help: "Root on beat 1, chord on beats 2+3. Classic 3/4 waltz." },
  { value: "serenade_strum",     label: "Serenade Strum",                   help: "Guitar-like bass + alternating mid/high 8ths. Source: Schubert Ständchen." },
  { value: "root_chord_stabs",   label: "Root-Chord Stabs",                 help: "Root alone on beat 1, full chord on all other beats. Source: Schubert Erlkönig." },
  { value: "interval_oscillation", label: "Interval Oscillation",           help: "Mid and high tones alternating as 8ths (tremolo texture). Source: Schubert Erlkönig / Sonata No.18." },
  { value: "jazz_shell",         label: "Jazz Shell",                       help: "Root+10th half-note dyad + sparse quarters. Source: Autumn Leaves." },
  { value: "octave_bass",        label: "Octave Bass",                      help: "Root played as octave pair on every beat. Source: Lobe den Herren (hymn)." },
  { value: "nocturne",           label: "Nocturne",                         help: "Compound-beat rolling arpeggio: bass + chord + chord per dotted quarter. Source: Chopin Op.9 No.2, Mendelssohn Op.19 No.3." },
  { value: "pop_arpeggio",       label: "Pop Arpeggio (8ths)",              help: "Rolling 8th-note arpeggio: root→5th→oct→5th cycling. Smoother pop ballad LH feel. Source: Drotos Lesson 4." },
  { value: "walking_bass",       label: "Walking Bass",                     help: "Quarter-note bass walking root→3rd→5th→approach, chromatic step into next chord. Source: Drotos Lessons 12 & 14." },
  { value: "pedal_bass",         label: "Pedal Bass",                       help: "Root sustained as whole note. LH anchors while RH moves through neighbor chords. Source: Drotos Lesson 13 (Elton John style)." },
];

type RhPatternValue = NonNullable<Settings["rhPattern"]>;
const RH_PATTERN_OPTIONS: Array<{ label: string; value: RhPatternValue; help: string }> = [
  { value: "melody_only",        label: "Melody Only",         help: "Piano RH plays just the melody line. All harmony in the LH." },
  { value: "melody_inner_voice", label: "Inner Voice (Poly.)", help: "Chiming 8th inner voice with harmonic anchor. Best for worship / polyphonic style." },
  { value: "syncopated",         label: "Syncopated",          help: "Chord hits on the 'and' of each beat — pop / gospel bounce feel." },
  { value: "arpeggio",           label: "Arpeggio",            help: "Ascending 16th-note broken chord per beat — flowing, romantic texture." },
  { value: "block_beats",        label: "Block Chords",        help: "Full chord block on every beat — solid harmonic foundation." },
  { value: "melody_fill_eighths",label: "Fill Eighths",        help: "Ascending broken-chord 8th fills cycling root→3rd→5th→3rd. Lyrical feel." },
  { value: "dotted_ballad",      label: "Dotted Ballad",       help: "Dotted-quarter + 8th groupings (3+1). 'Your Song' Elton John feel — chord lands on 'and of 2'. Source: Drotos Lesson 15." },
];

const STRICTNESS_OPTIONS: Array<{ label: string; value: Settings["ruleStrictness"]; help: string }> = [
  { label: "Relaxed", value: "relaxed", help: "Warnings only, fewer errors." },
  { label: "Standard", value: "standard", help: "Balanced warnings for most cases." },
  { label: "Strict", value: "strict", help: "Escalate core rules to errors." }
];
const STRICTNESS_BY_LEVEL: Record<Settings["level"], Settings["ruleStrictness"]> = {
  beginner: "strict",
  intermediate: "standard",
  advanced: "standard",
  professional: "relaxed"
};

const KEY_OPTIONS_MAJOR = [
  { label: "C major", value: "C major" },
  { label: "G major", value: "G major" },
  { label: "D major", value: "D major" },
  { label: "A major", value: "A major" },
  { label: "E major", value: "E major" },
  { label: "B major", value: "B major" },
  { label: "F# major", value: "F# major" },
  { label: "C# major", value: "C# major" },
  { label: "F major", value: "F major" },
  { label: "Bb major", value: "Bb major" },
  { label: "Eb major", value: "Eb major" },
  { label: "Ab major", value: "Ab major" },
  { label: "Db major", value: "Db major" },
  { label: "Gb major", value: "Gb major" },
  { label: "Cb major", value: "Cb major" }
];

const KEY_OPTIONS_MINOR = [
  { label: "A minor", value: "A minor" },
  { label: "E minor", value: "E minor" },
  { label: "B minor", value: "B minor" },
  { label: "F# minor", value: "F# minor" },
  { label: "C# minor", value: "C# minor" },
  { label: "G# minor", value: "G# minor" },
  { label: "D# minor", value: "D# minor" },
  { label: "A# minor", value: "A# minor" },
  { label: "D minor", value: "D minor" },
  { label: "G minor", value: "G minor" },
  { label: "C minor", value: "C minor" },
  { label: "F minor", value: "F minor" },
  { label: "Bb minor", value: "Bb minor" },
  { label: "Eb minor", value: "Eb minor" },
  { label: "Ab minor", value: "Ab minor" }
];
const TIME_OPTIONS = [
  { label: "Original (from file)", value: "original" },
  { label: "2/4", value: "2/4" },
  { label: "3/4", value: "3/4" },
  { label: "4/4", value: "4/4" },
  { label: "6/8", value: "6/8" },
  { label: "9/8", value: "9/8" },
  { label: "12/8", value: "12/8" }
];

type Props = {
  settings: Settings;
  onChange: (next: Settings) => void;
};

function titleize(input: string) {
  return input.replace(/_/g, " ");
}

export default function SettingsForm({ settings, onChange }: Props) {
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    onChange({ ...settings, [key]: value });
  }

  function updateEnsemble(nextEnsemble: Settings["ensemble"]) {
    const next = { ...settings, ensemble: nextEnsemble };
    if (nextEnsemble !== "piano" && nextEnsemble !== "piano_with_melody" && next.accompaniment === "chordal") {
      next.accompaniment = "homophonic";
    }
    // Keep textureMode consistent with the target ensemble:
    //   → piano: if coming from a non-piano mode that set something incompatible, default to accompaniment
    //   → choral: melody_accompaniment is a piano-only concept; translate back to homorhythmic
    const pianoTextures = new Set<Settings["textureMode"]>(["homophony_melody_accompaniment", "homophony_homorhythmic"]);
    if (nextEnsemble === "piano" || nextEnsemble === "piano_with_melody") {
      if (!pianoTextures.has(next.textureMode)) {
        next.textureMode = "homophony_melody_accompaniment";
      }
    } else if (nextEnsemble === "choral" && next.textureMode === "homophony_melody_accompaniment") {
      next.textureMode = "homophony_homorhythmic";
    }
    // Each ensemble now carries its own routing via the ensemble value
    // (mirroring the string family). Instrumentation defaults to "auto".
    if (nextEnsemble === "piano_string_quartet") {
      next.instrumentation = "piano_copy_to_string_quartet"; // kept for back-compat; routing is by ensemble
      next.level = "advanced";
    } else {
      next.instrumentation = "auto";
    }
    onChange(next);
  }

  function updateLevel(nextLevel: Settings["level"]) {
    const nextStrictness = STRICTNESS_BY_LEVEL[nextLevel] ?? "standard";
    const next = { ...settings, level: nextLevel, ruleStrictness: nextStrictness };
    if (nextLevel !== "beginner" && next.accompaniment === "chordal") {
      next.accompaniment = "homophonic";
    }
    onChange(next);
  }

  const keyPreview =
    settings.keySignature === "original"
      ? "Original (from file)"
      : settings.keySignature
        ? settings.keySignature
        : "None";

  const textureHelp =
    TEXTURE_OPTIONS.find((opt) => opt.value === settings.textureMode)?.help ?? "Choose a texture target.";

  const profileHelp =
    POLYPHONIC_PROFILES.find((opt) => opt.value === settings.styleProfile)?.help ?? "Choose a profile.";

  const modernHelp =
    MODERN_MODES.find((opt) => opt.value === settings.modernMode)?.help ?? "Choose a modern mode.";
  const accompanimentHelp = ACCOMP_HELP[settings.accompaniment] ?? "Select an accompaniment texture.";
  const bassActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.bassActivity)?.help ?? "Choose activity level.";
  const tenorActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.tenorActivity)?.help ?? "Choose activity level.";
  const altoActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.altoActivity)?.help ?? "Choose activity level.";
  const sopranoActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.sopranoActivity)?.help ?? "Choose activity level.";
  const vln1ActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.vln1Activity)?.help ?? "Choose activity level.";
  const vln2ActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.vln2Activity)?.help ?? "Choose activity level.";
  const vlaActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.vlaActivity)?.help ?? "Choose activity level.";
  const vcActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.vcActivity)?.help ?? "Choose activity level.";
  const cbActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.cbActivity)?.help ?? "Choose activity level.";
  const isPiano = settings.ensemble === "piano" || settings.ensemble === "piano_with_melody";
  const isStrings = settings.ensemble === "string_ensemble" || settings.ensemble === "piano_with_strings";
  const isPianoStringQuartet = settings.ensemble === "piano_string_quartet";
  const isSatbStringQuartet  = settings.ensemble === "satb_string_quartet";
  // Wind auto = the two modes that GENERATE an arrangement (mirror string auto).
  const isWindAuto = settings.ensemble === "woodwind_ensemble" || settings.ensemble === "piano_with_woodwinds";
  const isWoodwinds =
    isWindAuto ||
    settings.ensemble === "piano_woodwind_quartet" ||
    settings.ensemble === "satb_woodwind_quartet";
  // The shared auto-arranger panel (texture, examples, composer, style, level,
  // accompaniment) is used by both string auto and wind auto.
  const isAutoArranger = isStrings || isWindAuto;
  const isCopyInstrumentation = false; // legacy — routing now handled by ensemble value
  const instrumentationHelp =
    (isStrings ? STRING_INSTRUMENTATION_OPTIONS : isWoodwinds ? WOODWIND_INSTRUMENTATION_OPTIONS : []).find(
      (opt) => opt.value === settings.instrumentation
    )?.help ??
    "Choose instrumentation mapping.";
  const sopranoMelodyShare = Math.max(0, Math.min(100, settings.sopranoMelodyShare ?? 30));
  const offsetsHelp =
    settings.randomizeOffsets === false
      ? "Offsets disabled: rhythms align to downbeats."
      : "Offsets enabled: subtle syncopation and staggered entries.";
  const showPolyphonicControls = settings.accompaniment === "polyphonic" || settings.textureMode === "polyphony";
  const showStringPolyphonic = isStrings && showPolyphonicControls;
  const showWoodwindPolyphonic = isWoodwinds && showPolyphonicControls;
  const showGenericPolyphonicVoices = showPolyphonicControls && !showStringPolyphonic && !showWoodwindPolyphonic;
  // Non-piano branch: chordal is piano-only so always filter it out
  const accompanimentOptions = ACCOMP_OPTIONS.filter((opt) => opt !== "chordal");

  useEffect(() => {
    if (settings.ensemble !== "piano" && settings.ensemble !== "piano_with_melody" && settings.accompaniment === "chordal") {
      onChange({ ...settings, accompaniment: "homophonic" });
    }
  }, [settings, onChange]);

  useEffect(() => {
    if (settings.level !== "beginner" && settings.accompaniment === "chordal") {
      onChange({ ...settings, accompaniment: "homophonic" });
    }
  }, [settings, onChange]);

  // ── Choral simplified controls ──────────────────────────────────────────────
  // Three top-level accompaniment modes:
  //   "homophonic" → block chords (homorhythmic)
  //   "polyphonic" → four-voice counterpoint
  //   "style"      → style-driven harmonisation; reveals style sub-picker

  type ChoralAccompMode = "homophonic" | "polyphonic" | "style";

  // Style options for the choral "Style" sub-panel (includes Worship)
  const CHORAL_STYLE_OPTIONS: Array<{ label: string; value: Settings["style"]; help: string }> = [
    { label: "Baroque",   value: "baroque",   help: "Strict Bach/Handel counterpoint — close spacing, no parallel 5ths/8ths (1600–1750)." },
    { label: "Classical", value: "classical", help: "Haydn/Mozart clarity — balanced voice-leading and phrase symmetry (1750–1820)." },
    { label: "Romantic",  value: "romantic",  help: "Brahms/Dvořák richness — wider spacing, chromatic colour, expressive leaps (1820–1900)." },
    { label: "Modern",    value: "modern",    help: "Extended harmony — tonal, modal, or atonal sub-modes (1900–present)." },
    { label: "Worship",   value: "worship",   help: "Hymn-style four-voice writing — devotional, accessible harmonisation." },
  ];

  // Derive the active mode from settings (backward-compat: fall back to accompaniment field)
  const choralMode: ChoralAccompMode =
    settings.choralMode === "style"      ? "style"      :
    settings.choralMode === "polyphonic" ? "polyphonic" :
    settings.choralMode === "homophonic" ? "homophonic" :
    settings.accompaniment === "polyphonic" ? "polyphonic" : "homophonic";

  // Active style value (only shown in "style" sub-panel)
  const choralStyle: Settings["style"] = (
    ["baroque", "classical", "romantic", "modern", "worship"].includes(settings.style ?? "")
      ? settings.style
      : "classical"
  ) as Settings["style"];

  function updateChoralAccomp(mode: ChoralAccompMode) {
    const next: Settings = { ...settings, choralMode: mode };
    if (mode === "polyphonic") {
      next.accompaniment = "polyphonic";
      next.textureMode   = "polyphony";
      next.styleProfile  = next.styleProfile ?? "classical";
    } else if (mode === "style") {
      next.accompaniment = "polyphonic";
      next.textureMode   = "polyphony";
      // Keep current style or default to classical
      const s = choralStyle ?? "classical";
      const profileMap: Record<string, Settings["styleProfile"]> = {
        baroque: "baroque", classical: "classical", romantic: "romantic",
        modern: "modern", worship: "classical",
      };
      next.styleProfile  = profileMap[s] ?? "classical";
    } else {
      next.accompaniment = "homophonic";
      next.textureMode   = "homophony_homorhythmic";
    }
    onChange(next);
  }

  function updateChoralStyle(style: Settings["style"]) {
    const profileMap: Record<string, Settings["styleProfile"]> = {
      baroque: "baroque", classical: "classical", romantic: "romantic",
      modern: "modern", worship: "classical",
    };
    const next: Settings = {
      ...settings,
      style,
      styleProfile: profileMap[style] ?? "classical",
      choralMode: "style",
      accompaniment: "polyphonic",
      textureMode: "polyphony",
    };
    if (style === "baroque")        { next.level = "advanced";      next.ruleStrictness = "strict";   }
    else if (style === "romantic")  { next.level = "intermediate";  next.ruleStrictness = "relaxed";  }
    else if (style === "modern")    { next.level = "professional";  next.ruleStrictness = "relaxed";  if (!next.modernMode) next.modernMode = "modernTonal"; }
    else                            { next.level = "intermediate";  next.ruleStrictness = "standard"; }
    onChange(next);
  }
  // ───────────────────────────────────────────────────────────────────────────

  // ── Piano simplified controls ────────────────────────────────────────────
  // pianoMode: "choral"       → 4-voice hymn on grand staff (buildChoralHymnGrandStaff)
  //            "accompaniment"→ melody + LH pattern + RH pattern (buildPianoMelodyAccomp)
  // The Homophonic/Polyphonic harmonizer toggle has been removed: piano always uses
  // the homophonic harmonizer (optimal for chord-symbol-driven LH patterns).
  const pianoMode = (
    settings.textureMode === "homophony_melody_accompaniment" ? "accompaniment" : "choral"
  ) as "choral" | "accompaniment";

  function updatePianoMode(mode: "choral" | "accompaniment") {
    const next = { ...settings };
    next.textureMode =
      mode === "accompaniment" ? "homophony_melody_accompaniment" : "homophony_homorhythmic";
    next.accompaniment = "homophonic";
    next.styleProfile = "classical";
    next.level = "intermediate";
    next.ruleStrictness = "standard";
    onChange(next);
  }
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="settings-form">
      {/* ── Title ── always shown ─────────────────────────────────────────── */}
      <div className="field">
        <label>Title</label>
        <input
          value={settings.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="Song title"
        />
      </div>

      {/* ── Ensemble ── always shown ──────────────────────────────────────── */}
      <div className="field">
        <label>Ensemble</label>
        <select value={settings.ensemble} onChange={(e) => updateEnsemble(e.target.value as Settings["ensemble"])}>
          {ENSEMBLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {settings.ensemble !== "choral" &&
          settings.ensemble !== "piano" &&
          settings.ensemble !== "piano_with_melody" &&
          settings.ensemble !== "string_ensemble" &&
          settings.ensemble !== "piano_string_quartet" &&
          settings.ensemble !== "satb_string_quartet" &&
          settings.ensemble !== "piano_with_strings" &&
          settings.ensemble !== "woodwind_ensemble" &&
          settings.ensemble !== "piano_woodwind_quartet" &&
          settings.ensemble !== "satb_woodwind_quartet" &&
          settings.ensemble !== "piano_with_woodwinds" &&
          settings.ensemble !== "brass_ensemble" &&
          settings.ensemble !== "piano_brass_quartet" &&
          settings.ensemble !== "satb_brass_quartet" &&
          settings.ensemble !== "piano_with_brass" &&
          settings.ensemble !== "reinstrument" &&
          settings.ensemble !== "orchestra" &&
          settings.ensemble !== "piano_orchestra" &&
          settings.ensemble !== "satb_orchestra" &&
          settings.ensemble !== "symphonic_orchestra" && (
            <div className="pill warn">Coming soon (SATB + piano + strings + woodwinds + brass supported)</div>
          )}
      </div>

      {settings.ensemble === "choral" ? (
        /* ════════════════════════════════════════════════════════════════════
           CHORAL — Key · Tempo · Accompaniment (3 modes) · [Style sub-panel]
           ════════════════════════════════════════════════════════════════════ */
        <>
          {/* Key */}
          <div className="field">
            <label>Key Signature</label>
            <select value={settings.keySignature} onChange={(e) => update("keySignature", e.target.value)}>
              <option value="original">Original (from file)</option>
              <optgroup label="Major">
                {KEY_OPTIONS_MAJOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
              <optgroup label="Minor">
                {KEY_OPTIONS_MINOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            </select>
            <div className="key-preview">
              Selected: <span className="key-badge">{keyPreview}</span>
            </div>
          </div>

          {/* Tempo */}
          <div className="field">
            <label>Tempo (BPM)</label>
            <input
              type="number"
              min={30}
              max={240}
              value={settings.tempo}
              onChange={(e) => update("tempo", Number(e.target.value))}
            />
          </div>

          {/* Accompaniment — 3-way primary selector */}
          <div className="field">
            <label>Accompaniment</label>
            <select value={choralMode} onChange={(e) => updateChoralAccomp(e.target.value as ChoralAccompMode)}>
              <option value="homophonic">Homophonic</option>
              <option value="polyphonic">Polyphonic (Counterpoint)</option>
              <option value="style">Style</option>
            </select>
            <div className="key-preview">
              <span className="slider-help">
                {choralMode === "homophonic"
                  ? "All voices move together in block chords (homorhythmic)."
                  : choralMode === "polyphonic"
                  ? "Four independent melodic lines with shared harmony — classic SATB counterpoint."
                  : "Harmonisation guided by the chosen musical period style."}
              </span>
            </div>
          </div>

          {/* Style sub-panel — only shown when "Style" accompaniment is selected */}
          {choralMode === "style" && (
            <div className="field">
              <label>Style</label>
              <select value={choralStyle} onChange={(e) => updateChoralStyle(e.target.value as Settings["style"])}>
                {CHORAL_STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="key-preview">
                <span className="slider-help">
                  {CHORAL_STYLE_OPTIONS.find((o) => o.value === choralStyle)?.help ?? ""}
                </span>
              </div>
            </div>
          )}

          {/* Modern sub-mode — only shown when Style mode + Modern selected */}
          {choralMode === "style" && choralStyle === "modern" && (
            <div className="field">
              <label>Modern Sub-mode</label>
              <select
                value={settings.modernMode ?? "modernTonal"}
                onChange={(e) => update("modernMode", e.target.value as Settings["modernMode"])}
              >
                {MODERN_MODES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="key-preview">
                <span className="slider-help">
                  {MODERN_MODES.find((o) => o.value === (settings.modernMode ?? "modernTonal"))?.help ?? ""}
                </span>
              </div>
            </div>
          )}
        </>
      ) : isPiano ? (
        /* ════════════════════════════════════════════════════════════════════
           PIANO — simplified panel: Key · Time · Tempo · Style · Accompaniment
           ════════════════════════════════════════════════════════════════════ */
        <>
          <div className="field">
            <label>Key Signature</label>
            <select value={settings.keySignature} onChange={(e) => update("keySignature", e.target.value)}>
              <option value="original">Original (from file)</option>
              <optgroup label="Major">
                {KEY_OPTIONS_MAJOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
              <optgroup label="Minor">
                {KEY_OPTIONS_MINOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            </select>
            <div className="key-preview">
              Selected: <span className="key-badge">{keyPreview}</span>
            </div>
          </div>

          <div className="field">
            <label>Time Signature</label>
            <select value={settings.timeSignature} onChange={(e) => update("timeSignature", e.target.value)}>
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Tempo (BPM)</label>
            <input
              type="number"
              min={30}
              max={240}
              value={settings.tempo}
              onChange={(e) => update("tempo", Number(e.target.value))}
            />
          </div>

          {/* Mode: Choral / Accompaniment */}
          <div className="field">
            <label>Mode</label>
            <select
              value={pianoMode}
              onChange={(e) => updatePianoMode(e.target.value as "choral" | "accompaniment")}
            >
              <option value="choral">Choral</option>
              <option value="accompaniment">Accompaniment</option>
            </select>
            <div className="key-preview">
              <span className="slider-help">
                {pianoMode === "choral"
                  ? "Four voices move together in block chords — SATB texture adapted for piano."
                  : "Melody leads in the right hand with harmonic support in the left hand."}
              </span>
            </div>
          </div>

          {/* LH Pattern + RH Pattern — Accompaniment mode only */}
          {pianoMode === "accompaniment" && (() => {
            const currentLhPattern = settings.lhPattern ?? "auto";
            const lhHelp = LH_PATTERN_OPTIONS.find(o => o.value === currentLhPattern)?.help ?? "";
            const currentRhPattern = (settings.rhPattern ?? "melody_inner_voice") as RhPatternValue;
            const rhHelp = RH_PATTERN_OPTIONS.find(o => o.value === currentRhPattern)?.help ?? "";
            return (
              <>
                <div className="field">
                  <label>LH Pattern</label>
                  <select
                    value={currentLhPattern}
                    onChange={(e) => update("lhPattern", e.target.value as LhPatternValue)}
                  >
                    {LH_PATTERN_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="key-preview">
                    <span className="slider-help">{lhHelp}</span>
                  </div>
                </div>
                <div className="field">
                  <label>RH Pattern</label>
                  <select
                    value={currentRhPattern}
                    onChange={(e) => update("rhPattern", e.target.value as RhPatternValue)}
                  >
                    {RH_PATTERN_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="key-preview">
                    <span className="slider-help">{rhHelp}</span>
                  </div>
                </div>
              </>
            );
          })()}
        </>
      ) : isPianoStringQuartet ? (
        /* ════════════════════════════════════════════════════════════════════
           PIANO → STRING QUARTET — direct copy, no harmonizer
           RH → Violin I + II  |  LH → Viola + Cello
           ════════════════════════════════════════════════════════════════════ */
        <>
          <div className="field">
            <div className="pill info" style={{ marginBottom: 4 }}>
              Faithful copy: RH → Violin I &amp; II · LH → Viola &amp; Cello.
              Priority is Rhythm → Notes → Harmony; every chord note is preserved.
              This mode does not restyle, so there are no texture / style / composer
              controls — for a styled arrangement use <b>string ensemble (auto)</b> or
              <b> piano + strings (complement)</b>.
            </div>
          </div>

          {/* Key Signature */}
          <div className="field">
            <label>Key Signature</label>
            <select value={settings.keySignature} onChange={(e) => update("keySignature", e.target.value)}>
              <option value="original">Original (from file)</option>
              <optgroup label="Major">
                {KEY_OPTIONS_MAJOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
              <optgroup label="Minor">
                {KEY_OPTIONS_MINOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Tempo */}
          <div className="field">
            <label>Tempo (BPM)</label>
            <input
              type="number" min={30} max={240}
              value={settings.tempo}
              onChange={(e) => update("tempo", Number(e.target.value))}
            />
          </div>
        </>

      ) : isSatbStringQuartet ? (
        /* ════════════════════════════════════════════════════════════════════
           SATB → STRING QUARTET — direct voice mapping, no harmonizer
           Soprano→Violin I · Alto→Violin II · Tenor→Viola · Bass→Cello
           ════════════════════════════════════════════════════════════════════ */
        <>
          <div className="field">
            <div className="pill info" style={{ marginBottom: 4 }}>
              Maps each SATB voice directly to strings: Soprano→Violin I · Alto→Violin II · Tenor→Viola · Bass→Cello.
              Upload a choral SATB score; notes are clamped to each instrument's range.
            </div>
          </div>

          {/* Key Signature */}
          <div className="field">
            <label>Key Signature</label>
            <select value={settings.keySignature} onChange={(e) => update("keySignature", e.target.value)}>
              <option value="original">Original (from file)</option>
              <optgroup label="Major">
                {KEY_OPTIONS_MAJOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
              <optgroup label="Minor">
                {KEY_OPTIONS_MINOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Tempo */}
          <div className="field">
            <label>Tempo (BPM)</label>
            <input
              type="number" min={30} max={240}
              value={settings.tempo}
              onChange={(e) => update("tempo", Number(e.target.value))}
            />
          </div>
        </>

      ) : isAutoArranger ? (
        /* ════════════════════════════════════════════════════════════════════
           AUTO ARRANGER — string OR wind ensemble (style-driven, lead sheets)
           ════════════════════════════════════════════════════════════════════ */
        <>
          {/* Woodwind quintet toggle (wind auto only) */}
          {isWindAuto && (
            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.woodwindQuintet === true}
                  onChange={(e) => update("woodwindQuintet", e.target.checked)}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
                Woodwind quintet (add Horn in F)
              </label>
              <div className="key-preview">
                <span className="slider-help">Adds a French Horn in F as a 5th voice between Clarinet and Bassoon.</span>
              </div>
            </div>
          )}

          {/* ── Wind Texture (wind auto) ── */}
          {isWindAuto && (() => {
            const currentTexture = settings.woodwindTexture ?? "melody_harmony";
            const textureOpt = WIND_TEXTURE_OPTIONS.find((o) => o.value === currentTexture);
            return (
              <div className="field">
                <label>Wind Texture</label>
                <select
                  value={currentTexture}
                  onChange={(e) => {
                    const tex = e.target.value as NonNullable<Settings["woodwindTexture"]>;
                    const next: Partial<Settings> = { woodwindTexture: tex };
                    if (tex === "contrapuntal") { next.textureMode = "polyphony"; next.accompaniment = "polyphonic"; }
                    else if (settings.accompaniment === "polyphonic") { next.textureMode = "homophony_homorhythmic"; next.accompaniment = "homophonic"; }
                    onChange({ ...settings, ...next });
                  }}
                >
                  {WIND_TEXTURE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="key-preview">
                  <span className="slider-help">{textureOpt?.help ?? ""}</span>
                </div>
              </div>
            );
          })()}

          {/* ── Wind Examples + Composer (wind auto) ── */}
          {isWindAuto && (() => {
            const currentExample = settings.woodwindExample ?? "";
            const exampleOpt = WIND_EXAMPLE_OPTIONS.find((o) => o.value === currentExample);
            const detectedComposer = currentExample ? (WIND_EXAMPLE_OPTIONS.find(o => o.value === currentExample)?.composer ?? "") : "";
            const currentComposer = settings.woodwindComposer ?? "";
            const effectiveComposer = currentComposer && currentComposer !== "auto" ? currentComposer : detectedComposer;
            const COMPOSER_OPTIONS = [
              { label: "Bach", value: "bach", period: "baroque" },
              { label: "Handel", value: "handel", period: "baroque" },
              { label: "Haydn", value: "haydn", period: "classical" },
              { label: "Mozart", value: "mozart", period: "classical" },
              { label: "Beethoven", value: "beethoven", period: "classical" },
              { label: "Schubert", value: "schubert", period: "romantic" },
              { label: "Brahms", value: "brahms", period: "romantic" },
              { label: "Dvořák", value: "dvorak", period: "romantic" },
            ];
            return (
              <>
                <div className="field">
                  <label>Example</label>
                  <select
                    value={currentExample}
                    onChange={(e) => {
                      const ex = e.target.value;
                      const next: Partial<Settings> = { woodwindExample: ex };
                      const tex = WIND_EXAMPLE_OPTIONS.find(o => o.value === ex)?.texture;
                      if (tex) next.woodwindTexture = tex;
                      if (settings.woodwindComposer && settings.woodwindComposer !== "auto") next.woodwindComposer = undefined;
                      onChange({ ...settings, ...next });
                    }}
                  >
                    <option value="">— None —</option>
                    {WIND_EXAMPLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {exampleOpt && (
                    <div className="key-preview"><span className="slider-help">{exampleOpt.help}</span></div>
                  )}
                </div>
                <div className="field">
                  <label>
                    Composer Style
                    {effectiveComposer && effectiveComposer !== currentComposer && (
                      <span className="slider-help"> (auto-detected from example)</span>
                    )}
                  </label>
                  <select
                    value={currentComposer || "auto"}
                    onChange={(e) => update("woodwindComposer", e.target.value === "auto" ? undefined : e.target.value)}
                  >
                    <option value="auto">
                      {detectedComposer
                        ? `Auto — ${COMPOSER_OPTIONS.find(c => c.value === detectedComposer)?.label ?? detectedComposer}`
                        : "Auto (from example or period style)"}
                    </option>
                    <optgroup label="Baroque">
                      {COMPOSER_OPTIONS.filter(c => c.period === "baroque").map(c => (<option key={c.value} value={c.value}>{c.label}</option>))}
                    </optgroup>
                    <optgroup label="Classical">
                      {COMPOSER_OPTIONS.filter(c => c.period === "classical").map(c => (<option key={c.value} value={c.value}>{c.label}</option>))}
                    </optgroup>
                    <optgroup label="Romantic">
                      {COMPOSER_OPTIONS.filter(c => c.period === "romantic").map(c => (<option key={c.value} value={c.value}>{c.label}</option>))}
                    </optgroup>
                  </select>
                </div>
              </>
            );
          })()}

          {/* String Texture (string auto only) */}
          {isStrings && (() => {
            const currentTexture = settings.stringTexture ?? "melody_harmony";
            const textureOpt = STRING_TEXTURE_OPTIONS.find((o) => o.value === currentTexture);
            return (
              <div className="field">
                <label>String Texture</label>
                <select
                  value={currentTexture}
                  onChange={(e) => {
                    const tex = e.target.value as Settings["stringTexture"];
                    // "Counterpoint" activates the polyphonic engine; all other
                    // texture modes use the block-chord DP arranger.
                    const next: Partial<Settings> = { stringTexture: tex };
                    if (tex === "counterpoint") {
                      next.textureMode = "polyphony";
                      next.accompaniment = "polyphonic";
                    } else if (settings.accompaniment === "polyphonic") {
                      next.textureMode = "homophony_homorhythmic";
                      next.accompaniment = "homophonic";
                    }
                    onChange({ ...settings, ...next });
                  }}
                >
                  {STRING_TEXTURE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="key-preview">
                  <span className="slider-help">{textureOpt?.help ?? ""}</span>
                </div>
              </div>
            );
          })()}

          {/* Examples — reference pieces grouped by texture mode (string auto only) */}
          {isStrings && (() => {
            const currentTexture = settings.stringTexture ?? "melody_harmony";
            // Counterpoint mode accepts any string quartet piece as a reference;
            // show all examples rather than returning an empty list.
            const examplesForTexture =
              currentTexture === "counterpoint"
                ? STRING_EXAMPLE_OPTIONS
                : STRING_EXAMPLE_OPTIONS.filter((o) => o.texture === currentTexture);
            const currentExample = settings.stringExample ?? "";
            const exampleOpt = STRING_EXAMPLE_OPTIONS.find((o) => o.value === currentExample);

            // Composer override options — grouped by period matching the selected style
            const currentPeriodStyle = (settings.style ?? "classical").toLowerCase();
            const COMPOSER_OPTIONS: Array<{ label: string; value: string; period: string }> = [
              { label: "Bach",      value: "bach",      period: "baroque"  },
              { label: "Vivaldi",   value: "vivaldi",   period: "baroque"  },
              { label: "Handel",    value: "handel",    period: "baroque"  },
              { label: "Haydn",     value: "haydn",     period: "classical" },
              { label: "Mozart",    value: "mozart",    period: "classical" },
              { label: "Beethoven", value: "beethoven", period: "classical" },
              { label: "Schubert",  value: "schubert",  period: "romantic"  },
              { label: "Brahms",    value: "brahms",    period: "romantic"  },
              { label: "Dvořák",    value: "dvorak",    period: "romantic"  },
            ];
            // Auto-detect composer from selected example
            const EXAMPLE_TO_COMPOSER_UI: Record<string, string> = {
              beethoven_op18_no1: "beethoven",
              mozart_k387_mvt1: "mozart", mozart_k421_mvt1: "mozart",
              mozart_k421: "mozart", mozart_k545_arr_mvt1: "mozart", mozart_k465_mvt1: "mozart",
              haydn_op76_no3_mvt2: "haydn", haydn_op64_no3_mvt1: "haydn",
              haydn_op64_no5_mvt1: "haydn", haydn_lark: "haydn",
              dvorak_op51: "dvorak", dvorak_op96_american: "dvorak",
              brahms_op51_no1: "brahms",
            };
            const detectedComposer = currentExample ? (EXAMPLE_TO_COMPOSER_UI[currentExample] ?? "") : "";
            const currentComposer = settings.stringComposer ?? "";
            const effectiveComposer = currentComposer && currentComposer !== "auto" ? currentComposer : detectedComposer;

            return (
              <>
                <div className="field">
                  <label>Example</label>
                  <select
                    value={currentExample}
                    onChange={(e) => {
                      update("stringExample", e.target.value);
                      // Clear manual override when example changes so auto-detect takes over
                      if (settings.stringComposer && settings.stringComposer !== "auto") {
                        update("stringComposer", "auto");
                      }
                    }}
                  >
                    <option value="">— None —</option>
                    {examplesForTexture.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {exampleOpt && (
                    <div className="key-preview">
                      <span className="slider-help">{exampleOpt.help}</span>
                    </div>
                  )}
                </div>
                <div className="field">
                  <label>
                    Composer Style
                    {effectiveComposer && effectiveComposer !== currentComposer && (
                      <span className="slider-help"> (auto-detected from example)</span>
                    )}
                  </label>
                  <select
                    value={currentComposer || "auto"}
                    onChange={(e) => update("stringComposer", e.target.value === "auto" ? undefined : e.target.value)}
                  >
                    <option value="auto">
                      {detectedComposer
                        ? `Auto — ${COMPOSER_OPTIONS.find(c => c.value === detectedComposer)?.label ?? detectedComposer}`
                        : "Auto (from example or period style)"}
                    </option>
                    <optgroup label="Baroque">
                      {COMPOSER_OPTIONS.filter(c => c.period === "baroque").map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Classical">
                      {COMPOSER_OPTIONS.filter(c => c.period === "classical").map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Romantic">
                      {COMPOSER_OPTIONS.filter(c => c.period === "romantic").map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  {effectiveComposer && (() => {
                    const profileDescriptions: Record<string, string> = {
                      bach:      "Contrapuntal: walking 8th bass, all voices independent (voiceIndependence=0.85).",
                      vivaldi:   "Ostinato: repeated root bass, running 8th sequences in inner voices.",
                      handel:    "Balanced counterpoint: walking quarter bass, moderate voice independence.",
                      haydn:     "Classical wit: arpeggiated inner voices, surprise rests, motivic development.",
                      mozart:    "Clarity: Alberti bass (root-5th-3rd-5th), light quarter upper voices.",
                      beethoven: "Drama: syncopated bass, strategic rests, independent 8th-note lines.",
                      schubert:  "Lyrical: dotted rhythms, singing inner lines, walking bass.",
                      brahms:    "Dense: cross-rhythm hemiolia, chromatic walking bass.",
                      dvorak:    "Folk warmth: arpeggiated cello, folkloric sequences in inner voices.",
                    };
                    return (
                      <div className="key-preview">
                        <span className="slider-help">{profileDescriptions[effectiveComposer] ?? ""}</span>
                      </div>
                    );
                  })()}
                </div>
              </>
            );
          })()}

          {/* Melody Only — auto-harmonize from melody when no chords are provided */}
          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.melodyOnly === true}
                onChange={(e) => update("melodyOnly", e.target.checked ? true : undefined)}
                style={{ width: "16px", height: "16px", cursor: "pointer" }}
              />
              Melody Only Mode
            </label>
            <div className="key-preview">
              <span className="slider-help">
                {settings.melodyOnly
                  ? "✓ Engine will detect key and generate harmony automatically from the melody."
                  : "Upload a melody without chords — engine auto-harmonizes using Krumhansl-Schmuckler key detection + scale-degree rules."}
              </span>
            </div>
          </div>

          {/* Key Signature */}
          <div className="field">
            <label>Key Signature{settings.melodyOnly ? " (auto-detected when Melody Only is on)" : ""}</label>
            <select
              value={settings.keySignature}
              onChange={(e) => update("keySignature", e.target.value)}
              disabled={settings.melodyOnly === true}
              style={settings.melodyOnly ? { opacity: 0.5 } : undefined}
            >
              <option value="original">Original (from file)</option>
              <optgroup label="Major">
                {KEY_OPTIONS_MAJOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
              <optgroup label="Minor">
                {KEY_OPTIONS_MINOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            </select>
            <div className="key-preview">
              Selected: <span className="key-badge">{keyPreview}</span>
            </div>
          </div>

          {/* Time Signature */}
          <div className="field">
            <label>Time Signature</label>
            <select value={settings.timeSignature} onChange={(e) => update("timeSignature", e.target.value)}>
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Tempo */}
          <div className="field">
            <label>Tempo (BPM)</label>
            <input
              type="number"
              min={30}
              max={240}
              value={settings.tempo}
              onChange={(e) => update("tempo", Number(e.target.value))}
            />
          </div>

          {/* Style — hidden in copy mode (style is already baked into the source) */}
          {!isCopyInstrumentation && <div className="field">
            <label>Style</label>
            <select
              value={["baroque", "classical", "romantic", "modern"].includes(settings.style) ? settings.style : "classical"}
              onChange={(e) => {
                const s = e.target.value as Settings["style"];
                const next: Partial<Settings> = { style: s };
                if (s === "baroque")       { next.styleProfile = "baroque";   next.ruleStrictness = "strict";   next.level = "advanced"; }
                else if (s === "romantic") { next.styleProfile = "romantic";  next.ruleStrictness = "relaxed";  next.level = "intermediate"; }
                else if (s === "modern")   { next.styleProfile = "modern";    next.ruleStrictness = "relaxed";  next.level = "professional"; if (!settings.modernMode) next.modernMode = "modernTonal"; }
                else                       { next.styleProfile = "classical"; next.ruleStrictness = "standard"; next.level = "intermediate"; }
                onChange({ ...settings, ...next });
              }}
            >
              {PERIOD_STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <div className="key-preview">
              <span className="slider-help">
                {PERIOD_STYLE_OPTIONS.find((o) => o.value === settings.style)?.help ?? ""}
              </span>
            </div>
          </div>}

          {!isCopyInstrumentation && settings.style === "modern" && (
            <div className="field">
              <label>Modern Sub-mode</label>
              <select
                value={settings.modernMode ?? "modernTonal"}
                onChange={(e) => update("modernMode", e.target.value as Settings["modernMode"])}
              >
                {MODERN_MODES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="key-preview">
                <span className="slider-help">
                  {MODERN_MODES.find((o) => o.value === (settings.modernMode ?? "modernTonal"))?.help ?? ""}
                </span>
              </div>
            </div>
          )}

          {/* Level */}
          <div className="field">
            <label>Level</label>
            <select value={settings.level} onChange={(e) => updateLevel(e.target.value as Settings["level"])}>
              {LEVEL_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{titleize(opt)}</option>
              ))}
            </select>
          </div>

          {/* Accompaniment — homophonic / polyphonic only; hidden in copy mode */}
          {!isCopyInstrumentation && <div className="field">
            <label>Accompaniment</label>
            <select
              value={settings.accompaniment === "polyphonic" ? "polyphonic" : "homophonic"}
              onChange={(e) => {
                const acc = e.target.value as "homophonic" | "polyphonic";
                const next: Partial<Settings> = { accompaniment: acc };
                if (acc === "polyphonic") {
                  next.textureMode = "polyphony";
                  if (isWindAuto) next.woodwindTexture = "contrapuntal";
                  else            next.stringTexture = "counterpoint";
                } else {
                  next.textureMode = "homophony_homorhythmic";
                  if (isWindAuto && settings.woodwindTexture === "contrapuntal") next.woodwindTexture = "melody_harmony";
                  else if (settings.stringTexture === "counterpoint")            next.stringTexture = "melody_harmony";
                }
                onChange({ ...settings, ...next });
              }}
            >
              <option value="homophonic">Homophonic</option>
              <option value="polyphonic">Polyphonic (counterpoint)</option>
            </select>
            <div className="key-preview">
              <span className="slider-help">
                {settings.accompaniment === "polyphonic"
                  ? "Independent melodic lines with shared harmony (counterpoint)."
                  : "All voices move together in vertical block chords."}
              </span>
            </div>
          </div>}

          {/* Per-instrument activity is now driven automatically by the chosen
              Wind Texture (block chorale / melody+harmony / chamber / counterpoint),
              so no per-instrument sliders are shown. */}
        </>

      ) : (
        /* ════════════════════════════════════════════════════════════════════
           ALL OTHER ENSEMBLES — full settings panel (woodwinds · brass)
           ════════════════════════════════════════════════════════════════════ */
        <>
          {/* Wind auto (quintet, texture, examples, activity) is handled in the
              auto-arranger branch above. This branch is the copy/brass panel. */}

          {/* Bassoon entry rule — Piano→Wind quartet only */}
          {settings.ensemble === "piano_woodwind_quartet" && (
            <div className="field">
              <label>Bassoon enters at measure</label>
              <input
                type="number"
                min={0}
                placeholder="auto"
                value={settings.bassoonEntryMeasure ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  update("bassoonEntryMeasure", v === "" ? undefined : Math.max(0, Number(v)) as any);
                }}
              />
              <div className="key-preview">
                <span className="slider-help">
                  Bassoon rests before this measure (the soft intro). Blank = auto-detect the thin intro; 0 = play from the start.
                </span>
              </div>
            </div>
          )}

          {/* Symphonic orchestra — period switches BOTH the roster and the scoring */}
          {settings.ensemble === "symphonic_orchestra" && (
            <div className="field">
              <label>Period</label>
              <select
                value={settings.symphonicPeriod ?? "romantic"}
                onChange={(e) => update("symphonicPeriod", e.target.value as "classical" | "romantic")}
              >
                <option value="romantic">Romantic (Brahms / Dvořák / Tchaikovsky)</option>
                <option value="classical">Classical (Haydn / Mozart / early Beethoven)</option>
              </select>
              <span className="slider-help">
                {settings.symphonicPeriod === "classical"
                  ? "12 parts — Fl, Ob, Cl, Bsn · Horn 1-2 · Trumpet 1-2 · Timpani · strings. Transparent and lean; no trombones or tuba."
                  : "15 parts — adds Horn 3-4, Trombone 1-2 and Trombone 3/Tuba for the full Romantic weight."}
                {" "}Strings lead throughout, winds add colour, brass is held back for the climaxes.
              </span>
            </div>
          )}

          {/* Worship orchestra — texture (auto mode only; piano/SATB are faithful transcriptions) */}
          {(settings.ensemble === "orchestra" || settings.ensemble === "symphonic_orchestra") && (
            <div className="field">
              <label>{settings.ensemble === "symphonic_orchestra" ? "Texture" : "Orchestra texture"}</label>
              <select
                value={settings.orchestraTexture ?? "melody_harmony"}
                onChange={(e) => {
                  const t = e.target.value as "melody_harmony" | "chorale" | "contrapuntal";
                  const next: Partial<Settings> = { orchestraTexture: t };
                  if (t === "contrapuntal") { next.textureMode = "polyphony"; next.accompaniment = "polyphonic"; }
                  else if (settings.accompaniment === "polyphonic") { next.textureMode = "homophony_homorhythmic"; next.accompaniment = "homophonic"; }
                  onChange({ ...settings, ...next });
                }}
              >
                <option value="melody_harmony">Melody + Harmony (cushion)</option>
                <option value="chorale">Chorale (hymn block)</option>
                <option value="contrapuntal">Contrapuntal (independent lines)</option>
              </select>
              <div className="key-preview">
                <span className="slider-help">
                  How the harmonic core is voiced. Melody + Harmony: tune on top over a cushion (default).
                  Chorale: hymn-style block, all voices together. Contrapuntal: independent imitative lines.
                </span>
              </div>
            </div>
          )}

          {/* Orchestra — intensity control (worship + symphonic) */}
          {(settings.ensemble === "orchestra" || settings.ensemble === "piano_orchestra" || settings.ensemble === "satb_orchestra" ||
            settings.ensemble === "symphonic_orchestra") && (
            <div className="field">
              <label>Orchestra intensity</label>
              <select
                value={settings.orchestraIntensity ?? "build"}
                onChange={(e) => update("orchestraIntensity", e.target.value as "build" | "tutti")}
              >
                <option value="build">Build (light intro → climaxes)</option>
                <option value="tutti">Tutti (full ensemble throughout)</option>
              </select>
              <div className="key-preview">
                <span className="slider-help">
                  Build: strings cushion throughout; horn, trumpets, then the 3rd trumpet, woodwind descant
                  and low brass enter and grow toward the final chorus — like a real worship chart. Tutti: everyone plays the whole time.
                </span>
              </div>
            </div>
          )}

          {/* Orchestra — family balance bias (worship + symphonic) */}
          {(settings.ensemble === "orchestra" || settings.ensemble === "piano_orchestra" || settings.ensemble === "satb_orchestra" ||
            settings.ensemble === "symphonic_orchestra") && (
            <div className="field">
              <label>Family balance</label>
              <select
                value={settings.orchestraBalance ?? "default"}
                onChange={(e) => update("orchestraBalance", e.target.value as "default" | "more_strings" | "more_winds" | "more_brass")}
              >
                <option value="default">Default (pro: Brass 48 · Strings 36 · Winds 16)</option>
                <option value="more_strings">More strings</option>
                <option value="more_winds">More winds</option>
                <option value="more_brass">More brass</option>
              </select>
              <div className="key-preview">
                <span className="slider-help">
                  The engine default matches professional worship charts. Bias it for this arrangement —
                  favouring a family makes it play more of the time (a bigger share of the texture).
                </span>
              </div>
            </div>
          )}

          {/* Orchestra — ADVANCED: per-instrument measure ranges (worship + symphonic) */}
          {(settings.ensemble === "orchestra" || settings.ensemble === "piano_orchestra" || settings.ensemble === "satb_orchestra" ||
            settings.ensemble === "symphonic_orchestra") &&
            (() => {
              const WORSHIP_ROSTER: Array<{ id: string; name: string }> = [
                { id: "P_FLOB", name: "Flute/Oboe" }, { id: "P_CL", name: "Clarinet" }, { id: "P_BSN", name: "Bassoon" },
                { id: "P_HN12", name: "Horn 1-2" }, { id: "P_TPT1", name: "Trumpet 1" }, { id: "P_TPT23", name: "Trumpet 2-3" },
                { id: "P_TBN12", name: "Trombone 1-2" }, { id: "P_LOWBR", name: "Trombone 3/Tuba" },
                { id: "P_TIMP", name: "Timpani" }, { id: "P_PERC", name: "Percussion" },
                { id: "P_VLN1", name: "Violin 1" }, { id: "P_VLN2", name: "Violin 2" }, { id: "P_VLA", name: "Viola" }, { id: "P_CELBS", name: "Cello-Bass" },
              ];
              const ROSTER: Array<{ id: string; name: string }> =
                settings.ensemble === "symphonic_orchestra"
                  ? symphonicRosterFor(settings.symphonicPeriod)
                  : WORSHIP_ROSTER;
              const rangesFor = (id: string): string => {
                const e = (settings.orchestraPartRanges ?? []).find((r) => r.part === id);
                return e ? e.ranges.map(([a, b]) => `${a}-${b}`).join(", ") : "";
              };
              const setRanges = (id: string, text: string) => {
                const ranges = text.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
                  const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
                  return m ? [Number(m[1]), Number(m[2])] as [number, number] : null;
                }).filter((x): x is [number, number] => !!x);
                const others = (settings.orchestraPartRanges ?? []).filter((r) => r.part !== id);
                update("orchestraPartRanges", (ranges.length ? [...others, { part: id, ranges }] : others) as any);
              };
              const count = (settings.orchestraPartRanges ?? []).length;
              return (
                <details className="field" style={{ border: "1px solid var(--border, #ccc)", borderRadius: 6, padding: 8 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                    Advanced — per-instrument measure ranges{count ? ` (${count} set)` : ""}
                  </summary>
                  <div className="key-preview" style={{ margin: "6px 0" }}>
                    <span className="slider-help">
                      Type the measures each instrument should play, e.g. <code>17-32, 49-64</code>. A part with
                      ranges plays ONLY there (overrides the automatic build). Leave blank for automatic.
                    </span>
                  </div>
                  {ROSTER.map((r) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <label style={{ width: 120, fontWeight: 400, fontSize: 13 }}>{r.name}</label>
                      <input type="text" placeholder="auto" defaultValue={rangesFor(r.id)}
                        onBlur={(e) => setRanges(r.id, e.target.value)}
                        style={{ flex: 1, fontSize: 13 }} />
                    </div>
                  ))}
                </details>
              );
            })()}

          {/* Orchestra — custom ensemble part picker (worship + symphonic) */}
          {(settings.ensemble === "orchestra" || settings.ensemble === "piano_orchestra" || settings.ensemble === "satb_orchestra" ||
            settings.ensemble === "symphonic_orchestra") &&
            (() => {
              const isSym = settings.ensemble === "symphonic_orchestra";
              const WORSHIP_ROSTER: Array<{ id: string; name: string; section: string }> = [
                { id: "P_FLOB", name: "Flute/Oboe", section: "Woodwinds" },
                { id: "P_CL", name: "Clarinet", section: "Woodwinds" },
                { id: "P_BSN", name: "Bassoon", section: "Woodwinds" },
                { id: "P_HN12", name: "Horn 1-2", section: "Brass" },
                { id: "P_TPT1", name: "Trumpet 1", section: "Brass" },
                { id: "P_TPT23", name: "Trumpet 2-3 (Alto Sax)", section: "Brass" },
                { id: "P_TBN12", name: "Trombone 1-2 (Tenor Sax)", section: "Brass" },
                { id: "P_LOWBR", name: "Trombone 3/Tuba (Bari Sax)", section: "Brass" },
                { id: "P_TIMP", name: "Timpani", section: "Percussion" },
                { id: "P_PERC", name: "Percussion (Crash/Triangle)", section: "Percussion" },
                { id: "P_VLN1", name: "Violin 1", section: "Strings" },
                { id: "P_VLN2", name: "Violin 2", section: "Strings" },
                { id: "P_VLA", name: "Viola", section: "Strings" },
                { id: "P_CELBS", name: "Cello-Bass", section: "Strings" },
              ];
              const ROSTER: Array<{ id: string; name: string; section: string }> =
                isSym ? symphonicRosterFor(settings.symphonicPeriod) : WORSHIP_ROSTER;
              const allIds = ROSTER.map((r) => r.id);
              // Only honour a saved selection that belongs to THIS roster — switching
              // ensembles leaves the other engine's part ids behind.
              const savedSel = (settings.orchestraParts ?? []).filter((id) => allIds.includes(id));
              const sel = savedSel.length ? savedSel : allIds;
              const setSel = (ids: string[]) =>
                update("orchestraParts", (ids.length >= allIds.length ? undefined : ids) as any);
              const toggle = (id: string) =>
                setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
              const PRESETS: Array<{ label: string; ids: string[] }> = isSym
                ? [
                    { label: "Full", ids: allIds },
                    { label: "Strings only", ids: ["SY_VLN1", "SY_VLN2", "SY_VLA", "SY_VC", "SY_CB"] },
                    { label: "Chamber (winds + strings)", ids: ["SY_FL", "SY_OB", "SY_CL", "SY_BSN", "SY_VLN1", "SY_VLN2", "SY_VLA", "SY_VC", "SY_CB"] },
                    { label: "Classical core", ids: ["SY_FL", "SY_OB", "SY_CL", "SY_BSN", "SY_HN12", "SY_TPT", "SY_TIMP", "SY_VLN1", "SY_VLN2", "SY_VLA", "SY_VC", "SY_CB"] },
                  ].map((p) => ({ ...p, ids: p.ids.filter((id) => allIds.includes(id)) }))
                : [
                    { label: "Full", ids: allIds },
                    { label: "Strings only", ids: ["P_VLN1", "P_VLN2", "P_VLA", "P_CELBS"] },
                    { label: "Brass + rhythm", ids: ["P_HN12", "P_TPT1", "P_TPT23", "P_TBN12", "P_LOWBR", "P_TIMP", "P_PERC"] },
                    { label: "Winds + strings", ids: ["P_FLOB", "P_CL", "P_BSN", "P_VLN1", "P_VLN2", "P_VLA", "P_CELBS"] },
                  ];
              const sections = ["Woodwinds", "Brass", "Percussion", "Strings"];
              return (
                <div className="field">
                  <label>Custom ensemble ({sel.length}/{allIds.length} parts)</label>
                  <div className="key-preview" style={{ marginBottom: 6 }}>
                    <span className="slider-help">
                      Pick the instruments you have players for. The engine still builds the full harmony,
                      so even a small ensemble gets correct parts.
                      {isSym
                        ? " Strings carry the music here, so keep at least Violin I and a bass line."
                        : " Swap any part to its sax substitute with the re-instrument tool."}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {PRESETS.map((p) => (
                      <button key={p.label} type="button" className="ghost" style={{ fontSize: 12, padding: "2px 8px" }}
                        onClick={() => setSel(p.ids)}>{p.label}</button>
                    ))}
                  </div>
                  {sections.map((sec) => (
                    <div key={sec} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, marginBottom: 2 }}>{sec}</div>
                      {ROSTER.filter((r) => r.section === sec).map((r) => (
                        <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 400, fontSize: 13 }}>
                          <input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)}
                            style={{ width: 14, height: 14, cursor: "pointer" }} />
                          {r.name}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}

          {/* Piano→Brass quintet (copy): Horn toggle + Tuba entry only (faithful copy, no restyle) */}
          {settings.ensemble === "piano_brass_quartet" && (
            <>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input type="checkbox" checked={settings.brassQuintet !== false}
                    onChange={(e) => update("brassQuintet", e.target.checked)}
                    style={{ width: "16px", height: "16px", cursor: "pointer" }} />
                  Brass quintet (include Horn in F)
                </label>
                <div className="key-preview"><span className="slider-help">Quintet = RH chord across Tpt 1 / Tpt 2 / Horn, LH across Trombone / Tuba. Unchecked = quartet (no Horn).</span></div>
              </div>
              <div className="field">
                <label>Tuba enters at measure</label>
                <input
                  type="number"
                  min={0}
                  placeholder="auto"
                  value={settings.bassoonEntryMeasure ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    update("bassoonEntryMeasure", v === "" ? undefined : Math.max(0, Number(v)) as any);
                  }}
                />
                <div className="key-preview">
                  <span className="slider-help">
                    Tuba rests before this measure (the soft intro). Blank = auto-detect the thin intro; 0 = play from the start.
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Brass ensemble (auto) + Piano+brass (complement) controls */}
          {(settings.ensemble === "brass_ensemble" || settings.ensemble === "piano_with_brass") && (() => {
            const BRASS_TEX = [
              { value: "melody_harmony", label: "Melody + Harmony", help: "Trumpet 1 leads; Horn/Trombone/Tuba accompany." },
              { value: "chamber",        label: "Chamber (balanced)", help: "All five voices equally active — pop/jazz quintet, walking tuba (calibrated)." },
              { value: "chorale",        label: "Chorale (block)",  help: "Hymn-style block voicing — the core brass-choir sound." },
              { value: "fanfare",        label: "Fanfare",          help: "Bright ceremonial brass — active trumpets/horns, grounded tuba." },
              { value: "contrapuntal",   label: "Counterpoint",     help: "Independent imitative lines (Gabrieli/fugal)." },
            ];
            const BRASS_EX = [
              { value: "", label: "— None —" },
              { value: "popjazz_quintet",  label: "Pop / Jazz brass quintet",        texture: "chamber" },
              { value: "gabrieli_canzona", label: "Gabrieli — Canzona (antiphonal)", texture: "contrapuntal" },
              { value: "brass_chorale",    label: "Brass chorale (hymn)",            texture: "chorale" },
              { value: "fanfare",          label: "Ceremonial fanfare",              texture: "fanfare" },
              { value: "sousa_brass",      label: "Sousa — March brass",             texture: "melody_harmony" },
            ];
            const tex = settings.brassTexture ?? "melody_harmony";
            const texHelp = BRASS_TEX.find(t => t.value === tex)?.help ?? "";
            return (
              <>
                <div className="field">
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input type="checkbox" checked={settings.brassQuintet !== false}
                      onChange={(e) => update("brassQuintet", e.target.checked)}
                      style={{ width: "16px", height: "16px", cursor: "pointer" }} />
                    Brass quintet (include Horn in F)
                  </label>
                  <div className="key-preview"><span className="slider-help">Quintet = Tpt 1, Tpt 2, Horn, Trombone, Tuba. Unchecked = quartet (no Horn).</span></div>
                </div>
                <div className="field">
                  <label>Brass Texture</label>
                  <select value={tex} onChange={(e) => {
                    const t = e.target.value as NonNullable<Settings["brassTexture"]>;
                    const next: Partial<Settings> = { brassTexture: t };
                    if (t === "contrapuntal") { next.textureMode = "polyphony"; next.accompaniment = "polyphonic"; }
                    else if (settings.accompaniment === "polyphonic") { next.textureMode = "homophony_homorhythmic"; next.accompaniment = "homophonic"; }
                    onChange({ ...settings, ...next });
                  }}>
                    {BRASS_TEX.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <div className="key-preview"><span className="slider-help">{texHelp}</span></div>
                </div>
                <div className="field">
                  <label>Example</label>
                  <select value={settings.brassExample ?? ""} onChange={(e) => {
                    const ex = e.target.value;
                    const next: Partial<Settings> = { brassExample: ex || undefined };
                    const t = BRASS_EX.find(o => o.value === ex)?.texture;
                    if (t) next.brassTexture = t as Settings["brassTexture"];
                    onChange({ ...settings, ...next });
                  }}>
                    {BRASS_EX.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </>
            );
          })()}

          <div className="field">
            <label>Key Signature</label>
            <select value={settings.keySignature} onChange={(e) => update("keySignature", e.target.value)}>
              <option value="original">Original (from file)</option>
              <optgroup label="Major">
                {KEY_OPTIONS_MAJOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
              <optgroup label="Minor">
                {KEY_OPTIONS_MINOR.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            </select>
            <div className="key-preview">
              Selected: <span className="key-badge">{keyPreview}</span>
            </div>
          </div>

          <div className="field">
            <label>Time Signature</label>
            <select
              value={settings.timeSignature}
              onChange={(e) => update("timeSignature", e.target.value)}
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Tempo (BPM)</label>
            <input
              type="number"
              min={30}
              max={240}
              value={settings.tempo}
              onChange={(e) => update("tempo", Number(e.target.value))}
            />
          </div>

          <div className="field">
            <label>Style</label>
            <select
              value={["baroque", "classical", "romantic", "modern"].includes(settings.style) ? settings.style : "classical"}
              onChange={(e) => {
                const s = e.target.value as Settings["style"];
                const next: Partial<Settings> = { style: s };
                if (s === "baroque")       { next.styleProfile = "baroque";   next.ruleStrictness = "strict"; }
                else if (s === "romantic") { next.styleProfile = "romantic";  next.ruleStrictness = "relaxed"; }
                else if (s === "modern")   { next.styleProfile = "modern";    next.ruleStrictness = "relaxed"; if (!settings.modernMode) next.modernMode = "modernTonal"; }
                else                       { next.styleProfile = "classical"; next.ruleStrictness = "standard"; }
                onChange({ ...settings, ...next });
              }}
            >
              {PERIOD_STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <div className="key-preview">
              <span className="slider-help">
                {PERIOD_STYLE_OPTIONS.find((o) => o.value === settings.style)?.help ?? ""}
              </span>
            </div>
          </div>

          {settings.style === "modern" && (
            <div className="field">
              <label>Modern Sub-mode</label>
              <select
                value={settings.modernMode ?? "modernTonal"}
                onChange={(e) => update("modernMode", e.target.value as Settings["modernMode"])}
              >
                {MODERN_MODES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="key-preview">
                <span className="slider-help">
                  {MODERN_MODES.find((o) => o.value === (settings.modernMode ?? "modernTonal"))?.help ?? ""}
                </span>
              </div>
            </div>
          )}

          <div className="field">
            <label>Level</label>
            <select value={settings.level} onChange={(e) => updateLevel(e.target.value as Settings["level"])}>
              {LEVEL_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {titleize(opt)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Accompaniment Type</label>
            <select
              value={settings.accompaniment}
              onChange={(e) => update("accompaniment", e.target.value as Settings["accompaniment"])}
            >
              {accompanimentOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {titleize(opt)}
                </option>
              ))}
            </select>
            <div className="key-preview">
              Selected: <span className="key-badge">{titleize(settings.accompaniment)}</span>
              <span className="slider-help">{accompanimentHelp}</span>
            </div>
          </div>

          <div className="field">
            <label>Texture Mode</label>
            <select
              value={settings.textureMode}
              onChange={(e) => {
                const mode = e.target.value as Settings["textureMode"];
                // Sync accompaniment so the server's usePolyphonic / useHomophonic
                // flags are never both true at once (which routes strings through the
                // block-chord DP arranger instead of the polyphonic counterpoint engine).
                const next: Partial<Settings> = { textureMode: mode };
                if (mode === "polyphony") next.accompaniment = "polyphonic";
                else if (settings.accompaniment === "polyphonic") next.accompaniment = "homophonic";
                onChange({ ...settings, ...next });
              }}
            >
              {TEXTURE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="key-preview">
              Selected: <span className="key-badge">{titleize(settings.textureMode)}</span>
              <span className="slider-help">{textureHelp}</span>
            </div>
          </div>

          {showPolyphonicControls && (
            <div className="field">
              <label>Polyphonic Profile</label>
              <select
                value={settings.styleProfile ?? "classical"}
                onChange={(e) => update("styleProfile", e.target.value as Settings["styleProfile"])}
              >
                {POLYPHONIC_PROFILES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected: <span className="key-badge">{titleize(settings.styleProfile ?? "classical")}</span>
                <span className="slider-help">{profileHelp}</span>
              </div>
            </div>
          )}

          {showPolyphonicControls && settings.styleProfile === "modern" && (
            <div className="field">
              <label>Modern Mode</label>
              <select
                value={settings.modernMode ?? "modernTonal"}
                onChange={(e) => update("modernMode", e.target.value as Settings["modernMode"])}
              >
                {MODERN_MODES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected: <span className="key-badge">{titleize(settings.modernMode ?? "modernTonal")}</span>
                <span className="slider-help">{modernHelp}</span>
              </div>
            </div>
          )}

          {/* ── String polyphony: per-voice activity ─────────────────────────── */}
          {showStringPolyphonic && (
            <>
              {[
                { label: "Violin I activity", key: "vln1Activity" as keyof Settings, def: "grounded",    help: vln1ActivityHelp },
                { label: "Violin II activity", key: "vln2Activity" as keyof Settings, def: "active",     help: vln2ActivityHelp },
                { label: "Viola activity",     key: "vlaActivity"  as keyof Settings, def: "active",     help: vlaActivityHelp  },
                { label: "Cello activity",     key: "vcActivity"   as keyof Settings, def: "less_active", help: vcActivityHelp  },
                { label: "Double Bass activity", key: "cbActivity" as keyof Settings, def: "grounded",   help: cbActivityHelp  },
              ].map(({ label, key, def, help }) => (
                <div className="field" key={String(key)}>
                  <label>{label}</label>
                  <select
                    value={(settings[key] as string) ?? def}
                    onChange={(e) => update(key, e.target.value as any)}
                  >
                    {STRING_ACTIVITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="key-preview">
                    Selected: <span className="key-badge">{titleize((settings[key] as string) ?? def)}</span>
                    <span className="slider-help">{help}</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {showPolyphonicControls && !showWoodwindPolyphonic && !showStringPolyphonic && (
            <div className="field">
              <label>Polyphonic Activity (Bass)</label>
              <select
                value={settings.bassActivity ?? "grounded"}
                onChange={(e) => update("bassActivity", e.target.value as Settings["bassActivity"])}
              >
                {BASS_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected: <span className="key-badge">{titleize(settings.bassActivity ?? "grounded")}</span>
                <span className="slider-help">{bassActivityHelp}</span>
              </div>
            </div>
          )}

          {showGenericPolyphonicVoices && (
            <div className="field">
              <label>Polyphonic Activity (Tenor)</label>
              <select
                value={settings.tenorActivity ?? settings.bassActivity ?? "less_active"}
                onChange={(e) => update("tenorActivity", e.target.value as Settings["bassActivity"])}
              >
                {BASS_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected:{" "}
                <span className="key-badge">
                  {titleize(settings.tenorActivity ?? settings.bassActivity ?? "less_active")}
                </span>
                <span className="slider-help">{tenorActivityHelp}</span>
              </div>
            </div>
          )}

          {showGenericPolyphonicVoices && (
            <div className="field">
              <label>Polyphonic Activity (Alto)</label>
              <select
                value={settings.altoActivity ?? settings.bassActivity ?? "less_active"}
                onChange={(e) => update("altoActivity", e.target.value as Settings["bassActivity"])}
              >
                {BASS_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected:{" "}
                <span className="key-badge">
                  {titleize(settings.altoActivity ?? settings.bassActivity ?? "less_active")}
                </span>
                <span className="slider-help">{altoActivityHelp}</span>
              </div>
            </div>
          )}

          {showWoodwindPolyphonic && (
            <div className="field">
              <label>Woodwind Polyphonic Activity (Bassoon)</label>
              <select
                value={settings.bassActivity ?? "less_active"}
                onChange={(e) => update("bassActivity", e.target.value as Settings["bassActivity"])}
              >
                {BASS_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected: <span className="key-badge">{titleize(settings.bassActivity ?? "less_active")}</span>
                <span className="slider-help">{bassActivityHelp}</span>
              </div>
            </div>
          )}

          {showWoodwindPolyphonic && (
            <div className="field">
              <label>Woodwind Polyphonic Activity (Clarinet)</label>
              <select
                value={settings.tenorActivity ?? settings.bassActivity ?? "less_active"}
                onChange={(e) => update("tenorActivity", e.target.value as Settings["bassActivity"])}
              >
                {BASS_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected:{" "}
                <span className="key-badge">
                  {titleize(settings.tenorActivity ?? settings.bassActivity ?? "less_active")}
                </span>
                <span className="slider-help">{tenorActivityHelp}</span>
              </div>
            </div>
          )}

          {showWoodwindPolyphonic && (
            <div className="field">
              <label>Woodwind Polyphonic Activity (Oboe)</label>
              <select
                value={settings.altoActivity ?? settings.bassActivity ?? "less_active"}
                onChange={(e) => update("altoActivity", e.target.value as Settings["bassActivity"])}
              >
                {BASS_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected:{" "}
                <span className="key-badge">
                  {titleize(settings.altoActivity ?? settings.bassActivity ?? "less_active")}
                </span>
                <span className="slider-help">{altoActivityHelp}</span>
              </div>
            </div>
          )}

          {showWoodwindPolyphonic && (
            <div className="field">
              <label>Woodwind Polyphonic Activity (Flute)</label>
              <select
                value={settings.sopranoActivity ?? "less_active"}
                onChange={(e) => update("sopranoActivity", e.target.value as Settings["bassActivity"])}
              >
                {BASS_ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="key-preview">
                Selected:{" "}
                <span className="key-badge">{titleize(settings.sopranoActivity ?? "less_active")}</span>
                <span className="slider-help">{sopranoActivityHelp}</span>
              </div>
            </div>
          )}

          {showPolyphonicControls && (
            <div className="field">
              <label>Randomize Activity Offsets</label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={settings.randomizeOffsets !== false}
                  onChange={(e) => update("randomizeOffsets", e.target.checked)}
                />
                <span>{settings.randomizeOffsets === false ? "Off" : "On"}</span>
              </label>
              <div className="key-preview">
                <span className="slider-help">{offsetsHelp}</span>
              </div>
            </div>
          )}

          <div className="field">
            <label>Rule Strictness</label>
            <input
              className="range-input"
              type="range"
              min={0}
              max={STRICTNESS_OPTIONS.length - 1}
              step={1}
              value={Math.max(0, STRICTNESS_OPTIONS.findIndex((opt) => opt.value === settings.ruleStrictness))}
              onChange={(e) => {
                const idx = Number(e.target.value);
                const next = STRICTNESS_OPTIONS[idx] ?? STRICTNESS_OPTIONS[1]!;
                update("ruleStrictness", next.value);
              }}
            />
            <div className="slider-labels">
              {STRICTNESS_OPTIONS.map((opt) => (
                <span key={opt.value} className={opt.value === settings.ruleStrictness ? "active" : ""}>
                  {opt.label}
                </span>
              ))}
            </div>
            <div className="key-preview">
              Selected:{" "}
              <span className="key-badge">
                {STRICTNESS_OPTIONS.find((opt) => opt.value === settings.ruleStrictness)?.label ?? "Standard"}
              </span>
              <span className="slider-help">
                {STRICTNESS_OPTIONS.find((opt) => opt.value === settings.ruleStrictness)?.help ?? ""}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
