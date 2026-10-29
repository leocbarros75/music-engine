/** General MIDI and soundfont identities share one ordered lookup. */

/**
 * ORDER IS THE RULE HERE: `find` takes the first entry whose name appears
 * anywhere in "<instrument> <name>", so a broad word placed early swallows
 * every specific instrument that contains it.
 *
 * That is not hypothetical. The SATB voice entry used to sit sixth, and
 * "Alto Sax" contains "alto" — so on the jazz band route FOUR saxophones and
 * the bass played back as a choir, the baritone, guitar and drums fell through
 * to the piano fallback, and seven of seventeen parts sounded wrong. "Tenor
 * Trombone" would have done the same thing. So every specific instrument is
 * listed BEFORE the bare voice words, and the voice words come last.
 */
const instruments: Array<[
    /** matched against "<instrument> <name>", lowercased */
    string[],
    /** General MIDI program */
    number,
    /** soundfont-player instrument name */
    string,
    /** true for a kit that belongs on the GM percussion channel */
    boolean?
]> = [
    // ── Saxophones. Must precede the voice entry: their ids and names contain
    // "soprano", "alto", "tenor" and "baritone".
    [['soprano_sax', 'soprano sax'], 64, 'soprano_sax'],
    [['alto_sax', 'alto sax'], 65, 'alto_sax'],
    [['tenor_sax', 'tenor sax'], 66, 'tenor_sax'],
    [['baritone_sax', 'baritone sax', 'bari sax'], 67, 'baritone_sax'],

    // ── Woodwind and brass. "bassoon", "contrabass", "double bass" and
    // "bass trombone" all contain "bass", so they stay ahead of the bare word.
    [['piccolo'], 72, 'piccolo'], [['contrabass', 'double_bass', 'double bass'], 43, 'contrabass'],
    [['bassoon'], 70, 'bassoon'], [['clarinet'], 71, 'clarinet'], [['english horn', 'cor anglais'], 69, 'english_horn'],
    [['violin'], 40, 'violin'], [['viola'], 41, 'viola'], [['cello', 'violoncello'], 42, 'cello'],
    [['flute'], 73, 'flute'], [['oboe'], 68, 'oboe'], [['trumpet', 'cornet'], 56, 'trumpet'],
    [['horn'], 60, 'french_horn'], [['trombone'], 57, 'trombone'], [['tuba'], 58, 'tuba'],

    // ── Rhythm section. None of these had an entry at all: the piano reached
    // the right sound only because it is also the fallback, and the guitar and
    // drums did not.
    [['guitar'], 26, 'electric_guitar_jazz'],
    [['piano'], 0, 'acoustic_grand_piano'],
    // A drum kit is not a pitched instrument. soundfont-player serves General
    // MIDI PROGRAMS, and a GM kit is a channel rather than a program, so there
    // is no kit to load — synth_drum is the nearest thing the set offers and
    // renders the kit's notes as pitched percussion. The MIDI export has no
    // such limit: the percussion flag puts that part on channel 9, where the
    // drum numbers mean what they say.
    [['drum', 'percussion'], 118, 'synth_drum', true],

    [['harpsichord'], 6, 'harpsichord'], [['celesta'], 8, 'celesta'], [['organ'], 19, 'church_organ'],
    [['harp'], 46, 'orchestral_harp'], [['timpani'], 47, 'timpani'], [['glockenspiel'], 9, 'glockenspiel'],
    [['xylophone'], 13, 'xylophone'], [['marimba'], 12, 'marimba'],

    // ── A rhythm-section bass, before the bare "bass" that means a voice.
    [['acoustic_bass', 'upright bass', 'electric_bass', 'bass guitar'], 32, 'acoustic_bass'],

    // ── Voices last, so no instrument whose name contains one of these words
    // can be captured by them. A choral part is named exactly "Soprano",
    // "Alto", "Tenor" or "Bass" and reaches this entry unopposed.
    [['soprano', 'alto', 'tenor', 'choir', 'voice', 'vocal'], 52, 'choir_aahs'],
    [['bass'], 52, 'choir_aahs'],
];
export function instrumentPlayback(part: {
    instrument?: string;
    name?: string;
}) {
    const key = `${part.instrument ?? ''} ${part.name ?? ''}`.toLowerCase();
    const found = instruments.find(([names]) => names.some(n => key.includes(n)));
    return {
        program: found?.[1] ?? 0,
        soundfont: found?.[2] ?? 'acoustic_grand_piano',
        percussion: found?.[3] === true,
    };
}
