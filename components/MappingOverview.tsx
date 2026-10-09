"use client";

import { memo } from "react";
import { Button } from "react-aria-components";
import { type ApplyState, type Choice, KEEP, ORIGINAL, type Outcome, outcome } from "@/lib/mapping";
import { type SetEmote, emoteImage, ownerName } from "@/lib/seventv";

interface Row {
  row: SetEmote;
  index: number;
}

/** The screen-reader description of a chip. */
function describe(row: SetEmote, c: Choice | undefined, o: Outcome, a: ApplyState | undefined, extra: boolean) {
  const where = extra ? "only in the seasonal set, " : "";
  let what: string;
  if (o.kind === "remove") what = extra ? `${where}removing` : `removing ${o.current.defaultName} from the seasonal set`;
  else if (o.kind === "swap")
    what = `${where}swap ${o.current.defaultName} by ${ownerName(o.current)} for ${o.emote.defaultName} by ${ownerName(o.emote)}`;
  else if (o.kind === "keep") what = extra ? `${where}keeping` : `already in the seasonal set as ${o.emote.defaultName}`;
  else if (!c) what = "unreviewed";
  else if (o.kind === "skip") what = c.kind === "remove" ? `${where}removed` : "skipped";
  else if (o.emote.id !== row.emote.id) what = `seasonal pick: ${o.emote.defaultName}`;
  else what = "copied as-is";
  const status = a?.state === "error" ? `failed: ${a.message}` : a?.state;
  return [what, status].filter(Boolean).join(", ");
}

/** The chip's style: struck through when the name ends up empty, otherwise what changes or the user's pick. */
function chipKind(c: Choice | undefined, o: Outcome, inTarget: boolean) {
  if (o.kind === "remove" || o.kind === "skip") return "exclude";
  if (inTarget) return o.kind === "swap" ? "replace" : "mapped";
  return c && c.kind !== "keep" ? c.kind : "undecided";
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
                  // Unreviewed names stay as they are if they're already in the seasonal set, else get copied.
                  const o = outcome(row, c ?? (cur ? KEEP : ORIGINAL), cur);
                  // Every chip reads base → what the seasonal set ends up with (one image when they're the same).
                  const end = o.kind === "remove" || o.kind === "skip" ? null : o.emote;
                  return (
                    <Button
                      key={row.alias}
                      className={[
                        "chip",
                        index === current ? "current" : "",
                        chipKind(c, o, !!cur),
                        a ? `apply-${a.state}` : "",
                      ].join(" ")}
                      onPress={() => onJump(index)}
                      aria-label={`${row.alias}: ${describe(row, c, o, a, !!section.extra)}`}
                      aria-current={index === current ? "step" : undefined}
                    >
                      <img src={emoteImage(row.emote.id, 1)} alt="" loading="lazy" />
                      {!end ? (
                        <span className="arrow">✗</span>
                      ) : end.id !== row.emote.id ? (
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
