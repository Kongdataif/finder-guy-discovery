import { describe, expect, it, vi } from "vitest";
import { createProgressStore, PROGRESS_STORAGE_KEY } from "./FinderProgressStore";
import { applyRunRewards, emptySave, localDateKey, MAX_APPLIED_RUN_IDS, MAX_DAILY_RECOMMENDATIONS } from "./rules";
import type { DiscoveryDescriptor, RunSummary, StorageLike } from "./types";

const catalog: readonly DiscoveryDescriptor[] = [
  { id: "D01", topicId: "organize", recordsAction: true },
  { id: "D02", topicId: "create", recordsAction: true },
  { id: "D03", topicId: "rest", recordsAction: false },
  { id: "D04", topicId: "organize", recordsAction: true },
  { id: "D07", topicId: "create", recordsAction: true },
  { id: "D08", topicId: "create", recordsAction: true },
];

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

function setup(storage: StorageLike | null = memory()) {
  let ordinal = 0;
  const store = createProgressStore(() => storage, { randomUUID: () => `test-uuid-${++ordinal}`, catalog });
  const run = (patch: Partial<RunSummary> = {}) => {
    const summary: RunSummary = { runId: store.createRunId(), mode: "normal", completed: true, kind: "regular", successes: 0, maxCombo: 0, score: 0, ...patch };
    return { summary, result: store.applyRun(summary) };
  };
  return { store, run };
}

describe("regular completion transactions and rewards", () => {
  it("starts with C00, counts a 0/10 completion and applies a result only once", () => {
    const { store, run } = setup();
    expect(store.load().save.unlockedCardIds).toEqual(["C00"]);
    const { summary, result } = run();
    expect(result).toMatchObject({ applied: true, newCardIds: ["C01"], save: { completedRuns: 1 } });
    expect(store.applyRun(summary)).toMatchObject({ applied: false, reason: "duplicate", newCardIds: [] });
    expect(store.load().save.completedRuns).toBe(1);
  });

  it.each([
    { kind: "practice" as const, completed: true },
    { kind: "preview" as const, completed: true },
    { kind: "regular" as const, completed: false },
  ])("does not grant progress for $kind with completed=$completed", (patch) => {
    const { store, run } = setup();
    const { result } = run({ ...patch, successes: 10, maxCombo: 10, score: 1240 });
    expect(result.reason).toBe("ineligible");
    expect(store.load().save).toEqual(emptySave());
  });

  it("grants all overlapping cards and keeps mode scores separate", () => {
    const { store, run } = setup();
    expect(run({ successes: 7, maxCombo: 3, score: 820 }).result.newCardIds).toEqual(["C01", "C04", "C05"]);
    expect(run({ mode: "relaxed", successes: 9, maxCombo: 5, score: 1090 }).result.newCardIds).toEqual(["C02"]);
    expect(run({ score: 0 }).result.newCardIds).toEqual(["C03"]);
    expect(store.load().save.bestScores).toEqual({ normal: 820, relaxed: 1090 });
    expect(store.load().save.story.holidayPending).toBe(true);
  });

  it.each(["normal", "relaxed"] as const)("awards C08 exactly once for a new perfect regular run in %s", (mode) => {
    const { store, run } = setup();
    expect(run({ mode, successes: 9, maxCombo: 9, score: 1100 }).result.save.unlockedCardIds).not.toContain("C08");
    const perfect = run({ mode, successes: 10, maxCombo: 10, score: 1240 });
    expect(perfect.result.newCardIds).toEqual(["C02", "C08"]);
    expect(store.applyRun(perfect.summary)).toMatchObject({ applied: false, reason: "duplicate", newCardIds: [] });
    expect(run({ mode, successes: 10, maxCombo: 10, score: 1240 }).result.newCardIds).toEqual(["C03"]);
    expect(store.load().save.unlockedCardIds.filter((id) => id === "C08")).toHaveLength(1);
  });

  it("grants the new perfect card together with all first-run mastery rewards", () => {
    const { run } = setup();
    expect(run({ successes: 10, maxCombo: 10, score: 1240 }).result.newCardIds).toEqual(["C01", "C04", "C05", "C08"]);
  });

  it("preserves an old eight-card v1 save without inferring a perfect run from its best score", () => {
    const old = emptySave();
    old.completedRuns = 4;
    old.unlockedCardIds = ["C00", "C01", "C02", "C03", "C04", "C05", "C06", "C07"];
    old.equippedCardId = "C07";
    old.bestScores = { normal: 1240, relaxed: 1240 };
    old.story = { holidayPending: false, holidaySeen: true, holidaySeenAtCompletedRuns: 3, friendPending: false, friendSeen: true, friendChoice: "rest" };
    const storage = memory({ [PROGRESS_STORAGE_KEY]: JSON.stringify(old) });
    const { store, run } = setup(storage);
    expect(store.load().save).toEqual(old);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(run({ successes: 10, maxCombo: 10, score: 1240 }).result.newCardIds).toEqual(["C08"]);
    store.equip("C08");
    const reloaded = createProgressStore(() => storage).load().save;
    expect(reloaded.unlockedCardIds).toEqual([...old.unlockedCardIds, "C08"]);
    expect(reloaded.equippedCardId).toBe("C08");
    expect(reloaded.story).toEqual(old.story);
  });

  it.each([
    { successes: 11 }, { successes: -1 }, { maxCombo: 2, successes: 1 },
    { score: Number.NaN }, { score: -1 }, { successes: 1.5 },
  ])("rejects invalid run values without consuming its transaction: %j", (patch) => {
    const { store } = setup();
    const summary: RunSummary = { runId: store.createRunId(), mode: "normal", completed: true, kind: "regular", successes: 0, maxCombo: 0, score: 0 };
    expect(store.applyRun({ ...summary, ...patch }).reason).toBe("invalid");
    expect(store.applyRun(summary).applied).toBe(true);
  });

  it("keeps receipt history bounded and rejects a replay after its receipt is evicted", () => {
    const { store, run } = setup();
    const first = run().summary;
    for (let index = 0; index < MAX_APPLIED_RUN_IDS; index++) run();
    expect(store.load().save.appliedRunIds).toHaveLength(MAX_APPLIED_RUN_IDS);
    expect(store.load().save.appliedRunIds).not.toContain(first.runId);
    const count = store.load().save.completedRuns;
    expect(store.applyRun(first).reason).toBe("unissued");
    expect(store.load().save.completedRuns).toBe(count);
  });

  it("rejects arbitrary and abandoned live transaction IDs", () => {
    const { store } = setup();
    const abandoned = store.createRunId();
    for (let index = 0; index < 16; index++) store.createRunId();
    const summary: RunSummary = { runId: abandoned, mode: "normal", completed: true, kind: "regular", successes: 0, maxCombo: 0, score: 0 };
    expect(store.applyRun(summary).reason).toBe("unissued");
    expect(store.applyRun({ ...summary, runId: "arbitrary-old-result" }).reason).toBe("unissued");
  });

  it("calculates pure rewards without changing source data", () => {
    const original = emptySave();
    const result = applyRunRewards(original, { runId: "pure", mode: "relaxed", completed: true, kind: "regular", successes: 7, maxCombo: 3, score: 800 });
    expect(original).toEqual(emptySave());
    expect(result.newCardIds).toEqual(["C01", "C04", "C05"]);
    expect(result.save).not.toBe(original);
  });

  it("keeps a bounded, deduplicated history of genuinely handled virtual IDs across reload", () => {
    const storage = memory();
    const { store, run } = setup(storage);
    run({ successes: 2, maxCombo: 1, score: 200, handledFileIds: ["cat-photo", "note", "cat-photo", "real-disk-file", "D02"] });
    run({ successes: 1, maxCombo: 1, score: 100, handledFileIds: ["note", "final-pdf"] });
    run({ kind: "practice", successes: 1, maxCombo: 1, handledFileIds: ["letter"] });
    run({ completed: false, handledFileIds: ["dog-photo"] });
    expect(store.load().save.handledFileIds).toEqual(["cat-photo", "note", "final-pdf"]);
    expect(createProgressStore(() => storage).load().save.handledFileIds).toEqual(["cat-photo", "note", "final-pdf"]);
    const raw = JSON.parse(storage.values.get(PROGRESS_STORAGE_KEY)!);
    raw.handledFileIds = ["note", "note", "unknown", ...Array.from({ length: 100 }, () => "cat-photo")];
    storage.values.set(PROGRESS_STORAGE_KEY, JSON.stringify(raw));
    expect(createProgressStore(() => storage).load().save.handledFileIds).toEqual(["note", "cat-photo"]);
  });
});

describe("browser transaction ID compatibility", () => {
  it("uses secure random bytes when HTTP LAN origins have no randomUUID", () => {
    const secureRandom = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    const getRandomValues = vi.fn((array: Uint8Array<ArrayBuffer>) => secureRandom(array));
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      const store = createProgressStore(() => memory());
      const ids = Array.from({ length: 32 }, () => store.createRunId());
      expect(new Set(ids).size).toBe(32);
      expect(ids.every((id) => id.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
      expect(getRandomValues).toHaveBeenCalledTimes(32);
    } finally { vi.unstubAllGlobals(); }
  });

  it("prefers the injected generator without requiring browser crypto", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      const store = createProgressStore(() => memory(), { randomUUID: () => "injected-run" });
      expect(store.createRunId()).toBe("injected-run");
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("story confirmation precedes optional animation", () => {
  it("unlocks H01 after three zero-score runs without reading or mastery cards", () => {
    const { store, run } = setup();
    expect(store.confirmStory("H01").confirmed).toBe(false);
    run(); run(); run();
    const before = store.load();
    expect(before.save.unlockedCardIds).toEqual(["C00", "C01", "C02", "C03"]);
    expect(before.save.story.holidayPending).toBe(true);
    expect(store.deferStory("H01")).toEqual(before);
    expect(store.confirmStory("H01")).toMatchObject({ confirmed: true, newCardIds: ["C06"], save: { story: { holidaySeen: true, holidayPending: false, holidaySeenAtCompletedRuns: 3, friendPending: false } } });
    expect(store.confirmStory("H01").confirmed).toBe(false);
    expect(store.confirmStory("H02", "rest").confirmed).toBe(false);
    run();
    expect(store.load().save.story.friendPending).toBe(true);
  });

  it.each(["rest", "continue"] as const)("confirms H02 %s with the same card, and replay changes nothing", (choice) => {
    const storage = memory();
    const { store, run } = setup(storage);
    for (let index = 0; index < 6; index++) run();
    store.confirmStory("H01");
    expect(store.load().save.story.holidaySeenAtCompletedRuns).toBe(6);
    expect(store.load().save.story.friendPending).toBe(false);
    run({ kind: "practice" });
    expect(store.load().save.story.friendPending).toBe(false);
    run();
    const pending = store.load();
    expect(store.deferStory("H02")).toEqual(pending);
    expect(store.confirmStory("H02").confirmed).toBe(false);
    const confirmed = store.confirmStory("H02", choice);
    expect(confirmed.newCardIds).toEqual(["C07"]);
    expect(confirmed.save.story).toMatchObject({ friendPending: false, friendSeen: true, friendChoice: choice });
    const persisted = createProgressStore(() => storage).load();
    expect(persisted.save).toEqual(confirmed.save);
    expect(store.confirmStory("H02", choice).confirmed).toBe(false);
    expect(store.load().save).toEqual(confirmed.save);
  });

  it("persists H01 before animation/reload and keeps a deferred file pending after reload", () => {
    const storage = memory();
    const { store, run } = setup(storage);
    run(); run(); run(); store.deferStory("H01");
    expect(createProgressStore(() => storage).load().save.story.holidayPending).toBe(true);
    store.confirmStory("H01");
    const reloaded = createProgressStore(() => storage).load();
    expect(reloaded.save.unlockedCardIds).toContain("C06");
    expect(reloaded.save.story.holidaySeenAtCompletedRuns).toBe(3);
    expect(reloaded.save.story.holidayPending).toBe(false);
  });
});

describe("discovery selection and independent optional actions", () => {
  it("allows direct D02 opening without awarding a practice completion or card", () => {
    const { store } = setup();
    store.openDiscovery("D02", "2026-09-11T01:00:00Z");
    expect(store.load().save.discovery.openedBundleIds).toEqual(["D02"]);
    expect(store.load().save.discovery.receivedBundleIds).toEqual([]);
    expect(store.load().save.discovery.readBundleIds).toEqual([]);
    expect(store.load().save.completedRuns).toBe(0);
    expect(store.load().save.unlockedCardIds).toEqual(["C00"]);
    expect(store.recommend("2026-09-11", catalog).discoveryId).toBeNull();
  });

  it("grants an unread recommendation on completion, then holds it for the same date and topic across reload", () => {
    const storage = memory();
    const { store, run } = setup(storage); run(); store.setTopic("create");
    const first = store.recommend("2026-09-11", catalog);
    expect(first.discoveryId).toBe("D02");
    expect(first.save.discovery.receivedBundleIds).toEqual(["D02"]);
    expect(first.save.discovery.openedBundleIds).toEqual([]);
    expect(first.save.discovery.readBundleIds).toEqual([]);
    store.openDiscovery("D02", "2026-09-11T01:00:00Z");
    expect(createProgressStore(() => storage).recommend("2026-09-11", catalog).discoveryId).toBe("D02");
    const other = store.recommend("2026-09-11", catalog, true);
    expect(other.discoveryId).toBe("D07");
    expect(other.save.completedRuns).toBe(1);
    expect(createProgressStore(() => storage).recommend("2026-09-11", catalog).discoveryId).toBe("D07");
  });

  it("changes topics and crosses midnight without resetting achievements or discoveries", () => {
    const { store, run } = setup(); run();
    store.setTopic("create"); store.recommend("2026-09-11", catalog);
    store.setTopic("organize");
    expect(store.recommend("2026-09-11", catalog).discoveryId).toBe("D01");
    store.setTopic("create");
    expect(store.recommend("2026-09-11", catalog).discoveryId).toBe("D02");
    expect(store.recommend("2026-09-12", catalog).discoveryId).toBe("D07");
    expect(store.load().save.completedRuns).toBe(1);
    expect(store.load().save.discovery.receivedBundleIds).toEqual(["D02", "D01", "D07"]);
  });

  it("cycles unopened candidates freely, then recommends the least recently opened one", () => {
    const { store, run } = setup(); run(); store.setTopic("create");
    expect(store.recommend("2026-09-11", catalog).discoveryId).toBe("D02");
    expect(store.recommend("2026-09-11", catalog, true).discoveryId).toBe("D07");
    expect(store.recommend("2026-09-11", catalog, true).discoveryId).toBe("D08");
    expect(store.recommend("2026-09-11", catalog, true).discoveryId).toBe("D02");
    store.openDiscovery("D02", "2026-09-11T03:00:00Z");
    store.openDiscovery("D07", "2026-09-11T01:00:00Z");
    store.openDiscovery("D08", "2026-09-11T02:00:00Z");
    expect(store.recommend("2026-09-12", catalog).discoveryId).toBe("D07");
    expect(store.recommend("2026-09-12", catalog, true).discoveryId).toBe("D08");
  });

  it("separates receipt, actual opening, explicit reading, action opening and action completion", () => {
    const { store, run } = setup(); run(); store.setTopic("create"); store.recommend("2026-09-11", catalog);
    store.openAction("D02");
    expect(store.load().save.discovery).toMatchObject({ openedBundleIds: [], readBundleIds: [], actionOpenedIds: ["D02"], actionDoneIds: [] });
    store.doneAction("D02");
    expect(store.load().save.discovery.readBundleIds).toEqual([]);
    store.markRead("D02");
    expect(store.load().save.discovery.readBundleIds).toEqual([]);
    store.openDiscovery("D02"); store.markRead("D02");
    expect(store.load().save.discovery.readBundleIds).toEqual(["D02"]);
    store.openAction("D03"); store.doneAction("D03");
    expect(store.load().save.discovery.actionOpenedIds).toContain("D03");
    expect(store.load().save.discovery.actionDoneIds).not.toContain("D03");
    expect(store.load().save.completedRuns).toBe(1);
    expect(store.load().save.unlockedCardIds).toEqual(["C00", "C01"]);
  });

  it("handles empty catalogs, invalid dates and exhausted single-topic catalogs without failure", () => {
    const { store, run } = setup(); run();
    expect(store.recommend("2026-02-30", catalog).discoveryId).toBeNull();
    expect(store.recommend("2026-09-11", []).discoveryId).toBeNull();
    store.setTopic("rest");
    store.openDiscovery("D03");
    expect(store.recommend("2026-09-11", catalog).discoveryId).toBe("D03");
    expect(store.recommend("2026-09-11", catalog, true).discoveryId).toBe("D03");
    expect(localDateKey(new Date(2026, 8, 11, 0, 1))).toBe("2026-09-11");
  });

  it("bounds daily caches without erasing received items or cards", () => {
    const { store, run } = setup(); run();
    for (let index = 0; index < MAX_DAILY_RECOMMENDATIONS + 5; index++) {
      const day = new Date(2026, 0, index + 1);
      store.recommend(localDateKey(day), catalog);
    }
    expect(Object.keys(store.load().save.discovery.dailyRecommendationByKey)).toHaveLength(MAX_DAILY_RECOMMENDATIONS);
    expect(store.load().save.discovery.receivedBundleIds).toHaveLength(catalog.length);
    expect(store.load().save.unlockedCardIds).toEqual(["C00", "C01"]);
  });
});

describe("browser storage boundaries", () => {
  it("reads and writes only the full-game Finder key, preserving old settings and original game data", () => {
    const storage = memory({ "petit-princess.best-score": "900", "finder-discovery:p0-settings:v1": '{"locale":"en"}' });
    const { store, run } = setup(storage); store.load(); run();
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(PROGRESS_STORAGE_KEY);
    expect(storage.setItem.mock.calls.every(([key]) => key === PROGRESS_STORAGE_KEY)).toBe(true);
    expect(storage.values.get("petit-princess.best-score")).toBe("900");
    expect(storage.values.get("finder-discovery:p0-settings:v1")).toBe('{"locale":"en"}');
  });

  it.each([null, "getter", "read"])("continues in memory when storage is blocked at %s", (failure) => {
    const store = createProgressStore(() => {
      if (failure === "getter") throw new Error("SecurityError");
      if (failure === null) return null;
      return { getItem: () => { throw new Error("blocked read"); }, setItem: () => { throw new Error("blocked write"); } };
    }, { randomUUID: () => "blocked-run" });
    expect(store.load().storageAvailable).toBe(false);
    const applied = store.applyRun({ runId: store.createRunId(), mode: "normal", completed: true, kind: "regular", successes: 0, maxCombo: 0, score: 0 });
    expect(applied.applied).toBe(true);
    expect(applied.storageAvailable).toBe(false);
    expect(applied.save.completedRuns).toBe(1);
  });

  it("retains an applied result after quota failure without double-counting, then persists on the next change", () => {
    const storage = memory(); storage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    const { store, run } = setup(storage);
    const { summary, result } = run();
    expect(result.storageAvailable).toBe(false);
    expect(store.applyRun(summary).applied).toBe(false);
    store.setTopic("rest");
    expect(store.load().storageAvailable).toBe(true);
    expect(createProgressStore(() => storage).load().save.completedRuns).toBe(1);
  });

  it.each([
    ["{bad-json", "corrupt"],
    ['{"schemaVersion":99,"preciousFutureData":true}', "future-version"],
    ["null", "corrupt"],
  ])("preserves an unsupported original payload: %s", (raw, issue) => {
    const storage = memory({ [PROGRESS_STORAGE_KEY]: raw! });
    const { store, run } = setup(storage);
    expect(store.load()).toMatchObject({ writeBlocked: true, storageAvailable: false, issue });
    expect(run().result.save.completedRuns).toBe(1);
    store.setTopic("rest");
    expect(storage.values.get(PROGRESS_STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("sanitizes malformed fields and invalid cards, story claims and discovery IDs", () => {
    const storage = memory({ [PROGRESS_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1, completedRuns: 3, unlockedCardIds: ["C06", "C99", "C01", "C01"], equippedCardId: "C06",
      bestScores: { normal: -1, relaxed: "999" }, settings: { preferredTopic: "personality" },
      discovery: { openedBundleIds: ["D02", "D02", "external-url"], lastReadAt: { D02: "invalid" } },
      story: { holidaySeen: true, holidaySeenAtCompletedRuns: 100, friendSeen: true },
    }) });
    const save = createProgressStore(() => storage).load().save;
    expect(save.unlockedCardIds).toEqual(["C00", "C01", "C02", "C03"]);
    expect(save.equippedCardId).toBe("C00");
    expect(save.bestScores).toEqual({ normal: 0, relaxed: 0 });
    expect(save.settings.preferredTopic).toBeNull();
    expect(save.discovery.openedBundleIds).toEqual(["D02"]);
    expect(save.discovery.lastReadAt).toEqual({});
    expect(save.story).toMatchObject({ holidayPending: true, holidaySeen: false, friendSeen: false });
  });

  it("returns deeply immutable detached snapshots and equips unlocked cards only", () => {
    const { store, run } = setup();
    const first = store.load();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.save.discovery.openedBundleIds)).toBe(true);
    expect(() => (first.save.unlockedCardIds as string[]).push("C07")).toThrow();
    store.equip("C07"); expect(store.load().save.equippedCardId).toBe("C00");
    const result = run().result; expect(Object.isFrozen(result)).toBe(true);
    store.equip("C01"); expect(store.load().save.equippedCardId).toBe("C01");
    expect(first.save.unlockedCardIds).toEqual(["C00"]);
  });
});
