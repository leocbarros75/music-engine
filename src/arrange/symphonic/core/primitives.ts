export type Direction = "up" | "down" | "static";
export type MotionPrimitive = "half_step" | "whole_step" | "step" | "skip" | "leap";
export type RelativeMotion = "parallel" | "similar" | "contrary" | "oblique";
export type IntervalClass = "perfect" | "imperfect" | "dissonant";

export function direction(a: number | null, b: number | null): Direction {
  if (a === null || b === null) return "static";
  if (b > a) return "up";
  if (b < a) return "down";
  return "static";
}

export function melodicPrimitive(a: number | null, b: number | null): MotionPrimitive {
  if (a === null || b === null) return "step";
  const d = Math.abs(b - a);
  if (d === 0) return "step";
  if (d === 1) return "half_step";
  if (d === 2) return "whole_step";
  if (d === 3 || d === 4) return "skip";
  return "leap";
}

export function relativeMotion(a0: number | null, a1: number | null, b0: number | null, b1: number | null): RelativeMotion {
  const da = direction(a0, a1);
  const db = direction(b0, b1);
  if (da === "static" || db === "static") return "oblique";
  if (da === db) {
    const ia = a0 === null || a1 === null ? 0 : Math.abs(a1 - a0);
    const ib = b0 === null || b1 === null ? 0 : Math.abs(b1 - b0);
    return ia === ib ? "parallel" : "similar";
  }
  return "contrary";
}

export function intervalClass(semitones: number): IntervalClass {
  const pc = ((semitones % 12) + 12) % 12;
  if (pc === 0 || pc === 7) return "perfect";
  if (pc === 3 || pc === 4 || pc === 8 || pc === 9) return "imperfect";
  return "dissonant";
}

export function verticalInterval(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}
