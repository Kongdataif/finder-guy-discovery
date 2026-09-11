import { applyRunRewards, CARD_IDS, chooseRecommendation, cloneSave, confirmStoryReward, emptySave, HANDLED_FILE_IDS, isDiscoveryId, MAX_APPLIED_RUN_IDS, MAX_DAILY_RECOMMENDATIONS, refreshStoryEligibility, TOPIC_IDS, validLocalDate, validRun } from "./rules";
import type { ApplyRunResult, CardId, ConfirmStoryResult, DiscoveryDescriptor, FinderSaveV1, ProgressSnapshot, RecommendationResult, RunSummary, SaveIssue, StorageLike, StoryChoice, StoryId, TopicId } from "./types";

export const PROGRESS_STORAGE_KEY = "finder-discovery:v1";
const MAX_PENDING_RUNS = 16;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, fallback = 0) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
const uniqueStrings = (value: unknown, allowed: (id: unknown) => boolean): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && allowed(id)))] : [];

function sanitize(raw: Record<string, unknown>): FinderSaveV1 {
  const save = emptySave();
  save.completedRuns = integer(raw.completedRuns);
  save.unlockedCardIds = [...new Set<CardId>(["C00", ...uniqueStrings(raw.unlockedCardIds, (id) => CARD_IDS.includes(id as CardId)) as CardId[]])];
  if (save.completedRuns >= 1 && !save.unlockedCardIds.includes("C01")) save.unlockedCardIds.push("C01");
  if (save.completedRuns >= 2 && !save.unlockedCardIds.includes("C02")) save.unlockedCardIds.push("C02");
  if (save.completedRuns >= 3 && !save.unlockedCardIds.includes("C03")) save.unlockedCardIds.push("C03");
  if (save.unlockedCardIds.includes(raw.equippedCardId as CardId)) save.equippedCardId = raw.equippedCardId as CardId;
  if (record(raw.bestScores)) save.bestScores = { normal: integer(raw.bestScores.normal), relaxed: integer(raw.bestScores.relaxed) };
  if (record(raw.settings) && TOPIC_IDS.includes(raw.settings.preferredTopic as TopicId)) save.settings.preferredTopic = raw.settings.preferredTopic as TopicId;
  if (record(raw.discovery)) {
    const data = raw.discovery;
    for (const field of ["receivedBundleIds", "openedBundleIds", "readBundleIds", "actionOpenedIds", "actionDoneIds"] as const) {
      save.discovery[field] = uniqueStrings(data[field], isDiscoveryId);
    }
    if (record(data.lastReadAt)) {
      for (const [id, at] of Object.entries(data.lastReadAt)) {
        if (isDiscoveryId(id) && typeof at === "string" && Number.isFinite(Date.parse(at))) save.discovery.lastReadAt[id] = at;
      }
    }
    if (record(data.dailyRecommendationByKey)) {
      for (const [key, id] of Object.entries(data.dailyRecommendationByKey).sort(([a], [b]) => a.localeCompare(b)).slice(-MAX_DAILY_RECOMMENDATIONS)) {
        const [date, topic, extra] = key.split("|");
        if (date && validLocalDate(date) && !extra && (topic === "all" || TOPIC_IDS.includes(topic as TopicId)) && isDiscoveryId(id)) save.discovery.dailyRecommendationByKey[key] = id;
      }
    }
    if (record(data.recommendationCursorByTopic)) {
      for (const topic of ["all", ...TOPIC_IDS]) {
        if (Object.hasOwn(data.recommendationCursorByTopic, topic)) save.discovery.recommendationCursorByTopic[topic] = integer(data.recommendationCursorByTopic[topic]);
      }
    }
  }
  if (record(raw.story)) {
    const story = raw.story;
    const seenAt = integer(story.holidaySeenAtCompletedRuns, -1);
    save.story.holidaySeen = story.holidaySeen === true && seenAt >= 3 && seenAt <= save.completedRuns;
    save.story.holidaySeenAtCompletedRuns = save.story.holidaySeen ? seenAt : null;
    save.story.friendSeen = story.friendSeen === true && save.story.holidaySeen && save.completedRuns > seenAt;
    save.story.friendChoice = save.story.friendSeen && (story.friendChoice === "rest" || story.friendChoice === "continue") ? story.friendChoice : null;
  }
  save.unlockedCardIds = save.unlockedCardIds.filter((id) => (id !== "C06" || save.story.holidaySeen) && (id !== "C07" || save.story.friendSeen));
  if (save.story.holidaySeen && !save.unlockedCardIds.includes("C06")) save.unlockedCardIds.push("C06");
  if (save.story.friendSeen && !save.unlockedCardIds.includes("C07")) save.unlockedCardIds.push("C07");
  if (!save.unlockedCardIds.includes(save.equippedCardId)) save.equippedCardId = "C00";
  save.appliedRunIds = uniqueStrings(raw.appliedRunIds, (id) => typeof id === "string" && id.length > 0 && id.length <= 100).slice(-MAX_APPLIED_RUN_IDS);
  save.handledFileIds = uniqueStrings(raw.handledFileIds, (id) => HANDLED_FILE_IDS.includes(id as string));
  refreshStoryEligibility(save);
  return save;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export interface ProgressStoreOptions { randomUUID?: () => string; now?: () => Date; catalog?: readonly DiscoveryDescriptor[] }

/** getRandomValues also works on HTTP LAN pages, where randomUUID is unavailable. */
function browserRunId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** All writes touch one Finder key. A failed write retains the complete live transaction. */
export function createProgressStore(storageAccess: () => StorageLike | null, options: ProgressStoreOptions = {}) {
  let save = emptySave();
  let initialized = false;
  let storageAvailable = false;
  let writeBlocked = false;
  let issue: SaveIssue = null;
  const pendingRunIds = new Set<string>();
  const actionPolicies = new Map<string, boolean>();
  function registerCatalog(catalog: readonly DiscoveryDescriptor[]): void {
    for (const item of catalog) if (isDiscoveryId(item.id)) actionPolicies.set(item.id, item.recordsAction !== false);
  }
  registerCatalog(options.catalog ?? []);

  function snapshot(): ProgressSnapshot {
    return freeze({ save: cloneSave(save), storageAvailable, writeBlocked, issue });
  }

  function load(): ProgressSnapshot {
    if (initialized) return snapshot();
    initialized = true;
    try {
      const storage = storageAccess();
      if (!storage) { issue = "unavailable"; return snapshot(); }
      const raw = storage.getItem(PROGRESS_STORAGE_KEY);
      storageAvailable = true;
      if (raw !== null) {
        let data: unknown;
        try { data = JSON.parse(raw); } catch { data = null; }
        if (!record(data) || data.schemaVersion !== 1) {
          issue = record(data) && typeof data.schemaVersion === "number" && data.schemaVersion > 1 ? "future-version" : "corrupt";
          writeBlocked = true;
          storageAvailable = false;
        } else save = sanitize(data);
      }
    } catch { storageAvailable = false; issue = "unavailable"; }
    return snapshot();
  }

  function persist(): void {
    if (writeBlocked) return;
    try {
      const storage = storageAccess();
      if (!storage) { storageAvailable = false; issue = "unavailable"; return; }
      storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(save));
      storageAvailable = true; issue = null;
    } catch { storageAvailable = false; issue = "unavailable"; }
  }

  /** Only the last 16 live runs may commit. Old evicted receipt IDs cannot be replayed. */
  function createRunId(): string {
    load();
    const id = options.randomUUID?.() ?? browserRunId();
    if (!id || id.length > 100 || pendingRunIds.has(id) || save.appliedRunIds.includes(id)) throw new Error("A unique run transaction ID is required");
    pendingRunIds.add(id);
    while (pendingRunIds.size > MAX_PENDING_RUNS) pendingRunIds.delete(pendingRunIds.values().next().value!);
    return id;
  }

  function applyRun(summary: RunSummary): ApplyRunResult {
    load();
    let reason: ApplyRunResult["reason"];
    if (!validRun(summary)) reason = "invalid";
    else if (save.appliedRunIds.includes(summary.runId)) reason = "duplicate";
    else if (!pendingRunIds.has(summary.runId)) reason = "unissued";
    else if (!summary.completed || summary.kind !== "regular") { pendingRunIds.delete(summary.runId); reason = "ineligible"; }
    else {
      const result = applyRunRewards(save, summary);
      save = result.save;
      pendingRunIds.delete(summary.runId);
      persist();
      return freeze({ ...snapshot(), applied: true, reason: "applied", newCardIds: Object.freeze(result.newCardIds) });
    }
    return freeze({ ...snapshot(), applied: false, reason, newCardIds: Object.freeze([]) });
  }

  function confirmStory(id: StoryId, choice?: StoryChoice): ConfirmStoryResult {
    load();
    const result = confirmStoryReward(save, id, choice);
    if (result.confirmed) { save = result.save; persist(); }
    return freeze({ ...snapshot(), confirmed: result.confirmed, newCardIds: Object.freeze(result.newCardIds) });
  }

  /** Deferral and replay leave pending/completion unchanged; no animation callback commits rewards. */
  function deferStory(_id: StoryId): ProgressSnapshot { return load(); }

  function equip(id: CardId): ProgressSnapshot {
    load();
    if (save.unlockedCardIds.includes(id) && save.equippedCardId !== id) { save.equippedCardId = id; persist(); }
    return snapshot();
  }

  function setTopic(topic: TopicId | null): ProgressSnapshot {
    load();
    if ((topic === null || TOPIC_IDS.includes(topic)) && save.settings.preferredTopic !== topic) {
      save.settings.preferredTopic = topic; persist();
    }
    return snapshot();
  }

  function recommend(date: string, catalog: readonly DiscoveryDescriptor[], other = false): RecommendationResult {
    load();
    registerCatalog(catalog);
    const result = chooseRecommendation(save, date, catalog, other);
    if (JSON.stringify(result.save) !== JSON.stringify(save)) { save = result.save; persist(); }
    return freeze({ ...snapshot(), discoveryId: result.discoveryId });
  }

  function openDiscovery(id: string, at = (options.now?.() ?? new Date()).toISOString()): ProgressSnapshot {
    load();
    if (isDiscoveryId(id) && Number.isFinite(Date.parse(at))) {
      if (!save.discovery.openedBundleIds.includes(id)) save.discovery.openedBundleIds.push(id);
      save.discovery.lastReadAt[id] = at;
      persist();
    }
    return snapshot();
  }

  function markRead(id: string, at = (options.now?.() ?? new Date()).toISOString()): ProgressSnapshot {
    load();
    if (isDiscoveryId(id) && save.discovery.openedBundleIds.includes(id) && Number.isFinite(Date.parse(at))) {
      if (!save.discovery.readBundleIds.includes(id)) save.discovery.readBundleIds.push(id);
      save.discovery.lastReadAt[id] = at; persist();
    }
    return snapshot();
  }

  function action(id: string, done: boolean): ProgressSnapshot {
    load();
    if (!isDiscoveryId(id) || (done && actionPolicies.get(id) === false)) return snapshot();
    const list = done ? save.discovery.actionDoneIds : save.discovery.actionOpenedIds;
    if (!list.includes(id)) { list.push(id); persist(); }
    return snapshot();
  }

  return { load, createRunId, applyRun, confirmStory, deferStory, equip, setTopic, recommend, openDiscovery, markRead,
    openAction: (id: string) => action(id, false), doneAction: (id: string) => action(id, true) };
}

export type FinderProgressStore = ReturnType<typeof createProgressStore>;
