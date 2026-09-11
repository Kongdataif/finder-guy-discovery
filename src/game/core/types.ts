export type Locale = 'ko' | 'en';
export type PlayMode = 'normal' | 'relaxed';
export type RunKind = 'regular' | 'practice';
export type MissionKind = 'find' | 'sort' | 'wipe' | 'latest' | 'bundle' | 'catch' | 'boss';
export type Lane = 0 | 1 | 2;
export type RunPhase = 'lobby' | 'tutorial' | 'briefing' | 'playing' | 'resolving' | 'result';
export type FileKind = 'photo' | 'document';
export type FileIcon = 'cat' | 'dog' | 'note' | 'pdf' | 'folder';

export interface VirtualFile {
  readonly id: string;
  readonly kind: FileKind;
  readonly icon: FileIcon;
  /** Visible minute of one shared day, for latest-file comparisons. */
  readonly modifiedAt?: number;
}

export interface VirtualFolder {
  readonly id: string;
  readonly kind: FileKind;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Stain extends Point {
  readonly id: string;
  readonly radius: number;
}

export interface MissionBase {
  readonly id: string;
  readonly baseDeadlineMs: number;
}

export interface FindMission extends MissionBase {
  readonly kind: 'find';
  readonly files: readonly VirtualFile[];
  readonly targetFileId: string;
  readonly destinationId: string;
}

export interface SortMission extends MissionBase {
  readonly kind: 'sort';
  readonly files: readonly VirtualFile[];
  readonly folders: readonly VirtualFolder[];
  readonly requiredFileIds: readonly string[];
  readonly expectedFolderByFileId: Readonly<Record<string, string>>;
}

export interface WipeMission extends MissionBase {
  readonly kind: 'wipe';
  readonly stains: readonly Stain[];
}

export interface LatestMission extends MissionBase {
  readonly kind: 'latest';
  readonly files: readonly VirtualFile[];
  readonly targetFileId: string;
  readonly destinationId: string;
}

export interface BundleMission extends MissionBase {
  readonly kind: 'bundle';
  readonly files: readonly VirtualFile[];
  readonly targetFileIds: readonly string[];
  readonly destinationId: string;
}

export interface CatchMission extends MissionBase {
  readonly kind: 'catch';
  readonly lanes: readonly Lane[];
  readonly previewMs: number;
  readonly fallMs: number;
}

export interface BossStep {
  readonly files: readonly VirtualFile[];
  readonly targetFileId: string;
  readonly destinationId: string;
  readonly allowedDestinationIds: readonly string[];
}

export interface BossMission extends MissionBase {
  readonly kind: 'boss';
  readonly steps: readonly [BossStep, BossStep, BossStep];
}

export type Mission = FindMission | SortMission | WipeMission | LatestMission | BundleMission | CatchMission | BossMission;
export type OutcomeReason = 'correct' | 'wrong-file' | 'wrong-folder' | 'wrong-bundle' | 'missed-file' | 'timeout';

export interface MissionOutcome {
  readonly missionId: string;
  readonly kind: MissionKind;
  readonly status: 'success' | 'failure';
  readonly reason: OutcomeReason;
  readonly score: number;
}

/** Capture at pointer-down; reuse through pointer-up and delayed callbacks. */
export interface CommandToken {
  readonly runId: number;
  readonly missionId: string | null;
  readonly bossStep: number;
}

export type InputReason =
  | 'selected' | 'cleared' | 'progress' | 'no-hit' | OutcomeReason
  | 'stale' | 'paused' | 'inactive' | 'invalid-file' | 'invalid-destination'
  | 'locked' | 'wrong-kind' | 'invalid-point' | 'invalid-lane';

export interface InputResult {
  readonly accepted: boolean;
  readonly reason: InputReason;
}

export interface RunSnapshot {
  readonly runId: number;
  readonly missionId: string | null;
  readonly phase: RunPhase;
  readonly paused: boolean;
  readonly locale: Locale;
  readonly mode: PlayMode;
  readonly runKind: RunKind;
  readonly seed: number;
  /** Zero-based index; regular runs contain 10 missions, practice runs 3. */
  readonly missionIndex: number;
  readonly missionCount: number;
  readonly successes: number;
  readonly score: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly goalAchieved: boolean;
  readonly selectedId: string | null;
  readonly selectedIds: readonly string[];
  /** All virtual files successfully handled in this run, independent of rendered phases. */
  readonly handledFileIds: readonly string[];
  readonly bossStep: number;
  readonly catchLane: Lane;
  readonly catchIndex: number;
  readonly catchNext: Readonly<{ lane: Lane; progress: number; preview: boolean }> | null;
  readonly completedIds: readonly string[];
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly deadlineMs: number;
  /** Null in phases that have no automatic transition. */
  readonly phaseRemainingMs: number | null;
  readonly mission: Mission | null;
  readonly outcome: MissionOutcome | null;
  readonly outcomes: readonly MissionOutcome[];
}
