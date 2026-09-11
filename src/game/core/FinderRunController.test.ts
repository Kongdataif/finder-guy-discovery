import { describe, expect, it } from 'vitest';
import { BRIEFING_MS, FinderRunController, MISSION_MS, REACTION_MS } from './FinderRunController';
import type { Mission, PlayMode } from './types';

function playing(mode: PlayMode = 'normal') {
  const controller = new FinderRunController();
  controller.begin('ko', mode, 42, 0, 'practice');
  controller.ready(0);
  controller.advance(BRIEFING_MS);
  return controller;
}

function solve(controller: FinderRunController, now: number) {
  const mission = controller.snapshot().mission!;
  if (mission.kind === 'find') controller.submit(mission.targetFileId, mission.destinationId, now);
  else if (mission.kind === 'sort') {
    for (const fileId of mission.requiredFileIds) controller.submit(fileId, mission.expectedFolderByFileId[fileId]!, now);
  } else if (mission.kind === 'wipe') {
    for (const stain of mission.stains) controller.stroke(stain, stain, now);
  }
}

function enterNext(controller: FinderRunController, now: number): number {
  controller.advance(now + REACTION_MS);
  expect(controller.snapshot().phase).toBe('tutorial');
  controller.ready(now + REACTION_MS);
  controller.advance(now + REACTION_MS + BRIEFING_MS);
  return now + REACTION_MS + BRIEFING_MS;
}

describe('mission selection and submissions', () => {
  it('changing selection, clearing, and dropping outside destinations never fail', () => {
    const controller = playing();
    controller.select('dog-photo', 1_000);
    controller.select('cat-photo', 1_050);
    controller.select(null, 1_100);
    expect(controller.submit('dog-photo', 'outside', 1_150)).toEqual({ accepted: false, reason: 'invalid-destination' });
    expect(controller.snapshot()).toMatchObject({ phase: 'playing', selectedId: null, outcomes: [] });
    expect(controller.submit('cat-photo', 'tray', 1_200)).toEqual({ accepted: true, reason: 'correct' });
    expect(controller.snapshot()).toMatchObject({ phase: 'resolving', successes: 1 });
  });

  it('click-selection and direct drag submission produce identical outcomes', () => {
    const click = playing();
    const drag = playing();
    click.select('cat-photo', 1_000);
    click.submit(click.snapshot().selectedId!, 'tray', 1_010);
    drag.submit('cat-photo', 'tray', 1_010);
    expect(click.snapshot()).toEqual(drag.snapshot());
  });

  it('locks sorted files and requires all files, using neutral IDs', () => {
    const controller = playing();
    solve(controller, 1_000);
    const now = enterNext(controller, 1_000);
    expect(controller.submit('cat-photo', 'photos', now).reason).toBe('progress');
    expect(controller.select('cat-photo', now).reason).toBe('locked');
    expect(controller.submit('cat-photo', 'documents', now).reason).toBe('locked');
    expect(controller.snapshot()).toMatchObject({ phase: 'playing', completedIds: ['cat-photo'], successes: 1 });
    controller.submit('note', 'documents', now + 1);
    expect(controller.snapshot()).toMatchObject({ phase: 'resolving', successes: 2 });
  });

  it('wrong confirmed file and folder each produce one failure', () => {
    const controller = playing();
    controller.submit('dog-photo', 'tray', 1_000);
    controller.submit('cat-photo', 'tray', 1_000);
    expect(controller.snapshot().outcomes.map((outcome) => outcome.reason)).toEqual(['wrong-file']);
    const now = enterNext(controller, 1_000);
    controller.submit('note', 'photos', now);
    controller.advance(now + 1);
    expect(controller.snapshot().outcomes.map((outcome) => outcome.reason)).toEqual(['wrong-file', 'wrong-folder']);
  });
});

describe('active time and terminal boundaries', () => {
  it.each([-1, 0, 1])('uses strict elapsed < deadline at deadline %+d ms', (offset) => {
    const controller = playing();
    const result = controller.submit('cat-photo', 'tray', BRIEFING_MS + MISSION_MS.normal + offset);
    expect(result.accepted).toBe(offset < 0);
    expect(controller.snapshot().outcomes.map((outcome) => outcome.reason)).toEqual([offset < 0 ? 'correct' : 'timeout']);
    controller.advance(BRIEFING_MS + MISSION_MS.normal + 10);
    controller.submit('dog-photo', 'tray', BRIEFING_MS + MISSION_MS.normal + 11);
    expect(controller.snapshot().outcomes).toHaveLength(1);
  });

  it('does not run gameplay time in tutorials, briefing, reaction, or results', () => {
    const controller = new FinderRunController();
    controller.begin('en', 'normal', 1, 0, 'practice');
    controller.advance(50_000);
    expect(controller.snapshot()).toMatchObject({ phase: 'tutorial', elapsedMs: 0, remainingMs: 8_000 });
    controller.ready(50_000);
    controller.advance(50_999);
    expect(controller.snapshot()).toMatchObject({ phase: 'briefing', elapsedMs: 0, remainingMs: 8_000 });
    controller.advance(51_000);
    solve(controller, 51_100);
    controller.advance(51_699);
    expect(controller.snapshot()).toMatchObject({ phase: 'resolving', elapsedMs: 100, remainingMs: 7_900 });
    let now = enterNext(controller, 51_100);
    solve(controller, now);
    now = enterNext(controller, now);
    solve(controller, now);
    controller.advance(now + REACTION_MS);
    const result = controller.snapshot();
    controller.advance(now + 500_000);
    expect(controller.snapshot()).toEqual(result);
  });

  it('freezes active time through pause and waits for explicit resume', () => {
    const controller = playing();
    controller.advance(2_500);
    controller.select('cat-photo', 2_500);
    controller.pause(2_500);
    controller.advance(92_500);
    expect(controller.snapshot()).toMatchObject({ paused: true, selectedId: null, elapsedMs: 1_500, remainingMs: 6_500 });
    expect(controller.submit('cat-photo', 'tray', 92_500).reason).toBe('paused');
    controller.resume(100_000);
    controller.advance(101_000);
    expect(controller.snapshot()).toMatchObject({ paused: false, elapsedMs: 2_500, remainingMs: 5_500 });
    controller.advance(99_000);
    expect(controller.snapshot().elapsedMs).toBe(2_500);
  });

  it('freezes briefing and reaction time as well as gameplay', () => {
    const controller = new FinderRunController();
    controller.begin('ko', 'normal', 1, 0, 'practice');
    controller.ready(0);
    controller.pause(500);
    controller.resume(20_000);
    expect(controller.snapshot().phaseRemainingMs).toBe(500);
    controller.advance(20_500);
    solve(controller, 20_500);
    controller.pause(20_700);
    controller.resume(40_000);
    expect(controller.snapshot()).toMatchObject({ phase: 'resolving', phaseRemainingMs: 400 });
    controller.advance(40_400);
    expect(controller.snapshot().phase).toBe('tutorial');
  });

  it('uses 12 seconds for relaxed mode and keeps it fixed across the run', () => {
    const controller = playing('relaxed');
    controller.advance(9_000);
    expect(controller.snapshot()).toMatchObject({ phase: 'playing', remainingMs: 4_000, mode: 'relaxed' });
    controller.advance(13_000);
    expect(controller.snapshot().outcome?.reason).toBe('timeout');
    const now = enterNext(controller, 13_000);
    expect(controller.snapshot()).toMatchObject({ mode: 'relaxed', locale: 'ko', remainingMs: 12_000 });
    expect(now).toBe(14_600);
  });
});

describe('complete runs and restart isolation', () => {
  it.each([true, false])('reaches normal results after all three missions, all-success=%s', (succeed) => {
    const controller = playing();
    let now = BRIEFING_MS;
    for (let missionIndex = 0; missionIndex < 3; missionIndex++) {
      if (succeed) solve(controller, now);
      else {
        now += MISSION_MS.normal;
        controller.advance(now);
      }
      if (missionIndex < 2) now = enterNext(controller, now);
    }
    controller.advance(now + REACTION_MS);
    expect(controller.snapshot()).toMatchObject({ phase: 'result', missionCount: 3, successes: succeed ? 3 : 0 });
    expect(controller.snapshot().outcomes).toHaveLength(3);
  });

  it('rejects previous mission gestures and callbacks without advancing the new clock', () => {
    const controller = playing();
    const token = controller.captureToken();
    solve(controller, 1_000);
    const now = enterNext(controller, 1_000);
    const before = controller.snapshot();
    expect(controller.submit('cat-photo', 'photos', now + 90_000, token).reason).toBe('stale');
    expect(controller.stroke({ x: 0, y: 0 }, { x: 500, y: 500 }, now + 90_000, token).reason).toBe('stale');
    expect(controller.ready(now + 90_000, token)).toBe(false);
    expect(controller.snapshot()).toEqual(before);
  });

  it('does not allow an old ready action to start the next tutorial across a phase boundary', () => {
    const controller = playing();
    solve(controller, 1_000);
    expect(controller.ready(1_600, controller.captureToken())).toBe(false);
    expect(controller.snapshot().phase).toBe('tutorial');
  });

  it('resets partial sort/wipe, selections, paused state, outcomes, and callbacks over 5 restarts', () => {
    const controller = playing();
    let now = 1_000;
    for (let restart = 0; restart < 5; restart++) {
      controller.select('cat-photo', now);
      solve(controller, now);
      now = enterNext(controller, now);
      controller.submit('cat-photo', 'photos', now);
      if (restart % 2 === 0) {
        controller.submit('note', 'documents', now);
        now = enterNext(controller, now);
        const mission = controller.snapshot().mission!;
        if (mission.kind === 'wipe') controller.stroke(mission.stains[0]!, mission.stains[0]!, now);
      }
      controller.pause(now);
      const token = controller.captureToken();
      const oldRunId = token.runId;
      controller.begin('en', 'normal', restart, now, 'practice');
      expect(controller.snapshot()).toMatchObject({
        phase: 'tutorial', paused: false, locale: 'en', missionIndex: 0,
        selectedId: null, completedIds: [], elapsedMs: 0, remainingMs: 8_000,
        outcomes: [], successes: 0,
      });
      expect(controller.snapshot().runId).toBeGreaterThan(oldRunId);
      expect(controller.submit('cat-photo', 'tray', now + 80_000, token).reason).toBe('stale');
      controller.ready(now);
      now += BRIEFING_MS;
      controller.advance(now);
    }
    controller.reset(now);
    expect(controller.snapshot()).toMatchObject({ phase: 'lobby', mission: null, missionCount: 0, outcomes: [], paused: false });
  });

  it('exposes frozen snapshots that cannot alter answers or outcomes', () => {
    const controller = playing();
    solve(controller, 1_000);
    const snapshot = controller.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.outcomes)).toBe(true);
    expect(Object.isFrozen(snapshot.outcomes[0])).toBe(true);
    expect(Object.isFrozen(snapshot.completedIds)).toBe(true);
    expect(Object.isFrozen(snapshot.mission)).toBe(true);
  });
});

describe('wipe progress', () => {
  function atWipe() {
    const controller = playing();
    solve(controller, 1_000);
    let now = enterNext(controller, 1_000);
    solve(controller, now);
    now = enterNext(controller, now);
    return { controller, now, mission: controller.snapshot().mission as Extract<Mission, { kind: 'wipe' }> };
  }

  it('ignores blank clicks and repeated contact with an already cleaned stain', () => {
    const { controller, now, mission } = atWipe();
    expect(controller.stroke({ x: 0, y: 0 }, { x: 0, y: 0 }, now).reason).toBe('no-hit');
    expect(controller.stroke(mission.stains[0]!, mission.stains[0]!, now).reason).toBe('progress');
    expect(controller.stroke(mission.stains[0]!, mission.stains[0]!, now).reason).toBe('no-hit');
    expect(controller.snapshot()).toMatchObject({ phase: 'playing', completedIds: [mission.stains[0]!.id] });
  });

  it('fast swipes, slow swipes, and direct clicks reach the same success', () => {
    const fast = atWipe();
    const slow = atWipe();
    const click = atWipe();
    for (const stain of fast.mission.stains) {
      fast.controller.stroke({ x: stain.x - 45, y: stain.y }, { x: stain.x + 45, y: stain.y }, fast.now);
      for (let offset = -45; offset < 45; offset += 5) {
        slow.controller.stroke({ x: stain.x + offset, y: stain.y }, { x: stain.x + offset + 5, y: stain.y }, slow.now);
      }
      click.controller.stroke(stain, stain, click.now);
    }
    expect(fast.controller.snapshot().outcomes).toEqual(click.controller.snapshot().outcomes);
    expect(slow.controller.snapshot().outcomes).toEqual(click.controller.snapshot().outcomes);
    expect(click.controller.snapshot()).toMatchObject({ phase: 'resolving', successes: 3 });
  });
});
