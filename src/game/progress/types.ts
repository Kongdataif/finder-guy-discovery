export type TopicId = "organize" | "create" | "rest";
export type ModeId = "normal" | "relaxed";
export type CardId = "C00" | "C01" | "C02" | "C03" | "C04" | "C05" | "C06" | "C07" | "C08";
export type StoryId = "H01" | "H02";
export type StoryChoice = "rest" | "continue";
export type DiscoveryDescriptor = { readonly id: string; readonly recordsAction?: boolean } & (
  { readonly topic: TopicId } | { readonly topicId: TopicId }
);

/** completed means that all ten regular missions reached their normal result. */
export interface RunSummary {
  readonly runId: string;
  readonly mode: ModeId;
  readonly completed: boolean;
  readonly kind: "regular" | "practice" | "preview";
  readonly successes: number;
  readonly maxCombo: number;
  readonly score: number;
  readonly handledFileIds?: readonly string[];
}

export interface FinderSaveV1 {
  schemaVersion: 1;
  completedRuns: number;
  unlockedCardIds: CardId[];
  equippedCardId: CardId;
  bestScores: Record<ModeId, number>;
  settings: { preferredTopic: TopicId | null };
  discovery: {
    receivedBundleIds: string[];
    openedBundleIds: string[];
    readBundleIds: string[];
    actionOpenedIds: string[];
    actionDoneIds: string[];
    lastReadAt: Record<string, string>;
    dailyRecommendationByKey: Record<string, string>;
    recommendationCursorByTopic: Record<string, number>;
  };
  story: {
    holidayPending: boolean;
    holidaySeen: boolean;
    holidaySeenAtCompletedRuns: number | null;
    friendPending: boolean;
    friendSeen: boolean;
    friendChoice: StoryChoice | null;
  };
  appliedRunIds: string[];
  handledFileIds: string[];
}

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type SaveIssue = "unavailable" | "corrupt" | "future-version" | null;
export interface ProgressSnapshot {
  readonly save: DeepReadonly<FinderSaveV1>;
  readonly storageAvailable: boolean;
  readonly writeBlocked: boolean;
  readonly issue: SaveIssue;
}
export interface ApplyRunResult extends ProgressSnapshot {
  readonly applied: boolean;
  readonly newCardIds: readonly CardId[];
  readonly reason: "applied" | "duplicate" | "unissued" | "ineligible" | "invalid";
}
export interface ConfirmStoryResult extends ProgressSnapshot {
  readonly confirmed: boolean;
  readonly newCardIds: readonly CardId[];
}
export interface RecommendationResult extends ProgressSnapshot { readonly discoveryId: string | null }
export type StorageLike = Pick<Storage, "getItem" | "setItem">;
