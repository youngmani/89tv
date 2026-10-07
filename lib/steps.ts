import type { SetEmote } from "./seventv";

/**
 * The screens a user steps through, in order:
 *   1. "pending": source emotes not yet in the target (to add)
 *   2. "summary": the first "All done!"
 *   3. "mapped": source emotes already in the target (can be swapped)
 *   4. "extra": target emotes not in the source (keep or remove)
 *   5. "end": the final "All done!", only when section 3 or 4 exists
 */
export type Step =
  | { kind: "pending"; row: SetEmote; n: number; of: number }
  | { kind: "summary" }
  | { kind: "mapped"; row: SetEmote; n: number; of: number }
  | { kind: "extra"; entry: SetEmote; n: number; of: number }
  | { kind: "end" };

export function buildSteps(pending: SetEmote[], mapped: SetEmote[], extras: SetEmote[]): Step[] {
  const steps: Step[] = [
    ...pending.map((row, i) => ({ kind: "pending" as const, row, n: i + 1, of: pending.length })),
    { kind: "summary" },
    ...mapped.map((row, i) => ({ kind: "mapped" as const, row, n: i + 1, of: mapped.length })),
    ...extras.map((entry, i) => ({ kind: "extra" as const, entry, n: i + 1, of: extras.length })),
  ];
  if (mapped.length || extras.length) steps.push({ kind: "end" });
  return steps;
}

/** The emote name a step is about, if any. Names are unique across sections. */
export const stepAlias = (s: Step | undefined): string | null =>
  !s ? null : "row" in s ? s.row.alias : "entry" in s ? s.entry.alias : null;

/** The source emote shown on a step (pending or mapped), if any. */
export const stepRow = (s: Step | undefined): SetEmote | undefined =>
  s && (s.kind === "pending" || s.kind === "mapped") ? s.row : undefined;
