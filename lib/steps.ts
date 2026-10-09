import type { SetEmote } from "./seventv";

/**
 * The three groups of emotes, each shown as a tab (sections with no emotes are left out):
 *   - "pending": source emotes not yet in the target (to add)
 *   - "mapped": source emotes already in the target (can be swapped or removed)
 *   - "extra": target emotes not in the source (keep or remove)
 */
export type Section = "pending" | "mapped" | "extra";

/**
 * The screens a user steps through, in order: each section's emotes followed by its "done" step. A done step
 * points at the next section (null on the last one, which is the final "That's everything!").
 */
export type Step =
  | { kind: "pending"; row: SetEmote; n: number; of: number }
  | { kind: "mapped"; row: SetEmote; n: number; of: number }
  | { kind: "extra"; entry: SetEmote; n: number; of: number }
  | { kind: "done"; section: Section; next: Section | null };

export function buildSteps(pending: SetEmote[], mapped: SetEmote[], extras: SetEmote[]): Step[] {
  const sections = (
    [
      ["pending", pending],
      ["mapped", mapped],
      ["extra", extras],
    ] as const
  ).filter(([, rows]) => rows.length > 0);
  // Nothing in either set still gets a done step, so there's always something to show.
  if (!sections.length) return [{ kind: "done", section: "pending", next: null }];
  return sections.flatMap(([section, rows], i): Step[] => [
    ...rows.map((row, j): Step =>
      section === "extra"
        ? { kind: "extra", entry: row, n: j + 1, of: rows.length }
        : { kind: section, row, n: j + 1, of: rows.length },
    ),
    { kind: "done", section, next: sections[i + 1]?.[0] ?? null },
  ]);
}

/** The section a step belongs to. */
export const stepSection = (s: Step): Section => (s.kind === "done" ? s.section : s.kind);

/** The emote name a step is about, if any. Names are unique across sections. */
export const stepAlias = (s: Step | undefined): string | null =>
  !s ? null : "row" in s ? s.row.alias : "entry" in s ? s.entry.alias : null;

/** The source emote shown on a step (pending or mapped), if any. */
export const stepRow = (s: Step | undefined): SetEmote | undefined =>
  s && (s.kind === "pending" || s.kind === "mapped") ? s.row : undefined;
