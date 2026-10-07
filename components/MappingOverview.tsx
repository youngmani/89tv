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
      : "only in the seasonal set, keeping"
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
  /** `extra` marks the section of target-only emotes (keep or remove). */
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
                  return (
                    <Button
                      key={row.alias}
                      className={[
                        "chip",
                        index === current ? "current" : "",
                        extra
                          ? c?.kind === "remove"
                            ? "exclude"
                            : "mapped"
                          : cur
                            ? changes
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
                      <img src={emoteImage((cur?.emote ?? row.emote).id, 1)} alt="" loading="lazy" />
                      {changes ? (
                        <>
                          <span className="arrow">→</span>
                          <img src={emoteImage(t.id, 1)} alt="" loading="lazy" />
                        </>
                      ) : t === "exclude" ? (
                        <span className="arrow">✗</span>
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
