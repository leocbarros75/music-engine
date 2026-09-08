/** General MIDI and soundfont identities share one ordered lookup. */
const instruments: Array<[
    string[],
    number,
    string
]> = [
    [['piccolo'], 72, 'piccolo'], [['contrabass', 'double_bass', 'double bass'], 43, 'contrabass'],
    [['bassoon'], 70, 'bassoon'], [['clarinet'], 71, 'clarinet'], [['english horn', 'cor anglais'], 69, 'english_horn'],
    [['soprano', 'alto', 'tenor', 'choir', 'voice', 'vocal'], 52, 'choir_aahs'],
    [['violin'], 40, 'violin'], [['viola'], 41, 'viola'], [['cello', 'violoncello'], 42, 'cello'],
    [['flute'], 73, 'flute'], [['oboe'], 68, 'oboe'], [['trumpet', 'cornet'], 56, 'trumpet'],
    [['horn'], 60, 'french_horn'], [['trombone'], 57, 'trombone'], [['tuba'], 58, 'tuba'],
    [['harpsichord'], 6, 'harpsichord'], [['celesta'], 8, 'celesta'], [['organ'], 19, 'church_organ'],
    [['harp'], 46, 'orchestral_harp'], [['timpani'], 47, 'timpani'], [['glockenspiel'], 9, 'glockenspiel'],
    [['xylophone'], 13, 'xylophone'], [['marimba'], 12, 'marimba'], [['bass'], 52, 'choir_aahs'],
];
export function instrumentPlayback(part: {
    instrument?: string;
    name?: string;
}) {
    const key = `${part.instrument ?? ''} ${part.name ?? ''}`.toLowerCase();
    const found = instruments.find(([names]) => names.some(n => key.includes(n)));
    return { program: found?.[1] ?? 0, soundfont: found?.[2] ?? 'acoustic_grand_piano' };
}
