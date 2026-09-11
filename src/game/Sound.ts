import { MUSIC_BEATS, MUSIC_GAIN, MUSIC_NOTES, MUSIC_TEMPO, SFX_GAIN } from './music';

type Effect = 'select' | 'success' | 'failure' | 'bundle' | 'catch' | 'card' | 'story';
type Voice = { oscillator: OscillatorNode; gain: GainNode; kind: 'music' | 'effect'; disposed: boolean };
export interface SoundOptions { readonly createContext?: () => AudioContext; }
export const MAX_AUDIO_VOICES = 24;
const BEAT_SECONDS = 60 / MUSIC_TEMPO;
const LOOP_SECONDS = MUSIC_BEATS * BEAT_SECONDS;

/** One context and one scheduler; no audio is created before an explicit unlock. */
export class Sound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private effectBus: GainNode | null = null;
  private readonly voices = new Set<Voice>();
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private resumePending: Promise<void> | null = null;
  private suspendPending: Promise<void> | null = null;
  private revision = 0;
  private unlockRevision = -1;
  private destroyed = false;
  private paused = false;
  private isMuted = false;
  private audible = false;
  private loopStart = 0;
  private cursor = 0;
  private songOffset = 0;

  constructor(private readonly options: SoundOptions = {}) {}

  get muted(): boolean { return this.isMuted; }
  set muted(value: boolean) {
    if (this.isMuted === value) return;
    this.isMuted = value;
    if (value) this.silenceAndSuspend();
  }

  /** Allowing playback again does not resume it: a user gesture must call unlock. */
  setPaused(value: boolean): void {
    if (this.paused === value) return;
    this.paused = value;
    if (value) this.silenceAndSuspend();
  }

  /** Call only from trusted pointer/key interaction, including native dialog buttons. */
  unlock(): void {
    if (this.destroyed || this.isMuted || this.paused) return;
    try {
      if (!this.context) this.createContext();
      const ctx = this.context!;
      if (ctx.state === 'closed') return;
      this.unlockRevision = this.revision;
      if (this.resumePending) return;
      if (ctx.state === 'running' && !this.suspendPending) {
        this.startMusic();
        return;
      }
      // Call resume inside the actual gesture, even if a prior suspend is pending.
      // The browser serializes the context operations in their requested order.
      const pending = ctx.resume();
      this.resumePending = pending;
      void pending.then(() => {
        if (this.context === ctx && !this.destroyed && !this.paused && !this.isMuted
          && this.unlockRevision === this.revision && ctx.state === 'running') this.startMusic();
      }).catch(() => {
        // Safari may reject or interrupt resume; leave silence and allow a later gesture.
        if (this.context === ctx) this.silence(false);
      }).finally(() => {
        if (this.resumePending === pending) this.resumePending = null;
      });
    } catch {
      this.silence(false);
    }
  }

  play(kind: Effect): void {
    const ctx = this.context;
    if (!ctx || !this.audible || this.isMuted || this.paused || this.destroyed || ctx.state !== 'running') return;
    const notes = { select: [740], success: [659, 784, 988], failure: [330, 294], bundle: [523, 659], catch: [392, 523, 659], card: [784, 988, 1175], story: [440, 554, 659] }[kind];
    notes.forEach((frequency, index) => this.note(frequency, ctx.currentTime + index * 0.09, 0.16, 0.045, 'sine', 'effect'));
  }

  inspect() {
    return Object.freeze({
      contextState: this.context?.state ?? 'uninitialized',
      running: this.context?.state === 'running' && this.audible,
      muted: this.isMuted, paused: this.paused, destroyed: this.destroyed,
      musicPlaying: this.scheduler !== null && this.audible && this.context?.state === 'running',
      schedulerActive: this.scheduler !== null,
      activeVoices: this.voices.size,
      musicVoices: [...this.voices].filter((voice) => voice.kind === 'music').length,
      effectVoices: [...this.voices].filter((voice) => voice.kind === 'effect').length,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.silence();
    const ctx = this.context;
    if (ctx) {
      ctx.onstatechange = null;
      try { void ctx.close().catch(() => {}); } catch { /* Already unavailable. */ }
    }
    this.master?.disconnect(); this.musicBus?.disconnect(); this.effectBus?.disconnect();
    this.context = null;
    this.master = null; this.musicBus = null; this.effectBus = null;
    this.resumePending = null; this.suspendPending = null;
  }

  private createContext(): void {
    const create = this.options.createContext ?? (() => {
      const browser = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const Context = browser.AudioContext ?? browser.webkitAudioContext;
      if (!Context) throw new Error('Web Audio unavailable');
      return new Context();
    });
    const ctx = create();
    this.context = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = MUSIC_GAIN;
    this.effectBus = ctx.createGain(); this.effectBus.gain.value = SFX_GAIN;
    this.musicBus.connect(this.master); this.effectBus.connect(this.master); this.master.connect(ctx.destination);
    ctx.onstatechange = () => {
      if (this.context !== ctx || ctx.state === 'running') return;
      // Interruption never auto-restarts a tune; a fresh interaction is needed.
      // Preserve an explicit in-flight resume through our own suspend transition.
      this.silence(!this.resumePending && !this.suspendPending);
    };
  }

  private startMusic(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.destroyed || this.isMuted || this.paused) return;
    if (this.scheduler !== null) return;
    this.audible = true;
    this.master!.gain.cancelScheduledValues(ctx.currentTime);
    this.master!.gain.setValueAtTime(1, ctx.currentTime);
    this.loopStart = ctx.currentTime + 0.045 - this.songOffset;
    this.cursor = 0;
    this.scheduleMusic();
    this.scheduler = setInterval(() => this.scheduleMusic(), 100);
  }

  private scheduleMusic(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.audible || this.paused || this.isMuted || this.destroyed) return;
    const now = ctx.currentTime;
    // Jump over an arbitrarily delayed callback without emitting a burst of old notes.
    if (now >= this.loopStart + LOOP_SECONDS) {
      this.loopStart += Math.floor((now - this.loopStart) / LOOP_SECONDS) * LOOP_SECONDS;
      this.cursor = 0;
    }
    for (let count = 0; count < MUSIC_NOTES.length * 2; count++) {
      const event = MUSIC_NOTES[this.cursor]!;
      const at = this.loopStart + event.beat * BEAT_SECONDS;
      if (at > now + 0.22) break;
      if (at >= now - 0.015) this.note(440 * 2 ** ((event.midi - 69) / 12), Math.max(now, at), event.length * BEAT_SECONDS, event.gain, event.wave, 'music');
      this.cursor++;
      if (this.cursor === MUSIC_NOTES.length) { this.cursor = 0; this.loopStart += LOOP_SECONDS; }
    }
  }

  private note(frequency: number, at: number, duration: number, peak: number, wave: OscillatorType, kind: Voice['kind']): void {
    const ctx = this.context;
    if (!ctx || this.voices.size >= MAX_AUDIO_VOICES) return;
    let voice: Voice | null = null;
    try {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      voice = { oscillator, gain, kind, disposed: false };
      this.voices.add(voice);
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, at);
      const attack = kind === 'music' ? 0.075 : 0.02;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + attack);
      gain.gain.linearRampToValueAtTime(peak * 0.6, at + duration * 0.55);
      gain.gain.linearRampToValueAtTime(0, at + duration);
      oscillator.connect(gain);
      gain.connect(kind === 'music' ? this.musicBus! : this.effectBus!);
      const owned = voice;
      oscillator.onended = () => this.disposeVoice(owned);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.015);
    } catch {
      if (voice) this.disposeVoice(voice, true);
    }
  }

  private disposeVoice(voice: Voice, stop = false): void {
    if (voice.disposed) return;
    voice.disposed = true;
    voice.oscillator.onended = null;
    if (stop) { try { voice.oscillator.stop(); } catch { /* A stopped voice is already silent. */ } }
    voice.oscillator.disconnect(); voice.gain.disconnect();
    this.voices.delete(voice);
  }

  private silence(invalidate = true): void {
    if (invalidate) this.revision++;
    const ctx = this.context;
    if (this.scheduler !== null) {
      if (ctx) this.songOffset = Math.max(0, ctx.currentTime - this.loopStart) % LOOP_SECONDS;
      clearInterval(this.scheduler); this.scheduler = null;
    }
    this.audible = false;
    if (ctx && this.master) {
      try { this.master.gain.cancelScheduledValues(ctx.currentTime); this.master.gain.setValueAtTime(0, ctx.currentTime); } catch { /* A closed context is silent. */ }
    }
    for (const voice of this.voices) this.disposeVoice(voice, true);
  }

  private silenceAndSuspend(): void {
    this.silence();
    const ctx = this.context;
    if (!ctx || ctx.state === 'closed' || this.suspendPending) return;
    try {
      const pending = ctx.suspend();
      this.suspendPending = pending;
      void pending.catch(() => {}).finally(() => { if (this.suspendPending === pending) this.suspendPending = null; });
    } catch { /* Master gain and disconnected voices already guarantee silence. */ }
  }
}
