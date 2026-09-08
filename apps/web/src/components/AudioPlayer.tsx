import { instrumentPlayback } from "../../../../src/score/instrumentPlayback";
import { buildPlaybackSchedule, resumeSchedule, scheduleInstrumentNotes } from "../utils/playbackSchedule";
import { useCallback, useEffect, useRef, useState } from "react";
// @ts-ignore — soundfont-player has no bundled types
import Soundfont from "soundfont-player";


type NoteEvent = {
  type: string;
  t: number;   // measure-relative onset in quarter-note beats
  dur: number; // length in quarter-note beats
  midi?: number;
  pitch?: { step: string; alter?: number; octave: number };
};

type Measure = { number: number; events: NoteEvent[] };
type Part    = { name?: string; instrument?: string; measures: Measure[] };

type Props = {
  scoreModel: { parts: Part[]; meta?: { tempo_bpm?: number } } | null;
  /** Optional audition tempo; otherwise use the final score tempo map. */
  bpm?: number;
};

type PlayState = "idle" | "loading" | "playing" | "paused";

function resolveInstrument(part: Part): string { return instrumentPlayback(part).soundfont; }

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioPlayer({ scoreModel, bpm: bpmProp }: Props) {
  const [playbackError, setPlaybackError] = useState("");
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [progress, setProgress]   = useState(0);   // 0-1
  const [elapsed, setElapsed]     = useState(0);   // seconds
  const [totalDur, setTotalDur]   = useState(0);   // seconds
  const [volume, setVolume]       = useState(0.65);

  const generationRef = useRef(0);
  const masterGainRef = useRef<GainNode | null>(null);
  const cacheRef = useRef(new Map<string, Promise<any>>());
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const instrumentsRef = useRef<any[]>([]);
  const startTimeRef   = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const rafRef         = useRef<number>(0);
  const stopFnRef      = useRef<(() => void) | null>(null);
  const volumeRef      = useRef(volume);

  useEffect(() => { volumeRef.current = volume; if (masterGainRef.current) masterGainRef.current.gain.value = volume; }, [volume]);
  useEffect(() => () => { generationRef.current++; cancelAnimationFrame(rafRef.current); stopFnRef.current?.(); cacheRef.current.clear(); void audioCtxRef.current?.close().catch(() => {}); }, []);

  const stop = useCallback(() => {
    generationRef.current++;
    cancelAnimationFrame(rafRef.current);
    stopFnRef.current?.();
    stopFnRef.current = null;
    pauseOffsetRef.current = 0;
    setPlayState("idle");
    setProgress(0);
    setElapsed(0);
  }, []);

  useEffect(() => { stop(); setTotalDur(0); }, [scoreModel, bpmProp, stop]);

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
    const generation = ++generationRef.current;
    setPlayState("loading");
    setPlaybackError("");

    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;
    try { if (ctx.state === "suspended") await ctx.resume(); }
    catch (error) { setPlaybackError(String(error)); setPlayState("idle"); return; }
    if (generation !== generationRef.current) return;
    if (!masterGainRef.current) { const gain=ctx.createGain(); gain.gain.value=volumeRef.current; gain.connect(ctx.destination); masterGainRef.current=gain; }

    let schedule: ReturnType<typeof buildPlaybackSchedule>;
    try { schedule = buildPlaybackSchedule(scoreModel, bpmProp); }
    catch (error) {
      setPlaybackError(error instanceof Error ? error.message : "Invalid score timing.");
      setPlayState("idle");
      return;
    }
    if (!schedule.durationSec) { setPlayState("idle"); return; }

    const dur = schedule.durationSec;
    setTotalDur(dur);

    // Load instruments (deduplicated); fall back from MusyngKite → FluidR3
    const partInstruments = scoreModel.parts.map(resolveInstrument);
    const uniqueInstr = [...new Set(partInstruments)];
    const loaded: Record<string, any> = {};

    try {
      await Promise.all(uniqueInstr.map(async name => {
        let cached = cacheRef.current.get(name);
        if (!cached) {
          const destination = masterGainRef.current!;
          cached = Soundfont.instrument(ctx, name as any, { soundfont: "MusyngKite", destination })
            .catch(() => Soundfont.instrument(ctx, name as any, { soundfont: "FluidR3_GM", destination }));
          cacheRef.current.set(name, cached!);
        }
        try { loaded[name] = await cached; }
        catch { cacheRef.current.delete(name); throw Error(`Could not load the ${name.replace(/_/g, " ")} sound. Please retry.`); }
      }));
    } catch (error) {
      if (generation === generationRef.current) { setPlaybackError((error as Error).message); setPlayState("idle"); }
      return;
    }
    if (generation !== generationRef.current) return;

    instrumentsRef.current = scoreModel.parts.map((p) => loaded[resolveInstrument(p)]);

    const offset = pauseOffsetRef.current;
    const origin = ctx.currentTime + 0.05 - offset;
    startTimeRef.current = origin;
    pauseOffsetRef.current = 0;

    // Schedule all notes from current offset onwards
    const pending = resumeSchedule(schedule, offset);
    stopFnRef.current = scheduleInstrumentNotes(instrumentsRef.current, pending, origin);
    setPlayState("playing");

    function tick() {
      if (!audioCtxRef.current) return;
      const e = Math.max(0, audioCtxRef.current.currentTime - origin);
      setElapsed(Math.min(e, dur));
      setProgress(Math.min(e / dur, 1));
      if (e < dur) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stop();
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [scoreModel, stop, bpmProp]);

  if (!scoreModel) return null;

  const pct = Math.round(progress * 100);

  return (
    <div className="audio-player">
      {playbackError && <div role="alert">{playbackError}</div>}
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

        {playState === "loading" && <button className="audio-btn" onClick={stop}>Cancel</button>}

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
