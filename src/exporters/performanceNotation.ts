import { pitchToMidi } from "../score/standard";
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { toSoundingScore, transposeWrittenPitch } from '../score/pitch';
const children = (n: any, tag?: string): any[] => Array.from(n.childNodes ?? []).filter((x: any) => x.nodeType === 1 && (!tag || x.localName === tag));
const all = (n: any, tag: string): any[] => Array.from(n.getElementsByTagNameNS('*', tag));
const value = (n: any, tag: string, fallback = '0') => all(n, tag)[0]?.textContent ?? fallback;
/** Serialize shared performance metadata after the notation renderer lays out voices. */
export function writePerformanceNotation(xml: string, input: any): string {
    const score = toSoundingScore(input);
    const hasInitialTempo = score.parts.some((p: any) => p.measures?.[0]?.performance?.tempos?.some((t: any) => t.t === 0));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const make = (tag: string, content?: any) => { const e = doc.createElement(tag); if (content !== undefined)
        e.textContent = String(content); return e; };
    for (const part of children(doc.documentElement, 'part')) {
        const source = score.parts.find((p: any) => p.part_id === part.getAttribute('id'));
        if (!source)
            continue;
        const tr = all(part, 'transpose')[0];
        const inverse = { diatonic: -Number(tr ? value(tr, 'diatonic') : 0), chromatic: -Number(tr ? value(tr, 'chromatic') : 0), octaveChange: -Number(tr ? value(tr, 'octave-change') : 0) };
        let divisions = 1;
        children(part, 'measure').forEach((bar, i) => {
            const original = source.measures[i];
            if (!original)
                return;
            if (all(bar, 'divisions').length)
                divisions = Number(value(bar, 'divisions'));
            const attrs = children(bar, 'attributes')[0], anchor = attrs ? attrs.nextSibling : bar.firstChild;
            const marks = { ...(original.performance ?? {}) };
            if (!hasInitialTempo && i === 0 && part === children(doc.documentElement, 'part')[0] && score.meta?.tempo_bpm !== undefined) {
                marks.tempos = [{ t: 0, bpm: score.meta.tempo_bpm }, ...(marks.tempos ?? [])];
            }
            const direction = (t: number, type: any, sound?: any) => {
                const d = make('direction'), dt = make('direction-type');
                dt.appendChild(type);
                d.appendChild(dt);
                if (t)
                    d.appendChild(make('offset', t * divisions));
                if (sound)
                    d.appendChild(sound);
                bar.insertBefore(d, anchor);
            };
            for (const t of marks.tempos ?? []) {
                const met = make('metronome');
                met.appendChild(make('beat-unit', 'quarter'));
                met.appendChild(make('per-minute', t.bpm));
                const sound = make('sound');
                sound.setAttribute('tempo', String(t.bpm));
                direction(t.t, met, sound);
            }
            for (const d of marks.dynamics ?? []) {
                const dyn = make('dynamics');
                const labels = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'], levels = [32, 44, 56, 68, 80, 96, 112, 124];
                const nearest = levels.reduce((best, n, j) => Math.abs(n - d.velocity) < Math.abs(levels[best] - d.velocity) ? j : best, 0);
                dyn.appendChild(make(labels[nearest]));
                const sound = make('sound');
                sound.setAttribute('dynamics', String(d.velocity * 100 / 127));
                direction(d.t, dyn, sound);
            }
            const barline = (location: string) => { let b = children(bar, 'barline').find(x => x.getAttribute('location') === location); if (!b) {
                b = make('barline');
                b.setAttribute('location', location);
                bar.appendChild(b);
            } return b; };
            if (marks.repeatStart) {
                const r = make('repeat');
                r.setAttribute('direction', 'forward');
                barline('left').appendChild(r);
            }
            for (const ending of marks.endings ?? []) {
                const e = make('ending');
                e.setAttribute('number', ending.numbers.join(','));
                e.setAttribute('type', ending.type);
                barline(ending.type === 'start' ? 'left' : 'right').appendChild(e);
            }
            if (marks.repeatEnd) {
                const r = make('repeat');
                r.setAttribute('direction', 'backward');
                r.setAttribute('times', String(marks.repeatEnd));
                barline('right').appendChild(r);
            }
            // Match actual rendered onsets, including backups; do not assume one voice per part.
            let cursor = 0, last = 0;
            const matched = new Set<any>();
            for (const n of children(bar)) {
                if (n.localName === 'backup')
                    cursor -= Number(value(n, 'duration')) / divisions;
                if (n.localName === 'forward')
                    cursor += Number(value(n, 'duration')) / divisions;
                if (n.localName !== 'note')
                    continue;
                const at = all(n, 'chord').length ? last : cursor;
                if (!all(n, 'chord').length) {
                    last = cursor;
                    cursor += Number(value(n, 'duration')) / divisions;
                }
                const voice = Number(value(n, 'voice', '1')), staff = Number(value(n, 'staff', '1'));
                const candidates = original.events.filter((e: any) => Math.abs(e.t - at) < 1e-7 && (e.voice ?? 1) === voice && (e.staff ?? 1) === staff);
                for (const grace of candidates.filter((e: any) => e.grace && !matched.has(e))) {
                    const pitch = transposeWrittenPitch(grace.pitch, inverse), gn = make('note'), pn = make('pitch');
                    gn.appendChild(make('grace'));
                    if (grace.chord)
                        gn.appendChild(make('chord'));
                    pn.appendChild(make('step', pitch.step));
                    if (pitch.alter)
                        pn.appendChild(make('alter', pitch.alter));
                    pn.appendChild(make('octave', pitch.octave));
                    gn.appendChild(pn);
                    gn.appendChild(make('voice', voice));
                    gn.appendChild(make('type', 'eighth'));
                    gn.appendChild(make('staff', staff));
                    bar.insertBefore(gn, n);
                    matched.add(grace);
                }
                if (all(n, 'rest').length)
                    continue;
                const pitch = all(n, 'pitch')[0];
                const sourceNote = candidates.find((e: any) => !e.grace && e.type === 'note' && (() => { const p = transposeWrittenPitch(e.pitch, inverse); return pitchToMidi(p) === pitchToMidi({ step: value(pitch, 'step'), octave: Number(value(pitch, 'octave')), alter: Number(value(pitch, 'alter')) }); })());
                if (sourceNote?.articulations?.length) {
                    let notations = all(n, 'notations')[0];
                    if (!notations) {
                        notations = make('notations');
                        n.appendChild(notations);
                    }
                    const a = make('articulations');
                    for (const name of sourceNote.articulations)
                        if (['staccato', 'staccatissimo', 'tenuto', 'accent', 'strong-accent'].includes(name))
                            a.appendChild(make(name));
                    if (a.childNodes.length)
                        notations.appendChild(a);
                }
            }
            if (original.events.some((e: any) => e.grace && !matched.has(e)))
                throw Error(`Cannot serialize grace notes without a principal note in measure ${original.number}.`);
        });
    }
    return new XMLSerializer().serializeToString(doc);
}
