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
  aprilfools: { icon: "🤡", name: "April Fools", tags: [] as string[], palette: "aprilfools" },
  halloween: { icon: "🎃", name: "Halloween", tags: ["halloween"], palette: "halloween" },
  christmas: { icon: "🎄", name: "Christmas", tags: ["christmas", "xmas"], palette: "winter" },
  custom: { icon: "✨", name: "Custom", tags: [] as string[], palette: "neutral" },
} as const;
export type Theme = keyof typeof THEMES;

/** Mar 1 – Apr 2 → April Fools, Sept 1 – Oct 31 → Halloween, Nov 1 – Jan 7 → Christmas, otherwise custom tags. */
export function themeForDate(d = new Date()): Theme {
  const m = d.getMonth();
  if (m === 2 || (m === 3 && d.getDate() <= 2)) return "aprilfools";
  if (m === 8 || m === 9) return "halloween";
  if (m === 10 || m === 11 || (m === 0 && d.getDate() <= 7)) return "christmas";
  return "custom";
}

const SET_NAME_THEMES: [Theme, RegExp][] = [
  ["aprilfools", /april|fools|prank|🤡/i],
  ["halloween", /halloween|spooky|october|pumpkin|🎃/i],
  ["christmas", /christmas|xmas|holiday|festive|winter|december|🎄/i],
];

export function themeForSetName(name: string): Theme | null {
  return SET_NAME_THEMES.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

export const DEFAULT_SORT: SortBy = "TOP_ALL_TIME";

// ---------- The in-progress mapping ----------

/**
 * What happens to the names already in the seasonal set: "keep" leaves them alone, "reset" pranks the ones the base
 * set also has and removes the rest, "include" pranks them all.
 */
export type ExistingEmotes = "keep" | "reset" | "include";

/**
 * April Fools: every pranked name shows `emote`, or with "shuffle" each shows the next one's emote in a random
 * cycle through them. `saved` is set once any of it has been saved, after which re-shuffling would break the cycle.
 */
export type Prank = { existing: ExistingEmotes; saved?: boolean } & (
  | { kind: "single"; emote: EmoteSummary }
  | { kind: "shuffle" }
);

export interface MappingParams {
  sourceId: string;
  targetId: string;
  theme: Theme;
  customTags: string;
  sortBy: SortBy;
  /** Only for April Fools, once chosen. */
  prank?: Prank;
}

export const mappingParams = ({
  sourceId,
  targetId,
  theme,
  customTags,
  sortBy,
  prank,
}: MappingParams): MappingParams => ({
  sourceId,
  targetId,
  theme,
  customTags,
  sortBy,
  ...(prank && { prank }),
});

interface PrankRows {
  pending: SetEmote[];
  mapped: SetEmote[];
  extras: SetEmote[];
  /** What the seasonal set holds under each name now. */
  current: Record<string, SetEmote>;
}

// "include" pranks the seasonal set as it is, so names in both sets bring the seasonal set's emote, not the base one.
export const prankNames = (
  existing: ExistingEmotes,
  { pending, mapped, extras, current }: PrankRows,
) =>
  existing === "keep"
    ? pending
    : existing === "reset"
      ? [...pending, ...mapped]
      : [...pending, ...mapped.map((row) => current[row.alias] ?? row), ...extras];

export function prankChoices(prank: Prank, rows: PrankRows): Record<string, Choice> {
  const names = prankNames(prank.existing, rows);
  const choices: Record<string, Choice> = {};
  if (prank.existing === "reset")
    for (const e of rows.extras) choices[e.alias] = { kind: "remove" };
  if (prank.kind === "single") {
    for (const row of names) choices[row.alias] = { kind: "replace", emote: prank.emote };
    return choices;
  }
  const order = [...names];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((row, i) => {
    choices[row.alias] = { kind: "replace", emote: order[(i + 1) % order.length].emote };
  });
  return choices;
}

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

const isEmote = (e: unknown): e is EmoteSummary =>
  !!e && typeof e === "object" && typeof (e as EmoteSummary).id === "string";

function isPrank(p: unknown): p is Prank {
  if (!p || typeof p !== "object") return false;
  const { kind, existing, saved, emote } = p as Record<string, unknown>;
  if (existing !== "keep" && existing !== "reset" && existing !== "include") return false;
  if (saved !== undefined && typeof saved !== "boolean") return false;
  return kind === "shuffle" || (kind === "single" && isEmote(emote));
}

// Saved by earlier versions too, so anything this version doesn't recognise is dropped rather than trusted.
export function loadMapping(): MappingRecord | null {
  const saved = load<MappingRecord | null>(MAPPING_KEY, null);
  if (!saved || typeof saved !== "object" || !(saved.theme in THEMES)) return null;
  const { prank, ...rest } = saved;
  return isPrank(prank) ? { ...rest, prank } : rest;
}
export const saveMapping = (m: MappingRecord) => save(MAPPING_KEY, m);
export const clearMapping = () => save(MAPPING_KEY, null);
