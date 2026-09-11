import { describe, expect, it, vi } from "vitest";
import { CATALOGS, formatCopy, getCopy } from "./i18n";
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  readLocaleOverride,
  resolveVisitLocale,
  SETTINGS_STORAGE_KEY,
  type Settings,
  type StorageLike,
} from "./settings";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

describe("Finder settings isolation and fallback", () => {
  it("loads defaults without persisting an inferred language or touching original settings", () => {
    const storage = memoryStorage({ "petit-princess.locale": "en", "petit-princess.best-score": "700" });
    const store = createSettingsStore(() => storage);
    expect(store.load()).toEqual({ settings: DEFAULT_SETTINGS, storageAvailable: true });
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(SETTINGS_STORAGE_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(resolveVisitLocale(store.load().settings, "", "ko-KR")).toBe("ko");
  });

  it("writes only the versioned Finder key and restores explicitly chosen settings", () => {
    const storage = memoryStorage({ "petit-princess.locale": "ko", "petit-princess.best-score": "700" });
    const store = createSettingsStore(() => storage);
    const settings: Settings = { locale: "en", mode: "relaxed", muted: true, reducedMotion: true };
    expect(store.update(settings)).toEqual({ settings, storageAvailable: true });
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
      SETTINGS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, ...settings }),
    );
    expect(createSettingsStore(() => storage).load().settings).toEqual(settings);
    expect(storage.values.get("petit-princess.locale")).toBe("ko");
    expect(storage.values.get("petit-princess.best-score")).toBe("700");
    expect(storage.values.size).toBe(3);
  });

  it.each(["{broken", "null", "[]", '{"schemaVersion":2,"locale":"en"}', '{"locale":"en"}'])(
    "uses safe defaults for unreadable or unsupported data: %s", (raw) => {
      const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: raw });
      expect(createSettingsStore(() => storage).load()).toEqual({
        settings: DEFAULT_SETTINGS, storageAvailable: true,
      });
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it("sanitizes loaded values and rejects unknown or wrongly typed update fields", () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, locale: "fr", mode: "relaxed", muted: "yes", reducedMotion: true, score: 900 }),
    });
    const store = createSettingsStore(() => storage);
    expect(store.load().settings).toEqual({ ...DEFAULT_SETTINGS, mode: "relaxed", reducedMotion: true });
    store.update({ locale: "invalid", mode: "story", muted: 1, score: 999 } as unknown as Partial<Settings>);
    expect(storage.setItem).not.toHaveBeenCalled();
    const next = store.update({ locale: "en", reducedMotion: false, score: 999 } as Partial<Settings>);
    expect(next.settings).toEqual({ ...DEFAULT_SETTINGS, mode: "relaxed", locale: "en" });
    expect(JSON.parse(storage.values.get(SETTINGS_STORAGE_KEY)!)).not.toHaveProperty("score");
  });

  it("keeps live choices when the localStorage getter throws", () => {
    const store = createSettingsStore(() => { throw new Error("SecurityError"); });
    expect(store.load()).toEqual({ settings: DEFAULT_SETTINGS, storageAvailable: false });
    expect(store.update({ locale: "en", muted: true }).storageAvailable).toBe(false);
    expect(store.load().settings).toEqual({ ...DEFAULT_SETTINGS, locale: "en", muted: true });
  });

  it("handles null storage and a throwing getItem without blocking play", () => {
    expect(createSettingsStore(() => null).update({ mode: "relaxed" })).toEqual({
      settings: { ...DEFAULT_SETTINGS, mode: "relaxed" }, storageAvailable: false,
    });
    const storage: StorageLike = { getItem: () => { throw new Error("blocked read"); }, setItem: () => undefined };
    expect(createSettingsStore(() => storage).load().storageAvailable).toBe(false);
  });

  it("preserves memory after quota failure and can persist it on a later update", () => {
    const storage = memoryStorage();
    storage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    const store = createSettingsStore(() => storage);
    expect(store.update({ locale: "en" })).toEqual({
      settings: { ...DEFAULT_SETTINGS, locale: "en" }, storageAvailable: false,
    });
    expect(store.load().settings.locale).toBe("en");
    expect(store.update({ muted: true }).storageAvailable).toBe(true);
    expect(createSettingsStore(() => storage).load().settings).toEqual({ ...DEFAULT_SETTINGS, locale: "en", muted: true });
  });

  it("returns detached snapshots so callers cannot mutate the store", () => {
    const store = createSettingsStore(() => null);
    const first = store.load();
    first.settings.mode = "relaxed";
    expect(store.load().settings.mode).toBe("normal");
  });
});

describe("Finder visit language", () => {
  it("applies a URL override without overwriting a saved language", () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, ...DEFAULT_SETTINGS, locale: "ko" }) });
    const store = createSettingsStore(() => storage);
    expect(resolveVisitLocale(store.load().settings, "?lang=en", "ko-KR")).toBe("en");
    expect(store.load().settings.locale).toBe("ko");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(resolveVisitLocale(store.load().settings, "", "en-US")).toBe("ko");
    store.update({ locale: "en" });
    expect(createSettingsStore(() => storage).load().settings.locale).toBe("en");
  });

  it("keeps a first visit unacknowledged while providing a display locale", () => {
    const settings = createSettingsStore(() => null).load().settings;
    expect(settings.locale).toBeNull();
    expect(resolveVisitLocale(settings, "", "en-US")).toBe("en");
    expect(resolveVisitLocale(settings, "?lang=fr", "fr-FR")).toBe("ko");
    expect(readLocaleOverride("?lang=ko")).toBe("ko");
    expect(readLocaleOverride("?lang=en")).toBe("en");
    expect(readLocaleOverride("?lang=unknown")).toBeNull();
    expect(readLocaleOverride("")).toBeNull();
  });
});

describe("Finder complete bilingual copy", () => {
  function leafPaths(value: unknown, prefix = ""): string[] {
    if (typeof value === "string") return [prefix];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  it("has matching copy keys through tutorials, play, pause, failures and results", () => {
    expect(leafPaths(CATALOGS.ko).sort()).toEqual(leafPaths(CATALOGS.en).sort());
    for (const locale of ["ko", "en"] as const) {
      const copy = getCopy(locale);
      for (const mission of ["find", "sort", "wipe", "latest", "bundle", "catch", "boss"] as const) {
        expect(Object.values(copy.missions[mission]).every((line) => line.trim().length > 0)).toBe(true);
      }
      expect(Object.keys(copy.failures).sort()).toEqual(["missed-file", "timeout", "wrong-bundle", "wrong-file", "wrong-folder"]);
      expect(formatCopy(copy.result.progress, { count: 2, total: 3 })).not.toMatch(/\{\w+\}/);
      expect(formatCopy(copy.common.missionProgress, { current: 1, total: 3 })).not.toMatch(/\{\w+\}/);
    }
  });
});
