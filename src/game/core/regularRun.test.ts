import { describe, expect, it } from 'vitest';
import { FinderRunController } from './FinderRunController';
import { createMissions, validateMission, BASIC_KINDS } from './missions';
import { FinderPointerInput } from './PointerGestures';
import type { BossMission, CatchMission, Lane, LatestMission, PlayMode } from './types';

function start(mode: PlayMode = 'normal', seed = 42) {
  const controller = new FinderRunController();
  controller.begin('en', mode, seed, 0);
  controller.ready(0);
  controller.advance(1_000);
  return { controller, now: 1_000 };
}

function solve(controller: FinderRunController, now: number): number {
  const state = controller.snapshot();
  const mission = state.mission!;
  switch (mission.kind) {
    case 'find': case 'latest': controller.submit(mission.targetFileId, mission.destinationId, now); break;
    case 'sort': mission.requiredFileIds.forEach((id) => controller.submit(id, mission.expectedFolderByFileId[id]!, now)); break;
    case 'wipe': mission.stains.forEach((stain) => controller.stroke(stain, stain, now)); break;
    case 'bundle':
      mission.targetFileIds.forEach((id) => controller.select(id, now));
      controller.confirmBundle(now);
      break;
    case 'boss':
      mission.steps.forEach((step) => controller.submit(step.targetFileId, step.destinationId, now));
      break;
    case 'catch': {
      const began = now - state.elapsedMs;
      const cycle = (mission.previewMs + mission.fallMs) * (state.mode === 'relaxed' ? 1.5 : 1);
      mission.lanes.forEach((lane, index) => {
        controller.selectLane(lane, now);
        now = began + (index + 1) * cycle;
        controller.advance(now);
      });
      break;
    }
  }
  expect(controller.snapshot().phase).toBe('resolving');
  return now;
}

function fail(controller: FinderRunController, now: number): number {
  const state = controller.snapshot();
  const mission = state.mission!;
  switch (mission.kind) {
    case 'find': case 'latest': controller.submit(mission.files.find((file) => file.id !== mission.targetFileId)!.id, mission.destinationId, now); break;
    case 'sort': {
      const id = mission.requiredFileIds[0]!;
      controller.submit(id, mission.folders.find((folder) => folder.id !== mission.expectedFolderByFileId[id])!.id, now);
      break;
    }
    case 'wipe': now += state.remainingMs; controller.advance(now); break;
    case 'bundle': controller.confirmBundle(now); break;
    case 'boss': controller.submit('dog-photo', 'tray', now); break;
    case 'catch':
      controller.selectLane(((mission.lanes[0]! + 1) % 3) as Lane, now);
      now += (mission.previewMs + mission.fallMs) * (state.mode === 'relaxed' ? 1.5 : 1);
      controller.advance(now);
      break;
  }
  expect(controller.snapshot().phase).toBe('resolving');
  return now;
}

function next(controller: FinderRunController, now: number): number {
  now += 600;
  controller.advance(now);
  if (controller.snapshot().phase === 'tutorial') controller.ready(now);
  if (controller.snapshot().phase === 'briefing') { now += 1_000; controller.advance(now); }
  return now;
}

function at(index: number, mode: PlayMode = 'normal', seed = 42) {
  const run = start(mode, seed);
  for (let i = 0; i < index; i++) run.now = next(run.controller, solve(run.controller, run.now));
  return run;
}

describe('regular seeded schedule and data validation', () => {
  it('builds ten reproducible validated missions, six introductions, and nonadjacent variants', () => {
    const latestTargets = new Set<string>();
    for (let seed = 0; seed < 150; seed++) {
      const missions = createMissions(seed);
      expect(missions).toHaveLength(10);
      expect(missions).toEqual(createMissions(seed));
      expect(missions.slice(0, 6).map((mission) => mission.kind)).toEqual(BASIC_KINDS);
      expect(missions.map((mission) => mission.baseDeadlineMs)).toEqual([8000, 8000, 8000, 7000, 7000, 7000, 6000, 6000, 6000, 12000]);
      expect(new Set(missions.map((mission) => mission.id)).size).toBe(10);
      for (let i = 6; i < 9; i++) {
        expect(BASIC_KINDS).toContain(missions[i]!.kind);
        expect(missions[i]!.kind).not.toBe(missions[i - 1]!.kind);
      }
      missions.forEach((mission) => expect(() => validateMission(mission)).not.toThrow());
      latestTargets.add((missions[3] as LatestMission).targetFileId);
      expect(missions.at(-1)?.kind).toBe('boss');
    }
    // File names and positions cannot act as a hidden permanent answer.
    expect(latestTargets.size).toBe(3);
  });

  it('rejects tied/out-of-day latest times, impossible catch schedules, and broken boss destinations', () => {
    const missions = createMissions(1);
    const latest = missions[3] as LatestMission;
    expect(() => validateMission({ ...latest, files: latest.files.map((file) => ({ ...file, modifiedAt: 123 })) })).toThrow();
    expect(() => validateMission({ ...latest, files: latest.files.map((file, index) => ({ ...file, modifiedAt: index + 1440 })) })).toThrow();
    expect(() => validateMission({ ...latest, targetFileId: latest.files.find((file) => file.id !== latest.targetFileId)!.id })).toThrow();
    const catchMission = missions[5] as CatchMission;
    expect(() => validateMission({ ...catchMission, fallMs: 3000 })).toThrow();
    expect(() => validateMission({ ...catchMission, lanes: [0, 3, 1] as unknown as Lane[] })).toThrow();
    const boss = missions[9] as BossMission;
    expect(() => validateMission({ ...boss, steps: [{ ...boss.steps[0], allowedDestinationIds: ['desk'] }, boss.steps[1], boss.steps[2]] })).toThrow();
  });
});

describe('normal completion and scoring', () => {
  it.each(['normal', 'relaxed'] as const)('finishes all ten successfully in %s mode with capped combo scoring', (mode) => {
    const run = start(mode);
    for (let i = 0; i < 10; i++) run.now = next(run.controller, solve(run.controller, run.now));
    expect(run.controller.snapshot()).toMatchObject({ phase: 'result', runKind: 'regular', missionCount: 10,
      successes: 10, score: 1240, combo: 10, maxCombo: 10, goalAchieved: true, locale: 'en', mode });
    expect(run.controller.snapshot().outcomes.map((outcome) => outcome.score)).toEqual([100, 110, 120, 130, 130, 130, 130, 130, 130, 130]);
  });

  it('finishes a zero-success regular run, including a failed boss, without early exit', () => {
    const run = start();
    for (let i = 0; i < 10; i++) run.now = next(run.controller, fail(run.controller, run.now));
    expect(run.controller.snapshot()).toMatchObject({ phase: 'result', missionCount: 10, successes: 0, score: 0, maxCombo: 0, goalAchieved: false });
    expect(run.controller.snapshot().outcomes).toHaveLength(10);
  });

  it('keeps seven-success goal and earned points after later mistakes and a boss failure', () => {
    const run = start();
    for (let i = 0; i < 10; i++) run.now = next(run.controller, i < 7 ? solve(run.controller, run.now) : fail(run.controller, run.now));
    expect(run.controller.snapshot()).toMatchObject({ successes: 7, score: 850, combo: 0, maxCombo: 7, goalAchieved: true });
    expect(run.controller.snapshot().outcomes.at(-1)?.status).toBe('failure');
  });

  it('shows untimed tutorials only for first encounters, then sends variants directly to briefing', () => {
    const run = start();
    for (let i = 0; i < 9; i++) {
      run.now = solve(run.controller, run.now) + 600;
      run.controller.advance(run.now);
      expect(run.controller.snapshot().phase).toBe(i + 1 < 6 || i + 1 === 9 ? 'tutorial' : 'briefing');
      const state = run.controller.snapshot();
      if (state.phase === 'tutorial') {
        run.now += 50000;
        run.controller.advance(run.now);
        expect(run.controller.snapshot().elapsedMs).toBe(0);
        run.controller.ready(run.now);
      }
      run.now += 1000;
      run.controller.advance(run.now);
    }
  });
});

describe('bundle confirmation', () => {
  it('allows adding and removing candidates without judgment; checks exact set only on confirmation', () => {
    const { controller, now } = at(4);
    controller.select('note', now);
    controller.select('note', now);
    controller.select('cat-photo', now);
    controller.submit('dog-photo', 'bundle-tray', now);
    controller.submit('dog-photo', 'bundle-tray', now);
    expect(controller.snapshot()).toMatchObject({ selectedIds: ['cat-photo', 'dog-photo'], phase: 'playing', successes: 4 });
    expect(controller.confirmBundle(now).reason).toBe('correct');
    expect(controller.confirmBundle(now).accepted).toBe(false);
    expect(controller.snapshot().outcomes).toHaveLength(5);
  });

  it.each(['missing', 'extra'] as const)('fails a confirmed %s file set', (kind) => {
    const { controller, now } = at(4);
    controller.select('cat-photo', now);
    if (kind === 'extra') { controller.select('dog-photo', now); controller.select('note', now); }
    expect(controller.confirmBundle(now).reason).toBe('wrong-bundle');
  });

  it('preserves the reversible bundle through pause but clears it and stale callbacks on restart', () => {
    const { controller, now } = at(4);
    controller.select('cat-photo', now);
    const token = controller.captureToken();
    controller.pause(now);
    controller.resume(now + 40000);
    expect(controller.snapshot().selectedIds).toEqual(['cat-photo']);
    controller.begin('ko', 'relaxed', 7, now + 40000);
    expect(controller.confirmBundle(now + 99999, token).reason).toBe('stale');
    expect(controller.snapshot()).toMatchObject({ selectedIds: [], score: 0, combo: 0, maxCombo: 0, bossStep: 0, catchIndex: 0, catchLane: 1 });
  });
});

describe('serial catch timing and lane input', () => {
  it('retains handled files when a delayed frame skips the catch reaction, then clears them on reset', () => {
    const run = start();
    for (let index = 0; index < 5; index++) run.now = next(run.controller, fail(run.controller, run.now));
    expect(run.controller.snapshot().handledFileIds).toEqual([]);
    const mission = run.controller.snapshot().mission as CatchMission;
    const began = run.now;
    mission.lanes.forEach((lane, index) => {
      run.controller.selectLane(lane, run.now);
      run.now = began + (index + 1) * 1500;
      if (index < 2) run.controller.advance(run.now);
    });
    run.controller.advance(run.now + 650);
    const after = run.controller.snapshot();
    expect(after.phase).toBe('briefing');
    expect(after.missionId).not.toBe('catch');
    expect(after.outcomes.at(-1)).toMatchObject({ kind: 'catch', status: 'success' });
    expect(after.handledFileIds).toEqual(['note']);
    expect(Object.isFrozen(after.handledFileIds)).toBe(true);
    run.controller.reset(run.now + 1000);
    expect(run.controller.snapshot().handledFileIds).toEqual([]);
  });

  it.each(['normal', 'relaxed'] as const)('scales preview, fall, and deadline together in %s mode', (mode) => {
    const { controller, now } = at(5, mode);
    const scale = mode === 'relaxed' ? 1.5 : 1;
    const lane = controller.snapshot().catchNext!.lane;
    controller.selectLane(lane, now);
    controller.advance(now + 299 * scale);
    expect(controller.snapshot().catchNext?.preview).toBe(true);
    controller.advance(now + 900 * scale);
    expect(controller.snapshot().catchNext).toMatchObject({ preview: false, progress: 0.5 });
    controller.pause(now + 900 * scale);
    const paused = controller.snapshot();
    controller.advance(now + 900 * scale + 50000);
    expect(controller.snapshot()).toEqual(paused);
    controller.resume(now + 900 * scale + 50000);
    controller.advance(now + 1500 * scale + 50000);
    expect(controller.snapshot()).toMatchObject({ catchIndex: 1, deadlineMs: 7000 * scale });
  });

  it('accepts a lane change one millisecond before landing but rejects one at landing', () => {
    const early = at(5);
    const late = at(5);
    const wanted = early.controller.snapshot().catchNext!.lane;
    const wrong = ((wanted + 1) % 3) as Lane;
    early.controller.selectLane(wrong, early.now);
    early.controller.selectLane(wanted, early.now + 1499);
    early.controller.advance(early.now + 1500);
    expect(early.controller.snapshot().catchIndex).toBe(1);
    late.controller.selectLane(wrong, late.now);
    expect(late.controller.selectLane(wanted, late.now + 1500).accepted).toBe(false);
    expect(late.controller.snapshot().outcome?.reason).toBe('missed-file');
    late.controller.advance(late.now + 1501);
    expect(late.controller.snapshot().outcomes).toHaveLength(6);
  });

  it('clicks and held drags choose lanes; unpressed movement and a second pointer do not', () => {
    const { controller, now } = at(5);
    const input = new FinderPointerInput(controller, () => ({ files: [], destinations: [], lanes: [0, 1, 2].map((lane) => ({ lane: lane as Lane, rect: { x: lane * 100, y: 0, width: 99, height: 100 } })) }));
    input.move(1, { x: 20, y: 20 }, now);
    expect(controller.snapshot().catchLane).toBe(1);
    input.down(1, { x: 20, y: 20 }, now);
    expect(controller.snapshot().catchLane).toBe(0);
    input.down(2, { x: 220, y: 20 }, now);
    input.move(2, { x: 220, y: 20 }, now);
    expect(controller.snapshot().catchLane).toBe(0);
    input.move(1, { x: 220, y: 20 }, now);
    input.up(1, { x: 220, y: 20 }, now);
    expect(controller.snapshot().catchLane).toBe(2);
    input.move(1, { x: 20, y: 20 }, now);
    expect(controller.snapshot().catchLane).toBe(2);
  });
});

describe('boss fixed steps and shared deadline', () => {
  it('locks each completed step, invalidates its token, and keeps one shared clock', () => {
    const { controller, now } = at(9);
    const token = controller.captureToken();
    controller.submit('cat-photo', 'tray', now + 1000, token);
    expect(controller.snapshot()).toMatchObject({ bossStep: 1, completedIds: ['boss-step-0'], remainingMs: 11000 });
    expect(controller.submit('cat-photo', 'photos', now + 5000, token).reason).toBe('stale');
    expect(controller.snapshot().remainingMs).toBe(11000);
    controller.submit('cat-photo', 'photos', now + 3000, controller.captureToken());
    expect(controller.snapshot()).toMatchObject({ bossStep: 2, remainingMs: 9000, phase: 'playing' });
    controller.submit('photo-folder', 'desk', now + 11999, controller.captureToken());
    expect(controller.snapshot()).toMatchObject({ phase: 'resolving', successes: 10 });
    expect(controller.snapshot().completedIds).toEqual(['boss-step-0', 'boss-step-1', 'boss-step-2']);
  });

  it('fails a wrong visible folder and rejects the exact shared deadline', () => {
    const wrong = at(9);
    wrong.controller.submit('cat-photo', 'tray', wrong.now);
    expect(wrong.controller.submit('cat-photo', 'documents', wrong.now).reason).toBe('wrong-folder');
    const late = at(9);
    late.controller.submit('cat-photo', 'tray', late.now + 1000);
    late.controller.submit('cat-photo', 'photos', late.now + 2000);
    expect(late.controller.submit('photo-folder', 'desk', late.now + 12000).accepted).toBe(false);
    expect(late.controller.snapshot().outcome?.reason).toBe('timeout');
    expect(late.controller.snapshot().outcomes).toHaveLength(10);
  });

  it('restarts boss state and every session value repeatedly without carrying stale commands', () => {
    const { controller, now } = at(9);
    controller.submit('cat-photo', 'tray', now);
    for (let i = 0; i < 5; i++) {
      const token = controller.captureToken();
      controller.begin('ko', 'relaxed', i, now);
      expect(controller.submit('cat-photo', 'photos', now + 100000, token).reason).toBe('stale');
      expect(controller.snapshot()).toMatchObject({ phase: 'tutorial', runKind: 'regular', missionCount: 10, successes: 0, outcomes: [],
        bossStep: 0, score: 0, combo: 0, maxCombo: 0, catchLane: 1, catchIndex: 0, selectedIds: [], selectedId: null, completedIds: [], elapsedMs: 0 });
    }
  });
});
