import { describe, expect, it } from 'vitest';
import { createMissions, segmentIntersectsStain, validateMission } from './missions';
import type { FindMission, SortMission, WipeMission } from './types';

describe('fixed and validated P0 mission data', () => {
  it('replays a seed exactly and keeps answers valid for many seeds', () => {
    expect(createMissions(42)).toEqual(createMissions(42));
    expect(createMissions(42)).not.toEqual(createMissions(43));
    for (let seed = 0; seed < 100; seed++) {
      const missions = createMissions(seed, 'practice');
      expect(missions.map((mission) => mission.kind)).toEqual(['find', 'sort', 'wipe']);
      missions.forEach((mission) => expect(() => validateMission(mission)).not.toThrow());
      const wipe = missions[2] as WipeMission;
      for (const stain of wipe.stains) {
        expect(stain.y - stain.radius).toBeGreaterThan(245);
        expect(stain.y + stain.radius).toBeLessThan(340);
        const lens = stain.x < 500 ? [340, 490] : [510, 660];
        expect(stain.x - stain.radius).toBeGreaterThan(lens[0]!);
        expect(stain.x + stain.radius).toBeLessThan(lens[1]!);
      }
    }
  });

  it('freezes nested files, answer mappings, and stain geometry', () => {
    const missions = createMissions(5);
    expect(Object.isFrozen(missions)).toBe(true);
    expect(Object.isFrozen((missions[0] as FindMission).files[0])).toBe(true);
    expect(Object.isFrozen((missions[1] as SortMission).expectedFolderByFileId)).toBe(true);
    expect(Object.isFrozen((missions[2] as WipeMission).stains[0])).toBe(true);
  });

  it('rejects duplicate IDs, missing targets, invalid folder links, and bad geometry', () => {
    const [find, sort, wipe] = createMissions(3) as readonly [FindMission, SortMission, WipeMission];
    expect(() => validateMission({ ...find, files: [find.files[0]!, find.files[0]!] })).toThrow();
    expect(() => validateMission({ ...find, targetFileId: 'missing' })).toThrow();
    expect(() => validateMission({ ...sort, expectedFolderByFileId: { 'cat-photo': 'documents', note: 'documents' } })).toThrow();
    expect(() => validateMission({ ...sort, requiredFileIds: ['missing', 'note'] })).toThrow();
    expect(() => validateMission({ ...wipe, stains: [{ id: 'bad', x: NaN, y: 10, radius: 4 }] })).toThrow();
    expect(() => validateMission({ ...wipe, stains: [{ id: 'bad', x: 10, y: 10, radius: 0 }] })).toThrow();
    expect(() => createMissions(NaN)).toThrow();
  });
});

describe('wipe geometry', () => {
  const stain = { id: 'ink', x: 50, y: 50, radius: 10 };

  it('detects a fast swipe whose endpoints both miss', () => {
    expect(segmentIntersectsStain({ x: 0, y: 50 }, { x: 100, y: 50 }, stain)).toBe(true);
    expect(segmentIntersectsStain({ x: 100, y: 50 }, { x: 0, y: 50 }, stain)).toBe(true);
  });

  it('includes tangent and click contact without accepting nearby misses', () => {
    expect(segmentIntersectsStain({ x: 0, y: 40 }, { x: 100, y: 40 }, stain)).toBe(true);
    expect(segmentIntersectsStain({ x: 0, y: 39.9 }, { x: 100, y: 39.9 }, stain)).toBe(false);
    expect(segmentIntersectsStain({ x: 50, y: 50 }, { x: 50, y: 50 }, stain)).toBe(true);
    expect(segmentIntersectsStain({ x: 0, y: 0 }, { x: 0, y: 0 }, stain)).toBe(false);
    expect(segmentIntersectsStain({ x: NaN, y: 0 }, { x: 50, y: 50 }, stain)).toBe(false);
  });
});
