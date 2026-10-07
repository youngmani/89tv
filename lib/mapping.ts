import type { EmoteSummary, SearchResult, SortBy } from "./seventv";
import { load, save } from "./storage";

/**
 * What to do with one emote name. "keep" applies to names already in the target (leave them as they are);
 * "exclude" to source emotes not yet there (don't copy); "remove" to target emotes that aren't in the
 * source (delete them from the target).
 */
export type Choice =
  | { kind: "original" }
  | { kind: "replace"; emote: EmoteSummary }
  | { kind: "exclude" }
  | { kind: "keep" }
  | { kind: "remove" };

/** Options for one emote search; each emote can tweak these independently. */
export interface SearchOptions {
  query: string;
  exact: boolean;
  /** Restrict to the theme's tags. Off searches every emote with that name. */
  tagged: boolean;
  sortBy: SortBy;
}

export interface SearchState extends SearchOptions {
  status: "loading" | "done" | "error";
  items: SearchResult[];
  total: number;
  /** Results dropped because they can't be added (private or deleted). */
  hidden: number;
  error?: string;
}

export const SORT_OPTIONS: { id: SortBy; label: string }[] = [
  // Same terms as 7tv.app's emote browser (Top / Trending / New).
  { id: "TOP_ALL_TIME", label: "Top" },
  { id: "TOP_MONTHLY", label: "Top this month" },
  { id: "TRENDING_MONTHLY", label: "Trending this month" },
  { id: "TRENDING_WEEKLY", label: "Trending this week" },
  { id: "UPLOAD_DATE", label: "New" },
];

export type ApplyState = {
  state: "queued" | "running" | "added" | "updated" | "removed" | "error";
  message?: string;
};

export const ORIGINAL: Choice = { kind: "original" };
export const KEEP: Choice = { kind: "keep" };

// ---------- Themes ----------

// `palette` selects the site-wide colour scheme (see [data-theme] in globals.css).
export const THEMES = {
  halloween: { label: "🎃 Halloween", tags: ["halloween"], palette: "halloween" },
  christmas: { label: "🎄 Christmas", tags: ["christmas", "xmas"], palette: "winter" },
  custom: { label: "✨ Something else", tags: [] as string[], palette: "neutral" },
} as const;
export type Theme = keyof typeof THEMES;

/** Sept 1 – Oct 31 → Halloween, Nov 1 – Jan 7 → Christmas, otherwise custom tags. */
export function themeForDate(d = new Date()): Theme {
  const m = d.getMonth();
  if (m === 8 || m === 9) return "halloween";
  if (m === 10 || m === 11 || (m === 0 && d.getDate() <= 7)) return "christmas";
  return "custom";
}

export const DEFAULT_SORT: SortBy = "TOP_ALL_TIME";

// ---------- The in-progress mapping ----------

/**
 * A mapping is "in progress" from the moment the user starts it until they cancel it or every emote
 * has been added. Only that one mapping is persisted; nothing else (no general preferences).
 */
export interface MappingRecord {
  sourceId: string;
  targetId: string;
  theme: Theme;
  customTags: string;
  sortBy: SortBy;
  choices: Record<string, Choice>;
  /** Alias of the emote on screen; aliases are stable even when the pending list shrinks. */
  currentAlias: string | null;
  /** Which "All done!" step the user was on, if any: after the emotes to add, or at the very end. */
  atStep?: "summary" | "end";
  /**
   * Swap journal: entries removed from the target whose replacement hasn't been confirmed yet. Written
   * before each remove, cleared once the new emote (or the rollback) is in. If the page closes mid-swap,
   * this is how the previous emote can still be restored on resume.
   */
  removed?: Record<string, RemovedEntry>;
}

export interface RemovedEntry {
  emote: EmoteSummary;
  zeroWidth: boolean;
}

const MAPPING_KEY = "89tv:mapping";

export const loadMapping = () => load<MappingRecord | null>(MAPPING_KEY, null);
export const saveMapping = (m: MappingRecord) => save(MAPPING_KEY, m);
export const clearMapping = () => save(MAPPING_KEY, null);

/** Drops storage keys written by earlier versions of the app. */
export function clearLegacyStorage() {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (/^89tv:(prefs|progress:|choices:)/.test(k)) window.localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
