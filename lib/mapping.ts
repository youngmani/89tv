import type { EmoteSummary, SearchResult, SetEmote, SortBy } from "./seventv";
import { load, save } from "./storage";
import type { Section } from "./steps";

/**
 * What to do with one emote name. "original" and "replace" pick the emote the name should end up with. The rest
 * depend on whether the target already has the name: "exclude" leaves a name that isn't there yet out (don't
 * copy it), while "keep" and "remove" apply to names already in the target (leave as is, or delete it).
 */
export type Choice =
  | { kind: "original" }
  | { kind: "replace"; emote: EmoteSummary }
  | { kind: "exclude" }
  | { kind: "keep" }
  | { kind: "remove" };

export interface SearchOptions {
  /** What's in the search box. Blank means "the emote's own name"; an emote link or ID is looked up directly. */
  input: string;
  exact: boolean;
  /** Restrict to the theme's tags. Off searches every emote with that name. */
  tagged: boolean;
  sortBy: SortBy;
}

export interface SearchState extends SearchOptions {
  status: "loading" | "done" | "error";
  /** The text actually searched for (the emote's name when the box was blank). */
  query: string;
  /**
   * "link": the box held an emote link/ID and that emote was found directly.
   * "link-missing": it held one, but no such emote exists, so a normal search ran instead.
   */
  via?: "link" | "link-missing";
  items: SearchResult[];
  total: number;
  /** Results dropped because 7TV won't add them to the target (deleted, or someone else's private emote). */
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

/**
 * What a choice does to the seasonal set, given what it holds under that name now (`current`):
 *   - "add": the name is free and `emote` goes in
 *   - "swap": `current` comes out and `emote` goes in under the same name
 *   - "keep": the set already holds `emote` there, so nothing changes
 *   - "remove": `current` comes out
 *   - "skip": the name is free and stays that way
 */
export type Outcome =
  | { kind: "add"; emote: EmoteSummary }
  | { kind: "swap"; emote: EmoteSummary; current: EmoteSummary }
  | { kind: "keep"; emote: EmoteSummary }
  | { kind: "remove"; current: EmoteSummary }
  | { kind: "skip" };

/** The single place that decides what a row ends up as. `row` is the base emote (or, for a target-only name, its entry). */
export function outcome(row: SetEmote, choice: Choice, current: SetEmote | undefined): Outcome {
  const cur = current?.emote;
  const want =
    choice.kind === "replace"
      ? choice.emote
      : choice.kind === "original"
        ? row.emote
        : choice.kind === "keep"
          ? cur
          : undefined;
  if (!cur) return want ? { kind: "add", emote: want } : { kind: "skip" };
  if (choice.kind === "remove") return { kind: "remove", current: cur };
  // "exclude" only means something for a name that isn't there yet; on one that is, it leaves it alone.
  if (!want || want.id === cur.id) return { kind: "keep", emote: cur };
  return { kind: "swap", emote: want, current: cur };
}

// ---------- Themes ----------

// `palette` selects the site-wide colour scheme (see [data-theme] in globals.css).
export const THEMES = {
  halloween: { icon: "🎃", name: "Halloween", tags: ["halloween"], palette: "halloween" },
  christmas: { icon: "🎄", name: "Christmas", tags: ["christmas", "xmas"], palette: "winter" },
  custom: { icon: "✨", name: "Custom", tags: [] as string[], palette: "neutral" },
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

export interface MappingParams {
  sourceId: string;
  targetId: string;
  theme: Theme;
  customTags: string;
  sortBy: SortBy;
}

export const mappingParams = ({
  sourceId,
  targetId,
  theme,
  customTags,
  sortBy,
}: MappingParams): MappingParams => ({
  sourceId,
  targetId,
  theme,
  customTags,
  sortBy,
});

/**
 * A mapping is "in progress" from the moment the user starts it until they cancel it or every emote
 * has been added. Only that one mapping is persisted; nothing else (no general preferences).
 */
export interface MappingRecord extends MappingParams {
  choices: Record<string, Choice>;
  /** Alias of the emote on screen; aliases are stable even when the pending list shrinks. */
  currentAlias: string | null;
  /** The section whose "done" step the user was on, if any. */
  atDone?: Section;
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
