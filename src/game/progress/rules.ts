import type { CardId, DiscoveryDescriptor, FinderSaveV1, RunSummary, StoryChoice, StoryId, TopicId } from "./types";

export const CARD_IDS: readonly CardId[] = ["C00", "C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08"];
export const MAX_APPLIED_RUN_IDS = 128;
export const MAX_DAILY_RECOMMENDATIONS = 64;
export const TOPIC_IDS: readonly TopicId[] = ["organize", "create", "rest"];
export const HANDLED_FILE_IDS: readonly string[] = ["cat-photo", "dog-photo", "note", "moon-photo", "letter", "final-pdf", "really-final-pdf", "revised-pdf", "photo-folder"];
export const isDiscoveryId = (id: unknown): id is string => typeof id === "string" && /^D(?:0[1-9]|1[0-2])$/.test(id);

export function emptySave(): FinderSaveV1 {
  return {
    schemaVersion: 1, completedRuns: 0, unlockedCardIds: ["C00"], equippedCardId: "C00",
    bestScores: { normal: 0, relaxed: 0 }, settings: { preferredTopic: null },
    discovery: {
      receivedBundleIds: [], openedBundleIds: [], readBundleIds: [], actionOpenedIds: [], actionDoneIds: [],
      lastReadAt: {}, dailyRecommendationByKey: {}, recommendationCursorByTopic: {},
    },
    story: { holidayPending: false, holidaySeen: false, holidaySeenAtCompletedRuns: null, friendPending: false, friendSeen: false, friendChoice: null },
    appliedRunIds: [], handledFileIds: [],
  };
}

export function cloneSave(save: FinderSaveV1): FinderSaveV1 {
  return JSON.parse(JSON.stringify(save)) as FinderSaveV1;
}

export function validRun(summary: RunSummary): boolean {
  if (!summary || typeof summary !== "object") return false;
  return typeof summary.runId === "string" && summary.runId.length > 0 && summary.runId.length <= 100
    && (summary.mode === "normal" || summary.mode === "relaxed")
    && ["regular", "practice", "preview"].includes(summary.kind)
    && typeof summary.completed === "boolean"
    && Number.isInteger(summary.successes) && summary.successes >= 0 && summary.successes <= 10
    && Number.isInteger(summary.maxCombo) && summary.maxCombo >= 0 && summary.maxCombo <= summary.successes
    && Number.isSafeInteger(summary.score) && summary.score >= 0;
}

export function refreshStoryEligibility(save: FinderSaveV1): void {
  save.story.holidayPending = !save.story.holidaySeen && save.completedRuns >= 3;
  save.story.friendPending = !save.story.friendSeen && save.story.holidaySeen
    && save.story.holidaySeenAtCompletedRuns !== null
    && save.completedRuns > save.story.holidaySeenAtCompletedRuns;
}

/** Pure rewards only. Transaction admission and persistence belong to the store. */
export function applyRunRewards(previous: FinderSaveV1, summary: RunSummary): { save: FinderSaveV1; newCardIds: CardId[] } {
  const save = cloneSave(previous);
  if (!validRun(summary) || !summary.completed || summary.kind !== "regular" || save.appliedRunIds.includes(summary.runId)) {
    return { save, newCardIds: [] };
  }
  save.completedRuns++;
  save.bestScores[summary.mode] = Math.max(save.bestScores[summary.mode], summary.score);
  const earned: CardId[] = ["C00", "C01"];
  if (save.completedRuns >= 2) earned.push("C02");
  if (save.completedRuns >= 3) earned.push("C03");
  if (summary.maxCombo >= 3) earned.push("C04");
  if (summary.successes >= 7) earned.push("C05");
  if (summary.successes === 10) earned.push("C08");
  const newCardIds = earned.filter((id) => !save.unlockedCardIds.includes(id));
  save.unlockedCardIds = CARD_IDS.filter((id) => save.unlockedCardIds.includes(id) || earned.includes(id));
  save.appliedRunIds = [...save.appliedRunIds, summary.runId].slice(-MAX_APPLIED_RUN_IDS);
  const handled = Array.isArray(summary.handledFileIds) ? summary.handledFileIds : [];
  save.handledFileIds = [...new Set([...save.handledFileIds, ...handled])].filter((id) => HANDLED_FILE_IDS.includes(id));
  refreshStoryEligibility(save);
  return { save, newCardIds };
}

export function confirmStoryReward(previous: FinderSaveV1, id: StoryId, choice?: StoryChoice): { save: FinderSaveV1; confirmed: boolean; newCardIds: CardId[] } {
  const save = cloneSave(previous);
  refreshStoryEligibility(save);
  let card: CardId;
  if (id === "H01" && save.story.holidayPending) {
    save.story.holidaySeen = true;
    save.story.holidaySeenAtCompletedRuns = save.completedRuns;
    card = "C06";
  } else if (id === "H02" && save.story.friendPending && (choice === "rest" || choice === "continue")) {
    save.story.friendSeen = true;
    save.story.friendChoice = choice;
    card = "C07";
  } else return { save: cloneSave(previous), confirmed: false, newCardIds: [] };
  const newCardIds = save.unlockedCardIds.includes(card) ? [] : [card];
  save.unlockedCardIds = CARD_IDS.filter((id) => save.unlockedCardIds.includes(id) || id === card);
  refreshStoryEligibility(save);
  return { save, confirmed: true, newCardIds };
}

export function validLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function localDateKey(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error("A valid local date is required");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Daily cache, then unopened-first circular choice, then least recently opened. */
export function chooseRecommendation(previous: FinderSaveV1, date: string, catalog: readonly DiscoveryDescriptor[], other = false): { save: FinderSaveV1; discoveryId: string | null } {
  const save = cloneSave(previous);
  if (!validLocalDate(date) || save.completedRuns < 1) return { save, discoveryId: null };
  const topic = save.settings.preferredTopic;
  const candidates = [...new Map(catalog.filter((item) => {
    const itemTopic = "topic" in item ? item.topic : item.topicId;
    return isDiscoveryId(item.id) && TOPIC_IDS.includes(itemTopic) && (!topic || itemTopic === topic);
  }).map((item) => [item.id, item])).keys()];
  if (candidates.length === 0) return { save, discoveryId: null };
  const topicKey = topic ?? "all";
  const key = `${date}|${topicKey}`;
  const current = save.discovery.dailyRecommendationByKey[key];
  let chosen = !other && current && candidates.includes(current) ? current : null;
  if (!chosen) {
    const alternatives = other && candidates.length > 1 ? candidates.filter((id) => id !== current) : candidates;
    const unopened = alternatives.filter((id) => !save.discovery.openedBundleIds.includes(id));
    const cursor = (save.discovery.recommendationCursorByTopic[topicKey] ?? 0) % candidates.length;
    const distance = (id: string) => (candidates.indexOf(id) - cursor + candidates.length) % candidates.length;
    const pool = unopened.length ? unopened : alternatives;
    chosen = [...pool].sort((left, right) => {
      if (!unopened.length) {
        const ageDifference = (Date.parse(save.discovery.lastReadAt[left] ?? "") || 0) - (Date.parse(save.discovery.lastReadAt[right] ?? "") || 0);
        if (ageDifference) return ageDifference;
      }
      return distance(left) - distance(right);
    })[0]!;
    save.discovery.recommendationCursorByTopic[topicKey] = (candidates.indexOf(chosen) + 1) % candidates.length;
    save.discovery.dailyRecommendationByKey[key] = chosen;
    const keys = Object.keys(save.discovery.dailyRecommendationByKey).sort();
    for (const oldKey of keys.slice(0, Math.max(0, keys.length - MAX_DAILY_RECOMMENDATIONS))) delete save.discovery.dailyRecommendationByKey[oldKey];
  }
  if (!save.discovery.receivedBundleIds.includes(chosen)) save.discovery.receivedBundleIds.push(chosen);
  return { save, discoveryId: chosen };
}
