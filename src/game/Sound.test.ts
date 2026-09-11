import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_AUDIO_VOICES, Sound } from './Sound';

class FakeParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  linearRampToValueAtTime = vi.fn();
}
class FakeGain {
  gain = new FakeParam();
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeOscillator {
  type = 'sine';
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeContext {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  createGain = vi.fn(() => { const gain = new FakeGain(); this.gains.push(gain); return gain; });
  createOscillator = vi.fn(() => { const oscillator = new FakeOscillator(); this.oscillators.push(oscillator); return oscillator; });
  resume = vi.fn(async () => { this.emit('running'); });
  suspend = vi.fn(async () => { this.emit('suspended'); });
  close = vi.fn(async () => { this.emit('closed'); });
  emit(state: string) { this.state = state; this.onstatechange?.(); }
}
function setup() {
  const ctx = new FakeContext();
  const createContext = vi.fn(() => ctx as unknown as AudioContext);
  return { sound: new Sound({ createContext }), ctx, createContext };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('gesture activation and background music lifecycle', () => {
  it('creates no context, scheduler, or sound before unlock, including when unmuting', async () => {
    const { sound, createContext } = setup();
    sound.play('select'); sound.setPaused(true); sound.setPaused(false);
    sound.muted = true; sound.unlock(); sound.muted = false;
    await settle();
    expect(createContext).not.toHaveBeenCalled();
    expect(sound.inspect()).toMatchObject({ contextState: 'uninitialized', activeVoices: 0, schedulerActive: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts one quiet music scheduler and coalesces repeated unlocks', async () => {
    const { sound, ctx, createContext } = setup();
    sound.unlock(); sound.unlock(); sound.unlock();
    await settle();
    const started = sound.inspect();
    expect(started).toMatchObject({ contextState: 'running', running: true, musicPlaying: true, schedulerActive: true });
    expect(started.musicVoices).toBeGreaterThan(0);
    expect(ctx.gains[1]!.gain.value).toBeLessThan(ctx.gains[2]!.gain.value);
    for (let i = 0; i < 20; i++) sound.unlock();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(sound.inspect().activeVoices).toBe(started.activeVoices);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('mutes all already scheduled music and effects immediately and requires a new unlock', async () => {
    const { sound, ctx } = setup();
    sound.unlock(); await settle(); sound.play('story');
    expect(sound.inspect().effectVoices).toBe(3);
    sound.muted = true;
    expect(ctx.gains[0]!.gain.value).toBe(0);
    expect(sound.inspect()).toMatchObject({ activeVoices: 0, schedulerActive: false, musicPlaying: false, running: false });
    expect(vi.getTimerCount()).toBe(0);
    ctx.oscillators.forEach((voice) => { expect(voice.stop).toHaveBeenLastCalledWith(); expect(voice.disconnect).toHaveBeenCalledTimes(1); });
    sound.play('success'); sound.unlock();
    expect(sound.inspect().activeVoices).toBe(0);
    sound.muted = false; await settle();
    expect(sound.inspect().schedulerActive).toBe(false);
    sound.unlock(); await settle();
    expect(sound.inspect().musicPlaying).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('pauses both music and effects through a hidden interval and waits for manual unlock', async () => {
    const { sound, ctx } = setup();
    sound.unlock(); await settle(); sound.play('catch');
    ctx.currentTime = 3;
    sound.setPaused(true); await settle();
    const count = ctx.oscillators.length;
    vi.advanceTimersByTime(60_000);
    expect(ctx.oscillators).toHaveLength(count);
    expect(sound.inspect()).toMatchObject({ paused: true, activeVoices: 0, schedulerActive: false });
    sound.setPaused(false); await settle();
    expect(sound.inspect().schedulerActive).toBe(false);
    sound.unlock(); await settle();
    expect(sound.inspect()).toMatchObject({ paused: false, running: true, schedulerActive: true });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not resurrect music when a stale resume resolves after mute', async () => {
    const { sound, ctx } = setup();
    const pending = deferred();
    ctx.resume.mockImplementation(() => pending.promise);
    sound.unlock(); sound.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    sound.muted = true;
    ctx.emit('running'); pending.resolve(); await settle();
    expect(sound.inspect()).toMatchObject({ muted: true, activeVoices: 0, schedulerActive: false, running: false });
  });

  it('orders a new gesture resume after an in-flight suspend without duplicating loops', async () => {
    const { sound, ctx } = setup();
    sound.unlock(); await settle();
    const suspended = deferred(); const resumed = deferred();
    ctx.suspend.mockImplementation(() => suspended.promise);
    ctx.resume.mockImplementation(() => resumed.promise);
    sound.setPaused(true);
    sound.setPaused(false); sound.unlock();
    ctx.emit('suspended'); suspended.resolve(); await settle();
    ctx.emit('running'); resumed.resolve(); await settle();
    expect(sound.inspect()).toMatchObject({ running: true, schedulerActive: true, paused: false });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('recovers from resume rejection and Safari interruption only after another gesture', async () => {
    const { sound, ctx } = setup();
    ctx.resume.mockRejectedValueOnce(new Error('not allowed'));
    sound.unlock(); await settle();
    expect(sound.inspect()).toMatchObject({ activeVoices: 0, schedulerActive: false });
    sound.unlock(); await settle();
    expect(sound.inspect().musicPlaying).toBe(true);
    ctx.emit('interrupted');
    expect(sound.inspect()).toMatchObject({ activeVoices: 0, musicPlaying: false, schedulerActive: false });
    ctx.emit('running');
    expect(sound.inspect().schedulerActive).toBe(false);
    sound.unlock(); await settle();
    expect(sound.inspect().musicPlaying).toBe(true);
  });

  it('bounds overlapping effects, disconnects ended voices, and does not replay old notes after delay', async () => {
    const { sound, ctx } = setup();
    sound.unlock(); await settle();
    for (let i = 0; i < 100; i++) sound.play('story');
    expect(sound.inspect().activeVoices).toBe(MAX_AUDIO_VOICES);
    ctx.oscillators.forEach((voice) => voice.onended?.());
    expect(sound.inspect().activeVoices).toBe(0);
    const previous = ctx.oscillators.length;
    ctx.currentTime = 3600;
    vi.advanceTimersByTime(100);
    expect(ctx.oscillators.length - previous).toBeLessThanOrEqual(4);
    for (const voice of ctx.oscillators.slice(previous)) expect(voice.start.mock.calls[0]![0]).toBeGreaterThanOrEqual(ctx.currentTime);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('destroy disconnects nodes, closes once, and blocks a late resume or further interaction', async () => {
    const { sound, ctx } = setup();
    const pending = deferred();
    ctx.resume.mockImplementation(() => pending.promise);
    sound.unlock(); sound.destroy(); sound.destroy();
    ctx.emit('running'); pending.resolve(); await settle();
    sound.unlock(); sound.play('select'); sound.setPaused(false);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(ctx.onstatechange).toBeNull();
    expect(ctx.gains.slice(0, 3).every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
    expect(sound.inspect()).toMatchObject({ destroyed: true, activeVoices: 0, schedulerActive: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
