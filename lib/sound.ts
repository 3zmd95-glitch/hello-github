/**
 * 8-bit Web Audio sound effects for the training dashboard (master plan round 15).
 * No audio assets: every sound is a short sequence of square/triangle-oscillator
 * notes with a tiny envelope, generated on the fly. Everything here is defensive:
 * on the server, in a browser without Web Audio, or if anything throws, calls
 * silently no-op instead of crashing the caller.
 */

export type SoundName =
  | "quest"
  | "micro"
  | "gems"
  | "levelUp"
  | "tierUp"
  | "mastery"
  | "dayDone"
  | "error"
  | "chest"
  | "badge"
  | "bossHit"
  | "bossDown"
  | "drill";

interface Note {
  /** Frequency in Hz. */
  freq: number;
  /** Offset from the start of the sound, in seconds. */
  start: number;
  /** Note length, in seconds. */
  duration: number;
  type: OscillatorType;
}

const MUTE_STORAGE_KEY = "3z-prod-muted";
const MASTER_GAIN = 0.15;

/** Short note sequences per sound. Kept small and punchy (8-bit game feel). */
const SEQUENCES: Record<SoundName, readonly Note[]> = {
  // Two rising notes, ~120ms total.
  quest: [
    { freq: 440, start: 0, duration: 0.08, type: "square" },
    { freq: 660, start: 0.06, duration: 0.09, type: "square" },
  ],
  // One short blip.
  micro: [{ freq: 880, start: 0, duration: 0.05, type: "square" }],
  // Sparkle arpeggio, quick ascending triangle notes.
  gems: [
    { freq: 784.0, start: 0, duration: 0.06, type: "triangle" },
    { freq: 987.77, start: 0.04, duration: 0.06, type: "triangle" },
    { freq: 1174.66, start: 0.08, duration: 0.06, type: "triangle" },
    { freq: 1567.98, start: 0.12, duration: 0.1, type: "triangle" },
  ],
  // 4-note fanfare.
  levelUp: [
    { freq: 523.25, start: 0, duration: 0.12, type: "square" },
    { freq: 659.25, start: 0.11, duration: 0.12, type: "square" },
    { freq: 783.99, start: 0.22, duration: 0.12, type: "square" },
    { freq: 1046.5, start: 0.33, duration: 0.24, type: "square" },
  ],
  // 3-note rise.
  tierUp: [
    { freq: 587.33, start: 0, duration: 0.1, type: "square" },
    { freq: 739.99, start: 0.09, duration: 0.1, type: "square" },
    { freq: 987.77, start: 0.18, duration: 0.2, type: "square" },
  ],
  // Longer 6-note victory line.
  mastery: [
    { freq: 523.25, start: 0, duration: 0.12, type: "square" },
    { freq: 659.25, start: 0.11, duration: 0.12, type: "square" },
    { freq: 783.99, start: 0.22, duration: 0.12, type: "square" },
    { freq: 1046.5, start: 0.33, duration: 0.12, type: "square" },
    { freq: 1318.51, start: 0.44, duration: 0.14, type: "square" },
    { freq: 1567.98, start: 0.58, duration: 0.36, type: "triangle" },
  ],
  // Warm 3-note chord/arpeggio (triangle waves feel softer than square).
  dayDone: [
    { freq: 392.0, start: 0, duration: 0.35, type: "triangle" },
    { freq: 493.88, start: 0.05, duration: 0.35, type: "triangle" },
    { freq: 587.33, start: 0.1, duration: 0.45, type: "triangle" },
  ],
  // Low buzz for errors.
  error: [
    { freq: 160, start: 0, duration: 0.16, type: "square" },
    { freq: 110, start: 0.14, duration: 0.24, type: "square" },
  ],
  // Chest: a creaky low "lid" then a bright sparkle burst.
  chest: [
    { freq: 196.0, start: 0, duration: 0.12, type: "square" },
    { freq: 246.94, start: 0.1, duration: 0.1, type: "square" },
    { freq: 1046.5, start: 0.24, duration: 0.07, type: "triangle" },
    { freq: 1318.51, start: 0.3, duration: 0.07, type: "triangle" },
    { freq: 1567.98, start: 0.36, duration: 0.16, type: "triangle" },
  ],
  // Badge: a proud two-note "ta-daa".
  badge: [
    { freq: 659.25, start: 0, duration: 0.14, type: "square" },
    { freq: 987.77, start: 0.13, duration: 0.3, type: "square" },
    { freq: 1318.51, start: 0.13, duration: 0.3, type: "triangle" },
  ],
  // Boss hit: a short punchy thud with a falling pitch.
  bossHit: [
    { freq: 220, start: 0, duration: 0.06, type: "square" },
    { freq: 150, start: 0.05, duration: 0.1, type: "square" },
  ],
  // Boss down: heavy falling notes then a victory chord.
  bossDown: [
    { freq: 330, start: 0, duration: 0.1, type: "square" },
    { freq: 247, start: 0.09, duration: 0.1, type: "square" },
    { freq: 165, start: 0.18, duration: 0.16, type: "square" },
    { freq: 523.25, start: 0.4, duration: 0.4, type: "triangle" },
    { freq: 659.25, start: 0.4, duration: 0.4, type: "triangle" },
    { freq: 783.99, start: 0.4, duration: 0.5, type: "triangle" },
  ],
  // Drill: two quick ticks like a stopwatch.
  drill: [
    { freq: 1046.5, start: 0, duration: 0.04, type: "square" },
    { freq: 1046.5, start: 0.08, duration: 0.04, type: "square" },
    { freq: 1396.91, start: 0.16, duration: 0.08, type: "triangle" },
  ],
};

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

function readStoredMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let muted = readStoredMuted();
let audioCtx: AudioContext | null = null;

/** Lazily creates (or reuses) the single shared AudioContext. Never throws. */
function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) {
    if (audioCtx.state === "suspended") {
      try {
        void audioCtx.resume();
      } catch {
        // Ignore: playback may just stay silent until the next user gesture.
      }
    }
    return audioCtx;
  }
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    audioCtx = ctx;
    if (ctx.state === "suspended") {
      try {
        void ctx.resume();
      } catch {
        // Ignore.
      }
    }
    return ctx;
  } catch {
    return null;
  }
}

function playNote(ctx: AudioContext, note: Note): void {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const startTime = ctx.currentTime + note.start;
  const endTime = startTime + note.duration;

  oscillator.type = note.type;
  oscillator.frequency.setValueAtTime(note.freq, startTime);

  // Quick attack, exponential-ish decay so notes sound like chiptune blips
  // rather than clicking on/off.
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(MASTER_GAIN, startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(endTime + 0.02);
}

/**
 * Plays a short 8-bit sound effect. Must be called from a user gesture the
 * first time (browsers require that to start an AudioContext). Safe to call
 * on the server, when muted, or when Web Audio isn't available — it just
 * no-ops. Never throws.
 */
export function playSound(name: SoundName): void {
  try {
    if (muted) return;
    const ctx = ensureContext();
    if (!ctx) return;
    const notes = SEQUENCES[name];
    for (const note of notes) playNote(ctx, note);
  } catch {
    // Sound is decorative; never let it break the caller.
  }
}

/** Mutes/unmutes future `playSound` calls and persists the choice. */
export function setMuted(next: boolean): void {
  muted = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Ignore: mute state just won't survive a reload.
  }
}

/** Current mute state (in-memory, initialized from localStorage). */
export function isMuted(): boolean {
  return muted;
}
