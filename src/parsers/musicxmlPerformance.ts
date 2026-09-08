import type { MeasurePerformance } from '../score/performance';
const children = (n: any, tag?: string): any[] => Array.from(n.childNodes ?? []).filter((x: any) => x.nodeType === 1 && (!tag || x.localName === tag));
const all = (n: any, tag: string): any[] => Array.from(n.getElementsByTagNameNS('*', tag));
const text = (n: any, tag: string, fallback = '') => all(n, tag)[0]?.textContent ?? fallback;
const DYNAMICS: Record<string, number> = { ppp: 32, pp: 44, p: 56, mp: 68, mf: 80, f: 96, ff: 112, fff: 124, sfz: 112, fp: 68 };
/** Retain performance instructions from MusicXML; notation remains the source of truth. */
export function readMeasurePerformance(measure: any, initialDivisions: number): MeasurePerformance {
    const result: MeasurePerformance = {}, tempos: Array<{
        t: number;
        bpm: number;
    }> = [], dynamics: Array<{
        t: number;
        velocity: number;
    }> = [], issues: string[] = [];
    let t = 0, divisions = initialDivisions;
    for (const e of children(measure)) {
        const tag = e.localName;
        if (tag === 'attributes' && all(e, 'divisions').length)
            divisions = Number(text(e, 'divisions'));
        if (tag === 'backup')
            t -= Number(text(e, 'duration')) / divisions;
        if (tag === 'forward')
            t += Number(text(e, 'duration')) / divisions;
        if (tag === 'note' && all(e, 'unpitched').length)
            issues.push('Unpitched percussion needs an explicit MIDI drum mapping.');
        if (tag === 'note' && !all(e, 'chord').length && !all(e, 'grace').length)
            t += Number(text(e, 'duration', '0')) / divisions;
        if (tag === 'direction' || tag === 'sound') {
            const at = t + Number(text(e, 'offset', '0')) / divisions;
            const sound = tag === 'sound' ? e : all(e, 'sound')[0];
            const met = all(e, 'metronome')[0];
            if (sound?.hasAttribute('tempo'))
                tempos.push({ t: at, bpm: Number(sound.getAttribute('tempo')) });
            else if (met) {
                const unit: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125 };
                const beat = unit[text(met, 'beat-unit')], rate = Number(text(met, 'per-minute'));
                if (beat && rate > 0)
                    tempos.push({ t: at, bpm: rate * beat * (2 - Math.pow(.5, all(met, 'beat-unit-dot').length)) });
                else
                    issues.push('Metric modulation without a numeric tempo is unsupported.');
            }
            const dynamic = all(e, 'dynamics')[0];
            if (sound?.hasAttribute('dynamics'))
                dynamics.push({ t: at, velocity: Math.max(1, Math.min(127, Math.round(Number(sound.getAttribute('dynamics')) * 127 / 100))) });
            else if (dynamic) {
                const name = children(dynamic)[0]?.localName;
                if (DYNAMICS[name])
                    dynamics.push({ t: at, velocity: DYNAMICS[name] });
            }
            if (sound && ['dacapo', 'dalsegno', 'tocoda', 'fine'].some(a => sound.hasAttribute(a)))
                issues.push('D.C./D.S./coda/fine navigation needs explicit expansion before playback.');
            if (all(e, 'wedge').length)
                issues.push('Hairpin dynamics need explicit dynamic levels before unified playback.');
        }
        if (tag === 'barline') {
            for (const r of all(e, 'repeat')) {
                if (r.getAttribute('direction') === 'forward') {
                    if (e.getAttribute('location') === 'right')
                        issues.push('A forward repeat on a right barline is unsupported.');
                    else
                        result.repeatStart = true;
                }
                else
                    result.repeatEnd = Number(r.getAttribute('times') || 2);
            }
            for (const ending of all(e, 'ending')) {
                const numbers = String(ending.getAttribute('number')).split(/[, ]+/).filter(Boolean).map(Number);
                const type = ending.getAttribute('type');
                if (numbers.some(n => !Number.isInteger(n) || n < 1) || !['start', 'stop', 'discontinue'].includes(type))
                    issues.push('Unsupported repeat-ending notation.');
                else
                    (result.endings ??= []).push({ numbers, type });
            }
        }
    }
    if (tempos.length)
        result.tempos = tempos;
    if (dynamics.length)
        result.dynamics = dynamics.sort((a, b) => a.t - b.t);
    if (issues.length)
        result.issues = issues;
    return result;
}
