export type MotionEvent = { time: number; midi: number };

export type MotionSummary = {
  total: number;
  parallel: number;
  similar: number;
  contrary: number;
  oblique: number;
  parallelPerfect: number;
};

function motionDir(prev: number, next: number): -1 | 0 | 1 {
  if (next > prev) return 1;
  if (next < prev) return -1;
  return 0;
}

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function isPerfect(intervalPc: number): boolean {
  return intervalPc === 0 || intervalPc === 7;
}

export function analyzeMotion(voiceA: MotionEvent[], voiceB: MotionEvent[]): MotionSummary {
  const n = Math.min(voiceA.length, voiceB.length);
  if (n < 2) {
    return {
      total: 0,
      parallel: 0,
      similar: 0,
      contrary: 0,
      oblique: 0,
      parallelPerfect: 0
    };
  }

  let parallel = 0;
  let similar = 0;
  let contrary = 0;
  let oblique = 0;
  let parallelPerfect = 0;

  for (let i = 0; i < n - 1; i++) {
    const a1 = voiceA[i]!;
    const a2 = voiceA[i + 1]!;
    const b1 = voiceB[i]!;
    const b2 = voiceB[i + 1]!;

    const dirA = motionDir(a1.midi, a2.midi);
    const dirB = motionDir(b1.midi, b2.midi);

    if (dirA === 0 && dirB === 0) continue;
    if (dirA === 0 || dirB === 0) {
      oblique++;
      continue;
    }

    if (dirA === dirB) {
      const int1 = pc(a1.midi - b1.midi);
      const int2 = pc(a2.midi - b2.midi);
      if (int1 === int2) {
        parallel++;
        if (isPerfect(int1) && isPerfect(int2)) parallelPerfect++;
      } else {
        similar++;
      }
    } else {
      contrary++;
    }
  }

  const total = parallel + similar + contrary + oblique;
  return { total, parallel, similar, contrary, oblique, parallelPerfect };
}

