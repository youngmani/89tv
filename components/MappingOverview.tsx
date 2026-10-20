"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  GridList,
  GridListHeader,
  GridListItem,
  GridListSection,
  type Key,
  ListLayout,
  Virtualizer,
} from "react-aria-components";
import { EmoteImage } from "@/components/EmoteImage";
import { type ApplyState, type Choice, KEEP, ORIGINAL, type Outcome, outcome } from "@/lib/mapping";
import { type SetEmote, ownerName } from "@/lib/seventv";

interface Row {
  row: SetEmote;
  index: number;
}

function describe(
  row: SetEmote,
  c: Choice | undefined,
  o: Outcome,
  a: ApplyState | undefined,
  extra: boolean,
) {
  const where = extra ? "only in the seasonal set, " : "";
  let what: string;
  if (o.kind === "remove")
    what = extra ? `${where}removing` : `removing ${o.current.defaultName} from the seasonal set`;
  else if (o.kind === "swap")
    what = `${where}swap ${o.current.defaultName} by ${ownerName(o.current)} for ${o.emote.defaultName} by ${ownerName(o.emote)}`;
  else if (o.kind === "keep")
    what = extra ? `${where}keeping` : `already in the seasonal set as ${o.emote.defaultName}`;
  else if (o.kind === "skip") what = c?.kind === "remove" ? `${where}removed` : "skipped";
  else if (o.emote.id !== row.emote.id) what = `seasonal pick: ${o.emote.defaultName}`;
  else what = "copied as-is";
  const status = a?.state === "error" ? `failed: ${a.message}` : a?.state;
  return [what, status].filter(Boolean).join(", ");
}

/** The chip's style: struck through when the name ends up empty, otherwise what changes or the user's pick. */
function chipKind(c: Choice | undefined, o: Outcome, inTarget: boolean) {
  if (o.kind === "remove" || o.kind === "skip") return "exclude";
  if (inTarget) return o.kind === "swap" ? "replace" : "mapped";
  // No pick on a new emote means it's copied as-is.
  return c && c.kind !== "keep" ? c.kind : "original";
}

/**
 * Row geometry for the virtualized list, in rem like the CSS (the heading's height in globals.css must match).
 * ListLayout and the scroll-into-view maths work in pixels, so these are converted with the page's root font size.
 */
const ROW_REM = 2.25;
const HEADING_REM = 2.25;
const GAP_REM = 0.25;
const PADDING_REM = 0.25;

/** The size of 1rem in pixels (16 unless the user changed their browser's font size). */
const remInPx = () =>
  typeof document === "undefined"
    ? 16
    : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * Every emote in the mapping, grouped into sections, as a virtualized GridList (sets can have 1000 emotes). Press
 * a row to jump to it. Keeps the current emote scrolled into view as the user moves through the cards.
 */
function MappingOverviewImpl({
  sections,
  current,
  choices,
  targetEntries,
  applyStates,
  onJump,
  followFocus = false,
}: {
  /** `extra` marks the section of target-only emotes (keep, swap or remove). */
  sections: { title: string; rows: Row[]; extra?: boolean }[];
  current: number;
  choices: Record<string, Choice>;
  targetEntries: Record<string, SetEmote>;
  applyStates: Record<string, ApplyState>;
  onJump: (index: number) => void;
  followFocus?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [rem] = useState(remInPx);
  const ROW = ROW_REM * rem;
  const HEADING = HEADING_REM * rem;
  const GAP = GAP_REM * rem;
  const PADDING = PADDING_REM * rem;
  // Derived from `sections` only, which the app keeps stable until the rows themselves change.
  const visible = useMemo(() => sections.filter((section) => section.rows.length > 0), [sections]);
  const { indexOf, aliasAt } = useMemo(() => {
    const rows = visible.flatMap((section) => section.rows);
    return {
      indexOf: new Map(rows.map(({ row, index }) => [row.alias, index])),
      aliasAt: new Map(rows.map(({ row, index }) => [index, row.alias])),
    };
  }, [visible]);
  const currentAlias = aliasAt.get(current);

  // Scroll the current row into view. With virtualization it may not be rendered, so first jump to where the
  // layout puts it (headings and rows have fixed sizes), then let the browser fine-tune once it exists.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !currentAlias) return;
    let y = PADDING;
    for (const section of visible) {
      y += HEADING + GAP;
      const i = section.rows.findIndex((r) => r.row.alias === currentAlias);
      if (i >= 0) {
        y += i * (ROW + GAP);
        break;
      }
      y += section.rows.length * (ROW + GAP);
    }
    if (y < list.scrollTop || y + ROW > list.scrollTop + list.clientHeight)
      list.scrollTop = Math.max(0, y - list.clientHeight / 2 + ROW / 2);
    // Only ever scroll the list itself (scrollIntoView would also scroll the page).
    requestAnimationFrame(() => {
      const row = list.querySelector(`[data-key="${CSS.escape(currentAlias)}"]`);
      if (!row) return;
      const r = row.getBoundingClientRect();
      const box = list.getBoundingClientRect();
      if (r.top < box.top) list.scrollTop -= box.top - r.top;
      else if (r.bottom > box.bottom) list.scrollTop += r.bottom - box.bottom;
    });
    // When the current emote changes, or the rows around it do (a new filter); not on every choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAlias, visible]);

  const jumpTo = (key: Key | undefined) => {
    const i = key === undefined ? undefined : indexOf.get(String(key));
    if (i !== undefined) onJump(i);
  };

  return (
    <Virtualizer
      layout={ListLayout}
      layoutOptions={{ rowSize: ROW, headingSize: HEADING, gap: GAP, padding: PADDING }}
    >
      <GridList
        ref={listRef}
        className="overview"
        aria-label="All emotes"
        selectionMode="single"
        selectionBehavior={followFocus ? "replace" : "toggle"}
        disallowEmptySelection
        escapeKeyBehavior="none"
        selectedKeys={currentAlias ? [currentAlias] : []}
        onSelectionChange={(keys) => keys !== "all" && jumpTo([...keys][0])}
      >
        {visible.map((section) => (
          <GridListSection key={section.title} id={section.title} className="overview-section">
            <GridListHeader>
              {section.title}
              <span className="count">{section.rows.length}</span>
            </GridListHeader>
            {section.rows.map(({ row, index }) => {
              const c = choices[row.alias];
              const a = applyStates[row.alias];
              const cur = targetEntries[row.alias];
              // Names without a pick stay as they are if they're already in the seasonal set, else get copied.
              const o = outcome(row, c ?? (cur ? KEEP : ORIGINAL), cur);
              // Every row reads base → what the seasonal set ends up with (one image when they're the same).
              const end = o.kind === "remove" || o.kind === "skip" ? null : o.emote;
              return (
                <GridListItem
                  key={row.alias}
                  id={row.alias}
                  textValue={row.alias}
                  className={[
                    "chip",
                    index === current ? "current" : "",
                    chipKind(c, o, !!cur),
                    a ? `apply-${a.state}` : "",
                  ].join(" ")}
                  aria-label={`${row.alias}: ${describe(row, c, o, a, !!section.extra)}`}
                >
                  <EmoteImage emote={row.emote} size="small" alt="" loading="lazy" index={index} />
                  {!end ? (
                    <span className="arrow">✗</span>
                  ) : end.id !== row.emote.id ? (
                    <>
                      <span className="arrow">→</span>
                      <EmoteImage emote={end} size="small" alt="" loading="lazy" index={index} />
                    </>
                  ) : null}
                  <span className="chip-name">{row.alias}</span>
                </GridListItem>
              );
            })}
          </GridListSection>
        ))}
      </GridList>
    </Virtualizer>
  );
}

export const MappingOverview = memo(MappingOverviewImpl);
