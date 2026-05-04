import { useCallback, useEffect, useRef, useState } from "react";
// @ts-ignore — soundfont-player has no bundled types
import Soundfont from "soundfont-player";

const DIVISIONS = 4; // ScoreModel normalises to 4 divisions per quarter-note

type NoteEvent = {
  type: string;
  t: number;   // onset  in divisions (4 = 1 quarter note)
  dur: number; // length in divisions
  midi?: number;
  pitch?: { step: string; alter?: number; octave: number };
};

type Measure = { number: number; events: NoteEvent[] };
type Part    = { name?: string; instrument?: string; measures: Measure[] };

type Props = {
  scoreModel: { parts: Part[]; meta?: { tempo_bpm?: number } } | null;
};

type PlayState = "idle" | "loading" | "playing" | "paused";

// Soundfont name map (MusyngKite names)
const INSTRUMENTS: Record<string, string> = {
  violin:   "violin",
  viola:    "viola",
  cello:    "cello",
  contrabass: "contrabass",
  bass:     "contrabass",
  flute:    "flute",
  oboe:     "oboe",
  clarinet: "clarinet",
  bassoon:  "bassoon",
  trumpet:  "trumpet",
  horn:     "french_horn",
  trombone: "trombone",
  tuba:     "tuba",
  piano:    "acoustic_grand_piano",
  timpani:  "timpani",
  default:  "acoustic_grand_piano",
};

function resolveInstrument(part: Part): string {
  const key = `${part.instrument ?? ""} ${part.name ?? ""}`.toLowerCase();
  for (const [k, v] of Object.entries(INSTRUMENTS)) {
    if (key.includes(k)) return v;
  }
  return INSTRUMENTS.default;
}

type ScheduledNote = { midi: number; startSec: number; durSec: number; partIdx: number };

function midiFromPitch(pitch?: { step: string; alter?: number; octave: number }): number | null {
  if (!pitch) return null;
  const STEPS: Record<string, number> = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  const base = STEPS[pitch.step.toUpperCase()];
  if (base === undefined) return null;
  return (pitch.octave + 1) * 12 + base + (pitch.alter ?? 0);
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildSchedule(parts: Part[], bpm: number): ScheduledNote[] {
  // 1 beat = 1 quarter note = DIVISIONS divisions
  const secPerDivision = (60 / bpm) / DIVISIONS;
  const notes: ScheduledNote[] = [];

  parts.forEach((part, partIdx) => {
    let measureStartDiv = 0;
    for (const measure of part.measures) {
      // Measure length in divisions: max (t + dur) of all events, min 4*DIVISIONS (1 bar)
      let measureLenDiv = 4 * DIVISIONS;
      for (const ev of measure.events) {
        const end = (ev.t ?? 0) + (ev.dur ?? DIVISIONS);
        if (end > measureLenDiv) measureLenDiv = end;
      }

      for (const ev of measure.events) {
        if (ev.type !== "note") continue;
        const midi = ev.midi ?? midiFromPitch(ev.pitch);
        if (!midi) continue;
        const divOffset = measureStartDiv + (ev.t ?? 0);
        notes.push({
          midi,
          startSec: divOffset * secPerDivision,
          // 0.85 factor = slight legato gap between notes
          durSec:   Math.max(0.05, (ev.dur ?? DIVISIONS) * secPerDivision * 0.85),
          partIdx,
        });
      }
      measureStartDiv += measureLenDiv;
    }
  });

  return notes.sort((a, b) => a.startSec - b.startSec);
}

export default function AudioPlayer({ scoreModel }: Props) {
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [progress, setProgress]   = useState(0);   // 0-1
  const [elapsed, setElapsed]     = useState(0);   // seconds
  const [totalDur, setTotalDur]   = useState(0);   // seconds
  const [volume, setVolume]       = useState(0.65);

  const audioCtxRef    = useRef<AudioContext | null>(null);
  const instrumentsRef = useRef<any[]>([]);
  const startTimeRef   = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const rafRef         = useRef<number>(0);
  const stopFnRef      = useRef<(() => void) | null>(null);
  const volumeRef      = useRef(volume);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); stopFnRef.current?.(); }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    stopFnRef.current?.();
    stopFnRef.current = null;
    pauseOffsetRef.current = 0;
    setPlayState("idle");
    setProgress(0);
    setElapsed(0);
  }, []);

  const pause = useCallback(() => {
    if (!audioCtxRef.current) return;
    pauseOffsetRef.current = audioCtxRef.current.currentTime - startTimeRef.current;
    cancelAnimationFrame(rafRef.current);
    stopFnRef.current?.();
    stopFnRef.current = null;
    setPlayState("paused");
  }, []);

  const play = useCallback(async () => {
    if (!scoreModel) return;
    setPlayState("loading");

    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const bpm = scoreModel.meta?.tempo_bpm ?? 100;
    const schedule = buildSchedule(scoreModel.parts, bpm);
    if (!schedule.length) { setPlayState("idle"); return; }

    const dur = schedule[schedule.length - 1]!.startSec + schedule[schedule.length - 1]!.durSec;
    setTotalDur(dur);

    // Load instruments (deduplicated); fall back from MusyngKite → FluidR3
    const partInstruments = scoreModel.parts.map(resolveInstrument);
    const uniqueInstr = [...new Set(partInstruments)];
    const loaded: Record<string, any> = {};

    await Promise.all(
      uniqueInstr.map(async (name) => {
        try {
          loaded[name] = await Soundfont.instrument(ctx, name as any, { soundfont: "MusyngKite" });
        } catch {
          try {
            loaded[name] = await Soundfont.instrument(ctx, name as any, { soundfont: "FluidR3_GM" });
          } catch {
            loaded[name] = await Soundfont.instrument(ctx, "acoustic_grand_piano" as any);
          }
        }
      })
    );

    instrumentsRef.current = scoreModel.parts.map((p) => loaded[resolveInstrument(p)]);

    const offset = pauseOffsetRef.current;
    const origin = ctx.currentTime - offset;
    startTimeRef.current = origin;
    pauseOffsetRef.current = 0;

    // Schedule all notes from current offset onwards
    const pending = schedule.filter((n) => n.startSec >= offset - 0.01);
    const nodes: any[] = [];
    for (const n of pending) {
      const instr = instrumentsRef.current[n.partIdx];
      if (!instr) continue;
      const node = instr.schedule(ctx, n.midi, origin + n.startSec, {
        duration: n.durSec,
        gain: volumeRef.current,
      });
      if (node) nodes.push(node);
    }

    stopFnRef.current = () => nodes.forEach((n) => { try { n.stop(0); } catch {} });
    setPlayState("playing");

    function tick() {
      if (!audioCtxRef.current) return;
      const e = audioCtxRef.current.currentTime - origin;
      setElapsed(Math.min(e, dur));
      setProgress(Math.min(e / dur, 1));
      if (e < dur) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stop();
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [scoreModel, stop]);

  if (!scoreModel) return null;

  const pct = Math.round(progress * 100);

  return (
    <div className="audio-player">
      <div className="audio-controls">
        {playState === "playing" ? (
          <>
            <button className="audio-btn" onClick={pause} title="Pause">⏸</button>
            <button className="audio-btn" onClick={stop}  title="Stop">⏹</button>
          </>
        ) : playState === "paused" ? (
          <>
            <button className="audio-btn primary" onClick={play}  title="Resume">▶ Resume</button>
            <button className="audio-btn"         onClick={stop}  title="Stop">⏹</button>
          </>
        ) : (
          <button
            className="audio-btn primary"
            onClick={play}
            disabled={playState === "loading"}
            title="Play"
          >
            {playState === "loading" ? "Loading…" : "▶ Play"}
          </button>
        )}

        <span className="audio-time">
          {playState === "idle"
            ? totalDur > 0 ? fmtTime(totalDur) : ""
            : `${fmtTime(elapsed)} / ${fmtTime(totalDur)}`}
        </span>

        {/* Volume knob */}
        <label className="audio-vol-label" title="Volume">
          🔊
          <input
            type="range"
            min={0} max={1} step={0.05}
            value={volume}
            className="audio-vol-slider"
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      </div>

      {(playState === "playing" || playState === "paused") && (
        <div className="audio-progress" title={`${pct}%`}>
          <div className="audio-bar" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
