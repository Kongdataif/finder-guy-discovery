/** Original 16-bar instrumental sketch for this game; no external recording. */
export const MUSIC_TEMPO = 72;
export const MUSIC_BEATS = 64;
export const MUSIC_GAIN = 0.16;
export const SFX_GAIN = 0.75;
export interface MusicNote {
  readonly beat: number;
  readonly midi: number;
  readonly length: number;
  readonly gain: number;
  readonly wave: OscillatorType;
}

// Four gentle phrases. Edit pitches/rhythm here, separate from audio lifecycle.
const melody = [
  [72, 76], [79, 76], [74, 72], [69, 67],
  [72, 74], [76, 79], [74, 71], [72, 67],
  [76, 79], [81, 79], [76, 74], [72, 69],
  [74, 76], [79, 74], [71, 74], [72, 72],
] as const;
const bass = [48, 45, 53, 55, 48, 45, 53, 55, 45, 52, 53, 48, 50, 53, 55, 48] as const;
const notes: MusicNote[] = [];
melody.forEach((phrase, bar) => {
  notes.push({ beat: bar * 4, midi: bass[bar]!, length: 2.8, gain: 0.026, wave: 'sine' });
  notes.push({ beat: bar * 4 + 1, midi: bass[bar]! + 19, length: 1.6, gain: 0.018, wave: 'sine' });
  phrase.forEach((midi, index) => notes.push({ beat: bar * 4 + index * 2, midi, length: bar === 15 ? 1.7 : 1.35, gain: 0.04, wave: 'sine' }));
});
export const MUSIC_NOTES: readonly MusicNote[] = Object.freeze(notes.sort((a, b) => a.beat - b.beat).map((note) => Object.freeze(note)));
