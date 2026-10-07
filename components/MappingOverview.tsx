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
  if (c?.kind === "exclude") return "exclude";
  const want = c?.kind === "replace" ? c.emote : c?.kind === "original" ? row.emote : null;
  if (!want) return null;
  if (current) return want.id === current.emote.id ? null : want;
  return want.id === row.emote.id ? null : want;
}

function describe(row: SetEmote, c: Choice | undefined, a: ApplyState | undefined, current: SetEmote | undefined) {
  const t = target(row, c, current);
  const what = current
    ? t && t !== "exclude"
      ? `swap ${current.emote.defaultName} by ${ownerName(current.emote)} for ${t.defaultName} by ${ownerName(t)}`
      : `in target as ${current.emote.defaultName}`
    : !c
      ? "not reviewed"
      : t === "exclude"
        ? "not copied"
        : t
          ? `seasonal: ${t.defaultName}`
          : "kept original";
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
  sections: { title: string; rows: Row[] }[];
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
                  return (
                    <Button
                      key={row.alias}
                      className={[
                        "chip",
                        index === current ? "current" : "",
                        cur ? (changes ? "replace" : "mapped") : c && c.kind !== "keep" ? c.kind : "undecided",
                        a ? `apply-${a.state}` : "",
                      ].join(" ")}
                      onPress={() => onJump(index)}
                      aria-label={`${row.alias}: ${describe(row, c, a, cur)}`}
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
