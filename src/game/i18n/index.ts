import { en } from "./en";
import { ko } from "./ko";
import type { FinderCopy, LocaleId } from "./types";

export type { FinderCopy, LocaleId, MissionCopy, MissionId } from "./types";
export const CATALOGS: Readonly<Record<LocaleId, FinderCopy>> = { ko, en };

export function getCopy(locale: LocaleId): FinderCopy {
  return CATALOGS[locale];
}

export function formatCopy(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder,
  );
}

export function normalizeLocale(value: unknown): LocaleId | null {
  if (typeof value !== "string") return null;
  const language = value.trim().toLowerCase().split(/[-_]/)[0];
  return language === "ko" || language === "en" ? language : null;
}
