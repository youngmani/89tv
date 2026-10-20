"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Button, Checkbox, Form, Input, TextField, ToggleButton } from "react-aria-components";
import { EmoteImage } from "@/components/EmoteImage";
import { Link } from "@/components/Link";
import { ErrorText, SelectField, Spinner } from "@/components/ui";
import { shouldIgnoreKey } from "@/lib/hotkeys";
import {
  type ApplyState,
  type Choice,
  KEEP,
  ORIGINAL,
  type RemovedEntry,
  SORT_OPTIONS,
  type SearchOptions,
  type SearchState,
  outcome,
} from "@/lib/mapping";
import { type EmoteSummary, type SetEmote, type SortBy, emotePage, ownerName } from "@/lib/seventv";

/** A selectable emote. The 7tv.app link is a sibling of the button, never nested inside it. */
function Tile({
  emote,
  selected,
  onSelect,
  badge,
  hotkey,
  note,
  isDisabled,
  index,
  zeroWidth = emote.flags.defaultZeroWidth,
}: {
  emote: EmoteSummary;
  selected: boolean;
  onSelect: () => void;
  isDisabled?: boolean;
  badge?: string;
  hotkey?: string;
  /** Extra context shown under the owner, e.g. "in target as foo". */
  note?: string;
  /** Position in the grid, to stagger the loading placeholder. */
  index?: number;
  /** Whether to mark it zero-width: how it's set in its set, or (for search results) the emote's default. */
  zeroWidth?: boolean;
}) {
  return (
    <div className="tile-wrap">
      <ToggleButton
        className="tile"
        isSelected={selected}
        isDisabled={isDisabled}
        onChange={onSelect}
        aria-label={`${badge ? `${badge}: ` : ""}${emote.defaultName} by ${ownerName(emote)}${zeroWidth ? ", zero-width" : ""}${note ? `, ${note}` : ""}`}
      >
        {badge && <span className="badge">{badge}</span>}
        <EmoteImage emote={emote} size="large" alt="" index={index} />
        <span className="name">{emote.defaultName}</span>
        <span className="owner">{ownerName(emote)}</span>
        {note && <span className="note">{note}</span>}
        {zeroWidth && (
          // Two overlapping squares: a zero-width emote is an overlay on the emote before it.
          <svg className="zero-width" viewBox="0 0 16 16" aria-hidden>
            <title>Zero-width</title>
            <rect x="1.5" y="1.5" width="9" height="9" rx="2" />
            <rect x="5.5" y="5.5" width="9" height="9" rx="2" />
          </svg>
        )}
        {hotkey && (
          <kbd className="hotkey" aria-hidden>
            {hotkey}
          </kbd>
        )}
      </ToggleButton>
      <Link
        className="ext"
        href={emotePage(emote.id)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${emote.defaultName} on 7tv.app`}
      >
        ↗
      </Link>
    </div>
  );
}

/**
 * The emote currently being mapped. Picking anything advances to the next emote. Also used for emotes only in
 * the seasonal set (`inBase` false): the same card without a base emote, so they can be kept, swapped or removed.
 * Keys: 0 keep the base emote (or the current one, if it's already in the seasonal set) · 1–9 pick a result · X skip ·
 * →/Enter next · ← back.
 */
export function MappingFocus({
  source,
  position,
  canPrev,
  canNext,
  inTarget,
  inBase = true,
  previous,
  tags,
  choice,
  search,
  apply,
  defaultSort,
  onChoose,
  onSearch,
  onNavigate,
}: {
  source: SetEmote;
  /** e.g. "3 of 18" - where this emote sits in its group. */
  position: string;
  canPrev: boolean;
  canNext: boolean;
  inTarget: SetEmote | undefined;
  /** False for an emote only in the seasonal set: `source` is then its seasonal-set entry, and there's no base. */
  inBase?: boolean;
  /** The emote that held this name before a swap that was interrupted (page closed mid-swap). */
  previous: RemovedEntry | undefined;
  tags: string[];
  choice: Choice;
  search: SearchState | undefined;
  apply: ApplyState | undefined;
  /** The mapping's sort; each emote can override it. */
  defaultSort: SortBy;
  onChoose: (choice: Choice, advance: boolean) => void;
  onSearch: (opts: SearchOptions) => void;
  onNavigate: (delta: number) => void;
}) {
  const [opts, setOpts] = useState<SearchOptions>({
    // Blank until the user types: an empty box still searches the emote's own name.
    input: search?.input ?? "",
    exact: search?.exact ?? true,
    tagged: search?.tagged ?? true,
    sortBy: search?.sortBy ?? defaultSort,
  });
  /** Filters re-run the search immediately; the query text waits for Search / Enter. */
  const update = (patch: Partial<SearchOptions>, run: boolean) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    if (run) onSearch(next);
  };

  const mapped = !!inTarget;
  const current = inTarget?.emote;
  // "0" means "leave it as the source has it": the original for new emotes, the current entry for mapped ones.
  const baseline = mapped ? KEEP : ORIGINAL;
  // While a new search runs, the previous results stay up (dimmed, not selectable) under a spinner.
  const loading = !search || search.status === "loading";
  const items = useMemo(
    () => (search?.items ?? []).filter((e) => e.id !== current?.id && e.id !== previous?.emote.id),
    [search, current, previous],
  );

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (shouldIgnoreKey(e)) return;
    if (e.key === "ArrowLeft") onNavigate(-1);
    else if (e.key === "ArrowRight" || e.key === "Enter") onNavigate(1);
    else if (e.key === "0") onChoose(baseline, true);
    else if (e.key.toLowerCase() === "x") onChoose({ kind: mapped ? "remove" : "exclude" }, true);
    else if (/^[1-9]$/.test(e.key) && !loading && items[Number(e.key) - 1])
      onChoose({ kind: "replace", emote: items[Number(e.key) - 1] }, true);
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const aliased = source.alias !== source.emote.defaultName;
  const chosen = choice.kind === "replace" ? choice.emote : null;
  // The pick gets its own tile only if no other tile (current, previous, or a result) already shows it.
  const chosenMissing =
    chosen && ![current?.id, previous?.emote.id, ...items.map((e) => e.id)].includes(chosen.id);
  // What the seasonal set ends up with, shown next to the original when it's a different emote (like the
  // overview chips). Nothing when it's skipped or removed: the struck-through name says that.
  const o = outcome(source, choice, inTarget);
  const result = o.kind === "remove" || o.kind === "skip" ? undefined : o.emote;
  const changed = result && result.id !== source.emote.id ? result : undefined;
  // A swap's third emote: what the seasonal set holds now and is about to lose. Named in the subtitle, small,
  // so the header stays "base → new".
  const replacing = o.kind === "swap" ? o.current : undefined;
  const keepsCurrent = o.kind === "keep";
  // Each tile's position in the grid (pinned tiles first, then results), so the loading pulse ripples across all.
  let tileIndex = 0;

  return (
    <section className="card focus" aria-label={`Picking for ${source.alias}`}>
      <div className="focus-head">
        {/* Hidden (not just disabled) when unusable, but it keeps its space so nothing shifts. */}
        <Button
          className={`btn nav${canPrev ? "" : " invisible"}`}
          onPress={() => onNavigate(-1)}
          isDisabled={!canPrev}
          aria-label="Previous"
        >
          ←
        </Button>
        <div className="focus-title">
          {changed ? (
            <div
              className="focus-images"
              role="img"
              aria-label={`${source.emote.defaultName} → ${changed.defaultName}`}
            >
              <EmoteImage emote={source.emote} size="large" alt="" />
              <span className="arrow" aria-hidden>
                →
              </span>
              <EmoteImage emote={changed} size="large" alt="" />
            </div>
          ) : (
            <EmoteImage emote={source.emote} size="large" alt="" />
          )}
          <div
            className={`alias${choice.kind === "remove" || choice.kind === "exclude" ? " struck" : ""}`}
          >
            {source.alias}
          </div>
          <div className="muted small">
            {aliased ? <>7TV name: {source.emote.defaultName} · </> : null}
            {source.flags.zeroWidth ? "zero-width · " : ""}
            {replacing ? (
              <span className="replacing">
                replacing <EmoteImage emote={replacing} size="small" alt="" />{" "}
                {replacing.defaultName} ·{" "}
              </span>
            ) : !inBase ? (
              "only in your seasonal set · "
            ) : mapped ? (
              "already added · "
            ) : (
              ""
            )}
            {position}
          </div>
        </div>
        <Button
          className={`btn nav${canNext ? "" : " invisible"}`}
          onPress={() => onNavigate(1)}
          isDisabled={!canNext}
          aria-label="Next"
        >
          →
        </Button>
      </div>

      <Form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({}, true);
        }}
      >
        <div className="search-row">
          <TextField
            className="field grow"
            value={opts.input}
            onChange={(input) => update({ input }, false)}
            aria-label="Search, or paste an emote link"
          >
            <Input placeholder="Search, or paste an emote link" />
          </TextField>
          <Button type="submit" className="btn">
            Search
          </Button>
        </div>
        <div className="search-filters">
          <Checkbox
            className="checkbox"
            isSelected={opts.exact}
            onChange={(exact) => update({ exact }, true)}
          >
            <span className="box" aria-hidden>
              ✓
            </span>
            Exact name
          </Checkbox>
          <Checkbox
            className="checkbox"
            isSelected={opts.tagged}
            onChange={(tagged) => update({ tagged }, true)}
          >
            <span className="box" aria-hidden>
              ✓
            </span>
            Only {tags.join(" / ")} emotes
          </Checkbox>
          <SelectField
            aria-label="Sort by"
            className="compact"
            items={SORT_OPTIONS}
            value={opts.sortBy}
            onChange={(id) => update({ sortBy: id as SortBy }, true)}
          />
        </div>
      </Form>

      {apply?.state === "error" && (
        <div className="alert" role="alert">
          <b>Failed:</b> <ErrorText message={apply.message ?? ""} />
        </div>
      )}
      {apply?.state === "added" && <div className="ok small">✓ Added</div>}
      {apply?.state === "updated" && <div className="ok small">✓ Swapped</div>}
      {apply?.state === "removed" && <div className="ok small">✓ Removed</div>}

      <div className={`tiles-area${loading ? " loading" : ""}`}>
        {loading && <Spinner label="Searching" className="spinner" />}
        <div className="tiles">
          {previous && (
            <Tile
              emote={previous.emote}
              selected={chosen?.id === previous.emote.id}
              onSelect={() => onChoose({ kind: "replace", emote: previous.emote }, true)}
              badge="previous"
              note="removed by an interrupted save"
              index={tileIndex++}
            />
          )}
          {/* Base before current, in the same order as the header's "base → current". */}
          {inBase && (!mapped || current?.id !== source.emote.id) && (
            <Tile
              emote={source.emote}
              selected={choice.kind === "original" && !keepsCurrent}
              onSelect={() => onChoose({ kind: "original" }, true)}
              badge="base"
              zeroWidth={source.flags.zeroWidth}
              hotkey={mapped ? undefined : "0"}
              index={tileIndex++}
            />
          )}
          {mapped && current && (
            <Tile
              emote={current}
              selected={keepsCurrent}
              onSelect={() => onChoose({ kind: "keep" }, true)}
              badge={current.deleted ? "current (deleted)" : "current"}
              zeroWidth={inTarget?.flags.zeroWidth}
              hotkey="0"
              index={tileIndex++}
            />
          )}
          {chosen && chosenMissing && (
            <Tile
              emote={chosen}
              selected
              onSelect={() => onChoose(choice, true)}
              badge="chosen"
              index={tileIndex++}
            />
          )}
          {items.map((e, i) => (
            <Tile
              key={e.id}
              emote={e}
              selected={chosen?.id === e.id}
              onSelect={() => onChoose({ kind: "replace", emote: e }, true)}
              isDisabled={loading}
              hotkey={i < 9 ? String(i + 1) : undefined}
              index={tileIndex++}
              note={
                e.inTarget.length ? `in your seasonal set as ${e.inTarget.join(", ")}` : undefined
              }
            />
          ))}
        </div>
      </div>

      <div className="muted small status" aria-live="polite">
        {!search || search.status === "loading" ? (
          "Searching…"
        ) : search.status === "error" ? (
          <>
            <span className="error">
              Couldn&apos;t search: <ErrorText message={search.error ?? ""} />
            </span>{" "}
            <Button className="link-button" onPress={() => onSearch(search)}>
              Retry
            </Button>
          </>
        ) : (
          <>
            {search.via === "link" ? (
              !items.length && search.hidden ? (
                "The linked emote is private."
              ) : (
                "Linked emote"
              )
            ) : (
              <>
                {search.via === "link-missing" &&
                  "No emote with that ID. Showing search results instead: "}
                {search.total} result{search.total === 1 ? "" : "s"} for “{search.query}”
              </>
            )}
            {search.via !== "link" &&
              search.hidden > 0 &&
              ` · hiding ${search.hidden} private or deleted`}
            {search.via !== "link" && search.exact && (
              <>
                {" · "}
                <Button className="link-button" onPress={() => update({ exact: false }, true)}>
                  try a looser match
                </Button>
              </>
            )}
            {search.via !== "link" && search.tagged && (
              <>
                {" · "}
                <Button className="link-button" onPress={() => update({ tagged: false }, true)}>
                  include non-{tags.join("/")} emotes
                </Button>
              </>
            )}
          </>
        )}
        {chosen && (
          <>
            {" "}
            · will be {mapped ? "swapped in" : "added"} as <b>{source.alias}</b>
          </>
        )}
      </div>

      <div className="focus-foot">
        {mapped ? (
          <ToggleButton
            className="btn danger"
            isSelected={choice.kind === "remove"}
            onChange={() => onChoose({ kind: "remove" }, true)}
          >
            Remove from seasonal set <kbd aria-hidden>X</kbd>
          </ToggleButton>
        ) : (
          <ToggleButton
            className="btn danger"
            isSelected={choice.kind === "exclude"}
            onChange={() => onChoose({ kind: "exclude" }, true)}
          >
            Skip this emote <kbd aria-hidden>X</kbd>
          </ToggleButton>
        )}
        <div className="muted small keys" aria-hidden>
          <kbd>0</kbd> {mapped ? "keep current" : "use base"} · <kbd>1</kbd>–<kbd>9</kbd> pick ·{" "}
          <kbd>X</kbd> {mapped ? "remove" : "skip"} · <kbd>→</kbd>/<kbd>Enter</kbd> next ·{" "}
          <kbd>←</kbd> back
        </div>
      </div>
    </section>
  );
}
