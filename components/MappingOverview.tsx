"use client";

import { memo } from "react";
import { Button } from "react-aria-components";
import type { ApplyState, Choice } from "@/lib/mapping";
import { type EmoteSummary, type SetEmote, emoteImage, ownerName } from "@/lib/seventv";

interface Row {
  row: SetEmote;
  index: number;
}

/** What the chip should show the emote turning into, if anything changes. */
function target(row: SetEmote, c: Choice | undefined, current: SetEmote | undefined): EmoteSummary | "exclude" | null {
  if (c?.kind === "exclude" || c?.kind === "remove") return "exclude";
  const want = c?.kind === "replace" ? c.emote : c?.kind === "original" ? row.emote : null;
  if (!want) return null;
  if (current) return want.id === current.emote.id ? null : want;
  return want.id === row.emote.id ? null : want;
}

/**
 * What the seasonal set ends up with for this row, for the chip's "base → result" display: an emote, or
 * "exclude" when it's skipped/removed. Unlike target(), this is the end state, not just the change.
 */
function result(
  row: SetEmote,
  c: Choice | undefined,
  current: SetEmote | undefined,
): EmoteSummary | "exclude" {
  if (c?.kind === "exclude" || c?.kind === "remove") return "exclude";
  if (c?.kind === "replace") return c.emote;
  if (current && c?.kind !== "original") return current.emote; // kept as-is (or not reviewed)
  return row.emote;
}

function describe(
  row: SetEmote,
  c: Choice | undefined,
  a: ApplyState | undefined,
  current: SetEmote | undefined,
  extra: boolean,
) {
  const t = target(row, c, current);
  const what = extra
    ? c?.kind === "remove"
      ? "only in the seasonal set, removing"
      : t && t !== "exclude" && current
        ? `only in the seasonal set, swap ${current.emote.defaultName} for ${t.defaultName} by ${ownerName(t)}`
        : "only in the seasonal set, keeping"
    : current && c?.kind === "remove"
      ? `removing ${current.emote.defaultName} from the seasonal set`
      : current
    ? t && t !== "exclude"
      ? `swap ${current.emote.defaultName} by ${ownerName(current.emote)} for ${t.defaultName} by ${ownerName(t)}`
      : `already in the seasonal set as ${current.emote.defaultName}`
    : !c
      ? "unreviewed"
      : t === "exclude"
        ? "skipped"
        : t
          ? `seasonal pick: ${t.defaultName}`
          : "copied as-is";
  const status = a?.state === "error" ? `failed: ${a.message}` : a?.state;
  return [what, status].filter(Boolean).join(", ");
}

/** Compact grid of every emote in the mapping, grouped into sections. Press one to jump to it. */
function MappingOverviewImpl({
  sections,
  current,
  choices,
  targetEntries,
  applyStates,
  onJump,
}: {
  /** `extra` marks the section of target-only emotes (keep, swap or remove). */
  sections: { title: string; rows: Row[]; extra?: boolean }[];
  current: number;
  choices: Record<string, Choice>;
  targetEntries: Record<string, SetEmote>;
  applyStates: Record<string, ApplyState>;
  onJump: (index: number) => void;
}) {
  return (
    <>
      {sections.map(
        (section) =>
          section.rows.length > 0 && (
            <div key={section.title} className="overview-section">
              <h4>
                {section.title} <span className="muted">({section.rows.length})</span>
              </h4>
              <div className="overview">
                {section.rows.map(({ row, index }) => {
                  const c = choices[row.alias];
                  const a = applyStates[row.alias];
                  const cur = targetEntries[row.alias];
                  const t = target(row, c, cur);
                  const changes = !!t && t !== "exclude";
                  const extra = !!section.extra;
                  // Every chip reads base → what the seasonal set ends up with (one image when they're the same).
                  const end = result(row, c, cur);
                  const differs = end !== "exclude" && end.id !== row.emote.id;
                  return (
                    <Button
                      key={row.alias}
                      className={[
                        "chip",
                        index === current ? "current" : "",
                        cur
                            ? c?.kind === "remove"
                              ? "exclude"
                              : changes
                                ? "replace"
                                : "mapped"
                            : c && c.kind !== "keep"
                              ? c.kind
                              : "undecided",
                        a ? `apply-${a.state}` : "",
                      ].join(" ")}
                      onPress={() => onJump(index)}
                      aria-label={`${row.alias}: ${describe(row, c, a, cur, extra)}`}
                      aria-current={index === current ? "step" : undefined}
                    >
                      <img src={emoteImage(row.emote.id, 1)} alt="" loading="lazy" />
                      {end === "exclude" ? (
                        <span className="arrow">✗</span>
                      ) : differs ? (
                        <>
                          <span className="arrow">→</span>
                          <img src={emoteImage(end.id, 1)} alt="" loading="lazy" />
                        </>
                      ) : null}
                      <span className="chip-name">{row.alias}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ),
      )}
    </>
  );
}

export const MappingOverview = memo(MappingOverviewImpl);
