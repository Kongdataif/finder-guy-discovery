import { describe, expect, it } from 'vitest';
import { FinderRunController } from './FinderRunController';
import { FinderPointerInput, type PointerLayout } from './PointerGestures';
import type { Point } from './types';

const CAT = { x: 40, y: 40 };
const DOG = { x: 140, y: 40 };
const TRAY = { x: 340, y: 60 };
const BLANK = { x: 600, y: 400 };
const layout: PointerLayout = {
  files: [
    { id: 'cat-photo', rect: { x: 10, y: 10, width: 80, height: 80 } },
    { id: 'dog-photo', rect: { x: 110, y: 10, width: 80, height: 80 } },
    { id: 'note', rect: { x: 210, y: 10, width: 80, height: 80 } },
  ],
  destinations: [{ id: 'tray', rect: { x: 310, y: 10, width: 100, height: 100 } }],
};

function setup() {
  const controller = new FinderRunController();
  controller.begin('en', 'normal', 4, 0, 'practice');
  controller.ready(0);
  controller.advance(1_000);
  const input = new FinderPointerInput(controller, () => layout);
  return { controller, input };
}

function click(input: FinderPointerInput, point: Point, now = 1_100): void {
  input.down(1, point, now);
  input.up(1, point, now + 10);
}

describe('FinderPointerInput selection and dragging', () => {
  it('selects on release, toggles selection, and clears on blank click without judging', () => {
    const { controller, input } = setup();
    input.down(1, CAT, 1_010);
    expect(controller.snapshot().selectedId).toBeNull();
    input.up(1, CAT, 1_020);
    expect(controller.snapshot().selectedId).toBe('cat-photo');
    click(input, DOG, 1_030);
    expect(controller.snapshot().selectedId).toBe('dog-photo');
    click(input, DOG, 1_050);
    expect(controller.snapshot().selectedId).toBeNull();
    click(input, CAT, 1_070);
    click(input, BLANK, 1_090);
    expect(controller.snapshot().selectedId).toBeNull();
    expect(controller.snapshot().outcomes).toEqual([]);
  });

  it('requires destination release and makes click and drag produce the same result', () => {
    const first = setup();
    click(first.input, CAT);
    first.input.down(1, TRAY, 1_200);
    expect(first.controller.snapshot().phase).toBe('playing');
    first.input.up(1, TRAY, 1_210);
    const second = setup();
    second.input.down(1, CAT, 1_100);
    second.input.move(1, TRAY, 1_200);
    expect(second.input.snapshot.drag).toEqual({ fileId: 'cat-photo', ...TRAY });
    second.input.up(1, TRAY, 1_210);
    expect(second.input.snapshot.drag).toBeNull();
    expect(first.controller.snapshot().outcomes).toEqual(second.controller.snapshot().outcomes);
    expect(first.controller.snapshot().successes).toBe(1);
  });

  it('does not reinterpret an out-and-back drag as a click', () => {
    const { controller, input } = setup();
    input.down(1, CAT, 1_100);
    input.move(1, { x: 200, y: 100 }, 1_120);
    input.move(1, CAT, 1_140);
    input.up(1, CAT, 1_150);
    expect(controller.snapshot().selectedId).toBeNull();
    expect(controller.snapshot().outcomes).toEqual([]);
  });

  it('cancels outside release and rejects a destination press released elsewhere', () => {
    const { controller, input } = setup();
    input.down(1, CAT, 1_100);
    input.move(1, TRAY, 1_120);
    input.up(1, TRAY, 1_130, true);
    expect(input.snapshot.drag).toBeNull();
    click(input, CAT, 1_140);
    input.down(1, TRAY, 1_170);
    input.up(1, BLANK, 1_180);
    expect(controller.snapshot().phase).toBe('playing');
    expect(controller.snapshot().selectedId).toBe('cat-photo');
    expect(controller.snapshot().outcomes).toEqual([]);
  });

  it('ignores a second pointer without replacing or ending the owner', () => {
    const { controller, input } = setup();
    input.down(1, CAT, 1_100);
    input.down(2, DOG, 1_110);
    input.move(2, TRAY, 1_120);
    input.up(2, TRAY, 1_130, true);
    expect(controller.snapshot().outcomes).toEqual([]);
    input.move(1, TRAY, 1_140);
    expect(input.snapshot.drag?.fileId).toBe('cat-photo');
    input.up(1, TRAY, 1_150);
    expect(controller.snapshot().successes).toBe(1);
  });
});

describe('FinderPointerInput lifecycle and deadline', () => {
  it('ignores stale releases after five restarts, without advancing the new clock', () => {
    const { controller, input } = setup();
    for (let index = 0; index < 5; index++) {
      const start = 2_000 + index * 2_000;
      input.down(1, CAT, start - 100);
      input.move(1, TRAY, start - 50);
      controller.begin('ko', 'normal', index, start, 'practice');
      controller.ready(start);
      controller.advance(start + 1_000);
      input.up(1, TRAY, start + 100_000);
      expect(controller.snapshot().phase).toBe('playing');
      expect(controller.snapshot().elapsedMs).toBe(0);
      expect(controller.snapshot().outcomes).toEqual([]);
      expect(input.snapshot.drag).toBeNull();
    }
  });

  it('pause and explicit cancellation prevent a held pointer from committing after resume', () => {
    const { controller, input } = setup();
    input.down(1, CAT, 1_100);
    input.move(1, TRAY, 1_150);
    controller.pause(1_160);
    input.cancel();
    controller.resume(5_000);
    input.up(1, TRAY, 5_010);
    expect(controller.snapshot().outcomes).toEqual([]);
    expect(controller.snapshot().selectedId).toBeNull();
  });

  it('rejects a drop exactly at the deadline, then ignores duplicate releases', () => {
    const { controller, input } = setup();
    input.down(1, CAT, 8_990);
    input.up(1, TRAY, 9_000);
    input.up(1, TRAY, 9_001);
    expect(controller.snapshot().outcomes).toHaveLength(1);
    expect(controller.snapshot().outcomes[0]?.reason).toBe('timeout');
    expect(input.snapshot.drag).toBeNull();
  });

  it('accepts a pre-deadline drop and never adds timeout during its reaction', () => {
    const { controller, input } = setup();
    input.down(1, CAT, 8_990);
    input.up(1, TRAY, 8_999);
    controller.advance(9_500);
    expect(controller.snapshot().outcomes).toHaveLength(1);
    expect(controller.snapshot().outcomes[0]?.reason).toBe('correct');
  });
});

function wipeSetup() {
  const { controller } = setup();
  controller.submit('cat-photo', 'tray', 1_100);
  controller.advance(1_700);
  controller.ready(1_700);
  controller.advance(2_700);
  controller.submit('cat-photo', 'photos', 2_710);
  controller.submit('note', 'documents', 2_720);
  controller.advance(3_320);
  controller.ready(3_320);
  controller.advance(4_320);
  const input = new FinderPointerInput(controller, () => ({ files: [], destinations: [] }));
  const mission = controller.snapshot().mission;
  if (mission?.kind !== 'wipe') throw new Error('Expected the live wipe mission');
  return { controller, input, stains: mission.stains };
}

describe('FinderPointerInput wipe strokes', () => {
  it('uses the full held segment for fast crossings, including the release segment', () => {
    const { controller, input, stains } = wipeSetup();
    const [first, second, third] = stains;
    if (!first || !second || !third) throw new Error('Expected three live stains');
    const beforeFirst = { x: first.x - first.radius - 10, y: first.y };
    const afterFirst = { x: first.x + first.radius + 10, y: first.y };
    const beforeSecond = { x: second.x - second.radius - 10, y: second.y };
    const afterSecond = { x: second.x + second.radius + 10, y: second.y };
    input.move(1, first, 4_330);
    expect(controller.snapshot().completedIds).toEqual([]);
    input.down(1, beforeFirst, 4_340);
    expect(controller.snapshot().completedIds).not.toContain(first.id);
    input.move(1, afterFirst, 4_350);
    input.up(1, afterFirst, 4_360);
    expect(controller.snapshot().completedIds).toContain(first.id);
    input.down(1, beforeSecond, 4_370);
    expect(controller.snapshot().completedIds).not.toContain(second.id);
    // No move event: the release itself must sweep the entire intervening segment.
    input.up(1, afterSecond, 4_380);
    expect(controller.snapshot().completedIds).toContain(second.id);
    click(input, third, 4_390);
    expect(controller.snapshot().successes).toBe(3);
    expect([...controller.snapshot().completedIds].sort()).toEqual(stains.map((stain) => stain.id).sort());
    expect(input.snapshot.drag).toBeNull();
  });

  it('clicks remove the same stains, while blank clicks are harmless', () => {
    const { controller, input, stains } = wipeSetup();
    click(input, { x: -100, y: -100 }, 4_330);
    expect(controller.snapshot().completedIds).toEqual([]);
    stains.forEach((stain, index) => click(input, stain, 4_350 + index * 20));
    expect(controller.snapshot().outcomes.at(-1)?.status).toBe('success');
    expect([...controller.snapshot().completedIds].sort()).toEqual(stains.map((stain) => stain.id).sort());
  });
});
