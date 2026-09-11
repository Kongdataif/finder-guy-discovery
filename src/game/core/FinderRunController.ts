import { createMissions, segmentIntersectsStain } from './missions';
import type {
  CommandToken, InputResult, Locale, Mission, MissionOutcome, OutcomeReason,
  PlayMode, Point, RunPhase, RunSnapshot, RunKind, MissionKind, Lane, VirtualFile,
} from './types';

export const BRIEFING_MS = 1_000;
export const REACTION_MS = 600;
export const MISSION_MS = { normal: 8_000, relaxed: 12_000 } as const;

/** Pure session state; callers supply monotonic timestamps and draw snapshots. */
export class FinderRunController {
  private runId = 0;
  private phase: RunPhase = 'lobby';
  private paused = false;
  private locale: Locale = 'ko';
  private mode: PlayMode = 'normal';
  private runKind: RunKind = 'regular';
  private seed = 0;
  private missions: readonly Mission[] = [];
  private missionIndex = 0;
  private selectedId: string | null = null;
  private selectedIds = new Set<string>();
  private bossStep = 0;
  private catchLane: Lane = 1;
  private catchIndex = 0;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private seenKinds = new Set<MissionKind>();
  private completedIds = new Set<string>();
  private outcomes: MissionOutcome[] = [];
  private elapsedMs = 0;
  private phaseElapsedMs = 0;
  private lastNow = 0;

  begin(locale: Locale, mode: PlayMode, seed: number, now: number, runKind: RunKind = 'regular'): RunSnapshot {
    this.assertTime(now);
    if (locale !== 'ko' && locale !== 'en') throw new Error('Unsupported locale');
    if (mode !== 'normal' && mode !== 'relaxed') throw new Error('Unsupported mode');
    // Validate a complete, fixed set before replacing a currently running session.
    const missions = createMissions(seed, runKind);
    this.clear(now);
    this.locale = locale;
    this.mode = mode;
    this.runKind = runKind;
    this.seed = seed;
    this.missions = missions;
    this.phase = 'tutorial';
    this.seenKinds.add(missions[0]!.kind);
    return this.snapshot();
  }

  reset(now: number): RunSnapshot {
    this.assertTime(now);
    this.clear(now);
    this.locale = 'ko';
    this.mode = 'normal';
    this.seed = 0;
    this.runKind = 'regular';
    return this.snapshot();
  }

  private clear(now: number): void {
    this.runId++;
    this.phase = 'lobby';
    this.paused = false;
    this.missions = [];
    this.missionIndex = 0;
    this.selectedId = null;
    this.selectedIds = new Set();
    this.bossStep = 0;
    this.catchLane = 1;
    this.catchIndex = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.seenKinds = new Set();
    this.completedIds = new Set();
    this.outcomes = [];
    this.elapsedMs = 0;
    this.phaseElapsedMs = 0;
    this.lastNow = now;
  }

  captureToken(): CommandToken {
    return Object.freeze({ runId: this.runId, missionId: this.currentMission?.id ?? null, bossStep: this.bossStep });
  }

  ready(now: number, token?: CommandToken): boolean {
    if (this.isStale(token)) return false;
    const before = this.captureToken();
    this.advance(now);
    if (this.isStale(before)) return false;
    if (this.paused || this.phase !== 'tutorial') return false;
    this.phase = 'briefing';
    this.phaseElapsedMs = 0;
    return true;
  }

  pause(now: number): boolean {
    this.advance(now);
    if (this.phase === 'lobby' || this.phase === 'result' || this.paused) return false;
    this.paused = true;
    this.selectedId = null;
    return true;
  }

  resume(now: number): boolean {
    this.advance(now);
    if (!this.paused) return false;
    this.paused = false;
    return true;
  }

  advance(now: number): RunSnapshot {
    this.assertTime(now);
    let delta = Math.max(0, now - this.lastNow);
    this.lastNow = Math.max(this.lastNow, now);
    if (this.paused) return this.snapshot();
    while (delta > 0) {
      if (this.phase === 'lobby' || this.phase === 'tutorial' || this.phase === 'result') break;
      if (this.phase === 'playing') {
        const mission = this.currentMission!;
        const catchAt = mission.kind === 'catch'
          ? (this.catchIndex + 1) * (mission.previewMs + mission.fallMs) * this.modeScale : Infinity;
        const nextEventAt = Math.min(this.deadlineMs, catchAt);
        const consumed = Math.min(delta, nextEventAt - this.elapsedMs);
        this.elapsedMs += consumed;
        delta -= consumed;
        if (this.elapsedMs >= this.deadlineMs) this.finish('timeout');
        else if (mission.kind === 'catch' && this.elapsedMs >= catchAt) {
          if (mission.lanes[this.catchIndex] !== this.catchLane) this.finish('missed-file');
          else {
            this.completedIds.add(`catch-${this.catchIndex}`);
            this.catchIndex++;
            if (this.catchIndex === mission.lanes.length) this.finish('correct');
          }
        }
        else break;
      } else {
        const duration = this.phase === 'briefing' ? BRIEFING_MS : REACTION_MS;
        const consumed = Math.min(delta, duration - this.phaseElapsedMs);
        this.phaseElapsedMs += consumed;
        delta -= consumed;
        if (this.phaseElapsedMs < duration) break;
        if (this.phase === 'briefing') {
          this.phase = 'playing';
          this.phaseElapsedMs = 0;
        } else {
          this.nextMission();
        }
      }
    }
    return this.snapshot();
  }

  select(fileId: string | null, now: number, token?: CommandToken): InputResult {
    const blocked = this.guard(now, token);
    if (blocked) return blocked;
    const mission = this.currentMission!;
    const files = this.currentFiles;
    if (!files) return { accepted: false, reason: 'wrong-kind' };
    if (fileId === null) {
      this.selectedId = null;
      if (mission.kind === 'bundle') this.selectedIds.clear();
      return { accepted: true, reason: 'cleared' };
    }
    if (!files.some((file) => file.id === fileId)) return { accepted: false, reason: 'invalid-file' };
    if (mission.kind === 'sort' && this.completedIds.has(fileId)) return { accepted: false, reason: 'locked' };
    if (mission.kind === 'bundle') {
      if (this.selectedIds.has(fileId)) this.selectedIds.delete(fileId);
      else this.selectedIds.add(fileId);
      this.selectedId = null;
      return { accepted: true, reason: 'selected' };
    }
    this.selectedId = fileId;
    return { accepted: true, reason: 'selected' };
  }

  /** Both click-to-place and drag-to-place call this exact operation. */
  submit(fileId: string, destinationId: string, now: number, token?: CommandToken): InputResult {
    const blocked = this.guard(now, token);
    if (blocked) return blocked;
    const mission = this.currentMission!;
    const files = this.currentFiles;
    if (!files || mission.kind === 'wipe' || mission.kind === 'catch') return { accepted: false, reason: 'wrong-kind' };
    if (!files.some((file) => file.id === fileId)) return { accepted: false, reason: 'invalid-file' };
    if (mission.kind === 'sort' && this.completedIds.has(fileId)) return { accepted: false, reason: 'locked' };
    if (mission.kind === 'bundle') {
      if (destinationId !== mission.destinationId) return { accepted: false, reason: 'invalid-destination' };
      this.selectedIds.add(fileId);
      this.selectedId = null;
      return { accepted: true, reason: 'progress' };
    }
    if (mission.kind === 'boss') {
      const step = mission.steps[this.bossStep]!;
      if (!step.allowedDestinationIds.includes(destinationId)) return { accepted: false, reason: 'invalid-destination' };
      if (destinationId !== step.destinationId) {
        this.finish('wrong-folder');
        return { accepted: true, reason: 'wrong-folder' };
      }
      if (fileId !== step.targetFileId) {
        this.finish('wrong-file');
        return { accepted: true, reason: 'wrong-file' };
      }
      this.completedIds.add(`boss-step-${this.bossStep}`);
      this.selectedId = null;
      if (this.bossStep === 2) {
        this.finish('correct');
        return { accepted: true, reason: 'correct' };
      }
      this.bossStep++;
      return { accepted: true, reason: 'progress' };
    }
    if (mission.kind === 'find' || mission.kind === 'latest') {
      if (destinationId !== mission.destinationId) return { accepted: false, reason: 'invalid-destination' };
      const reason = fileId === mission.targetFileId ? 'correct' : 'wrong-file';
      if (reason === 'correct') this.completedIds.add(fileId);
      this.finish(reason);
      return { accepted: true, reason };
    }
    if (!mission.folders.some((folder) => folder.id === destinationId)) {
      return { accepted: false, reason: 'invalid-destination' };
    }
    if (mission.expectedFolderByFileId[fileId] !== destinationId) {
      this.finish('wrong-folder');
      return { accepted: true, reason: 'wrong-folder' };
    }
    this.completedIds.add(fileId);
    this.selectedId = null;
    if (mission.requiredFileIds.every((id) => this.completedIds.has(id))) {
      this.finish('correct');
      return { accepted: true, reason: 'correct' };
    }
    return { accepted: true, reason: 'progress' };
  }

  confirmBundle(now: number, token?: CommandToken): InputResult {
    const blocked = this.guard(now, token);
    if (blocked) return blocked;
    const mission = this.currentMission!;
    if (mission.kind !== 'bundle') return { accepted: false, reason: 'wrong-kind' };
    const correct = this.selectedIds.size === mission.targetFileIds.length && mission.targetFileIds.every((id) => this.selectedIds.has(id));
    const reason = correct ? 'correct' : 'wrong-bundle';
    if (correct) mission.targetFileIds.forEach((id) => this.completedIds.add(id));
    this.finish(reason);
    return { accepted: true, reason };
  }

  selectLane(lane: Lane, now: number, token?: CommandToken): InputResult {
    const blocked = this.guard(now, token);
    if (blocked) return blocked;
    if (this.currentMission?.kind !== 'catch') return { accepted: false, reason: 'wrong-kind' };
    if (![0, 1, 2].includes(lane)) return { accepted: false, reason: 'invalid-lane' };
    this.catchLane = lane;
    return { accepted: true, reason: 'selected' };
  }

  stroke(from: Point, to: Point, now: number, token?: CommandToken): InputResult {
    const blocked = this.guard(now, token);
    if (blocked) return blocked;
    const mission = this.currentMission!;
    if (mission.kind !== 'wipe') return { accepted: false, reason: 'wrong-kind' };
    if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) {
      return { accepted: false, reason: 'invalid-point' };
    }
    const before = this.completedIds.size;
    for (const stain of mission.stains) {
      if (segmentIntersectsStain(from, to, stain)) this.completedIds.add(stain.id);
    }
    if (mission.stains.every((stain) => this.completedIds.has(stain.id))) {
      this.finish('correct');
      return { accepted: true, reason: 'correct' };
    }
    return { accepted: true, reason: this.completedIds.size > before ? 'progress' : 'no-hit' };
  }

  snapshot(): RunSnapshot {
    const phaseRemainingMs = this.phase === 'briefing' ? BRIEFING_MS - this.phaseElapsedMs
      : this.phase === 'resolving' ? REACTION_MS - this.phaseElapsedMs
        : this.phase === 'playing' ? Math.max(0, this.deadlineMs - this.elapsedMs) : null;
    const mission = this.currentMission;
    const successes = this.outcomes.filter((outcome) => outcome.status === 'success').length;
    const handledFileIds = new Set<string>();
    for (const outcome of this.outcomes) {
      if (outcome.status !== 'success') continue;
      const completedMission = this.missions.find((candidate) => candidate.id === outcome.missionId)!;
      switch (completedMission.kind) {
        case 'find': case 'latest': handledFileIds.add(completedMission.targetFileId); break;
        case 'sort': completedMission.requiredFileIds.forEach((id) => handledFileIds.add(id)); break;
        case 'bundle': completedMission.targetFileIds.forEach((id) => handledFileIds.add(id)); break;
        case 'catch': handledFileIds.add('note'); break;
        case 'boss': completedMission.steps.forEach((step) => handledFileIds.add(step.targetFileId)); break;
        case 'wipe': break;
      }
    }
    let catchNext: RunSnapshot['catchNext'] = null;
    if (mission?.kind === 'catch' && this.catchIndex < mission.lanes.length) {
      const localElapsed = this.elapsedMs / this.modeScale - this.catchIndex * (mission.previewMs + mission.fallMs);
      catchNext = Object.freeze({ lane: mission.lanes[this.catchIndex]!, preview: localElapsed < mission.previewMs,
        progress: Math.max(0, Math.min(1, (localElapsed - mission.previewMs) / mission.fallMs)) });
    }
    return Object.freeze({
      runId: this.runId, missionId: mission?.id ?? null,
      phase: this.phase, paused: this.paused, locale: this.locale, mode: this.mode, seed: this.seed, runKind: this.runKind,
      missionIndex: this.missionIndex, missionCount: this.missions.length,
      successes, score: this.score, combo: this.combo, maxCombo: this.maxCombo,
      goalAchieved: this.runKind === 'regular' && successes >= 7,
      selectedIds: Object.freeze([...this.selectedIds]), bossStep: this.bossStep,
      handledFileIds: Object.freeze([...handledFileIds]),
      catchLane: this.catchLane, catchIndex: this.catchIndex, catchNext,
      selectedId: this.selectedId, completedIds: Object.freeze([...this.completedIds]),
      elapsedMs: this.elapsedMs, remainingMs: Math.max(0, this.deadlineMs - this.elapsedMs),
      deadlineMs: this.deadlineMs, phaseRemainingMs, mission,
      outcome: this.outcomes.find((outcome) => outcome.missionId === mission?.id) ?? null,
      outcomes: Object.freeze([...this.outcomes]),
    });
  }

  private guard(now: number, token?: CommandToken): InputResult | null {
    // An old pointer/callback cannot even advance a new session's clock.
    if (this.isStale(token)) return { accepted: false, reason: 'stale' };
    const before = this.captureToken();
    this.advance(now);
    if (this.isStale(before)) return { accepted: false, reason: 'stale' };
    if (this.paused) return { accepted: false, reason: 'paused' };
    if (this.phase !== 'playing') return { accepted: false, reason: 'inactive' };
    return null;
  }

  private isStale(token?: CommandToken): boolean {
    return token !== undefined && (token.runId !== this.runId || token.missionId !== (this.currentMission?.id ?? null) || token.bossStep !== this.bossStep);
  }

  private finish(reason: OutcomeReason): void {
    if (this.phase !== 'playing' || !this.currentMission) return;
    this.combo = reason === 'correct' ? this.combo + 1 : 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const score = reason === 'correct' ? 100 + Math.min(this.combo - 1, 3) * 10 : 0;
    this.score += score;
    this.outcomes.push(Object.freeze({
      missionId: this.currentMission.id, kind: this.currentMission.kind,
      status: reason === 'correct' ? 'success' : 'failure', reason, score,
    }));
    this.selectedId = null;
    this.phase = 'resolving';
    this.phaseElapsedMs = 0;
  }

  private nextMission(): void {
    this.selectedId = null;
    this.selectedIds.clear();
    this.bossStep = 0;
    this.catchLane = 1;
    this.catchIndex = 0;
    this.completedIds.clear();
    this.phaseElapsedMs = 0;
    if (this.missionIndex + 1 === this.missions.length) {
      this.phase = 'result';
      return;
    }
    this.missionIndex++;
    this.elapsedMs = 0;
    const nextKind = this.currentMission!.kind;
    this.phase = this.seenKinds.has(nextKind) ? 'briefing' : 'tutorial';
    this.seenKinds.add(nextKind);
  }

  private get currentMission(): Mission | null {
    return this.missions[this.missionIndex] ?? null;
  }

  private get modeScale(): number { return this.mode === 'relaxed' ? 1.5 : 1; }

  private get deadlineMs(): number { return (this.currentMission?.baseDeadlineMs ?? 8_000) * this.modeScale; }

  private get currentFiles(): readonly VirtualFile[] | null {
    const mission = this.currentMission;
    if (!mission || mission.kind === 'wipe' || mission.kind === 'catch') return null;
    return mission.kind === 'boss' ? mission.steps[this.bossStep]!.files : mission.files;
  }

  private assertTime(now: number): void {
    if (!Number.isFinite(now)) throw new Error('Timestamp must be finite');
  }
}
