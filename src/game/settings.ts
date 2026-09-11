import { normalizeLocale, type LocaleId } from "./i18n";

export type ModeId = "normal" | "relaxed";

export interface Settings {
  locale: LocaleId | null;
  mode: ModeId;
  muted: boolean;
  reducedMotion: boolean;
}

export interface SettingsSnapshot {
  settings: Settings;
  storageAvailable: boolean;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const SETTINGS_STORAGE_KEY = "finder-discovery:p0-settings:v1";
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  locale: null,
  mode: "normal",
  muted: false,
  reducedMotion: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizePatch(value: unknown): Partial<Settings> {
  if (!isRecord(value)) return {};
  const patch: Partial<Settings> = {};
  if (value.locale === null || value.locale === "ko" || value.locale === "en") {
    patch.locale = value.locale;
  }
  if (value.mode === "normal" || value.mode === "relaxed") patch.mode = value.mode;
  if (typeof value.muted === "boolean") patch.muted = value.muted;
  if (typeof value.reducedMotion === "boolean") patch.reducedMotion = value.reducedMotion;
  return patch;
}

function parseSettings(raw: string | null): Settings {
  if (raw === null) return { ...DEFAULT_SETTINGS };
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.schemaVersion !== 1) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...sanitizePatch(data) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** A per-page store: failed persistence never discards the player's live choice. */
export function createSettingsStore(storageAccess: () => StorageLike | null) {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let initialized = false;
  let storageAvailable = false;

  function snapshot(): SettingsSnapshot {
    return { settings: { ...settings }, storageAvailable };
  }

  function load(): SettingsSnapshot {
    if (initialized) return snapshot();
    initialized = true;
    try {
      const storage = storageAccess();
      if (storage) {
        settings = parseSettings(storage.getItem(SETTINGS_STORAGE_KEY));
        storageAvailable = true;
      }
    } catch {
      storageAvailable = false;
    }
    return snapshot();
  }

  function update(value: Partial<Settings>): SettingsSnapshot {
    load();
    const patch = sanitizePatch(value);
    if (Object.keys(patch).length === 0) return snapshot();
    settings = { ...settings, ...patch };
    try {
      const storage = storageAccess();
      if (!storage) {
        storageAvailable = false;
      } else {
        storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, ...settings }));
        storageAvailable = true;
      }
    } catch {
      storageAvailable = false;
    }
    return snapshot();
  }

  return { load, update };
}

/** A visit-only language override. This function never reads or writes storage. */
export function readLocaleOverride(search: string): LocaleId | null {
  return normalizeLocale(new URLSearchParams(search).get("lang"));
}

export function resolveVisitLocale(
  settings: Settings,
  search: string,
  browserLanguage = "ko",
): LocaleId {
  return readLocaleOverride(search) ?? settings.locale ?? normalizeLocale(browserLanguage) ?? "ko";
}
