// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMuted, playSound, setMuted } from "./sound";

/** Minimal AudioContext mock: just enough surface for lib/sound.ts to use. */
class MockAudioParam {
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class MockOscillator {
  type = "sine";
  frequency = new MockAudioParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockGain {
  gain = new MockAudioParam();
  connect = vi.fn();
}

class MockAudioContext {
  currentTime = 0;
  state: "running" | "suspended" | "closed" = "running";
  destination = {};
  resume = vi.fn().mockResolvedValue(undefined);
  createOscillator = vi.fn(() => new MockOscillator());
  createGain = vi.fn(() => new MockGain());
}

const originalAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;

describe("sound", () => {
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // jsdom localStorage is always available in this test environment.
    }
    setMuted(false);
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  afterEach(() => {
    if (originalAudioContext) {
      (globalThis as { AudioContext?: unknown }).AudioContext = originalAudioContext;
    } else {
      delete (globalThis as { AudioContext?: unknown }).AudioContext;
    }
  });

  it("round-trips the mute flag through localStorage", () => {
    expect(isMuted()).toBe(false);
    setMuted(true);
    expect(isMuted()).toBe(true);
    expect(window.localStorage.getItem("3z-prod-muted")).toBe("1");
    setMuted(false);
    expect(isMuted()).toBe(false);
    expect(window.localStorage.getItem("3z-prod-muted")).toBe("0");
  });

  it("never throws when there is no AudioContext at all", () => {
    expect(() => playSound("quest")).not.toThrow();
    expect(() => playSound("error")).not.toThrow();
  });

  it("resumes a suspended context and schedules notes on first play", () => {
    // This is the first successful AudioContext creation in the file (the
    // previous test left the lazily-cached context as null), so it also
    // exercises the "create + resume" path in ensureContext().
    const instances: MockAudioContext[] = [];
    class TrackedAudioContext extends MockAudioContext {
      constructor() {
        super();
        this.state = "suspended";
        instances.push(this);
      }
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = TrackedAudioContext;

    expect(() => playSound("levelUp")).not.toThrow();

    expect(instances).toHaveLength(1);
    expect(instances[0].resume).toHaveBeenCalled();
    // levelUp is a 4-note fanfare: one oscillator + one gain per note.
    expect(instances[0].createOscillator).toHaveBeenCalledTimes(4);
    expect(instances[0].createGain).toHaveBeenCalledTimes(4);
  });

  it("does not touch AudioContext at all while muted", () => {
    const ctorSpy = vi.fn(function (this: MockAudioContext) {
      Object.assign(this, new MockAudioContext());
    });
    (globalThis as { AudioContext?: unknown }).AudioContext = ctorSpy;

    setMuted(true);
    expect(() => playSound("gems")).not.toThrow();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it("plays every named sound without throwing", () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = MockAudioContext;
    const names: Array<Parameters<typeof playSound>[0]> = [
      "quest",
      "micro",
      "gems",
      "levelUp",
      "tierUp",
      "mastery",
      "dayDone",
      "error",
      "chest",
      "badge",
      "bossHit",
      "bossDown",
      "drill",
    ];
    for (const name of names) {
      expect(() => playSound(name)).not.toThrow();
    }
  });
});
