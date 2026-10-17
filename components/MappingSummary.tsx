"use client";

import { useEffect, useEffectEvent } from "react";
import { Button } from "react-aria-components";
import { shouldIgnoreKey } from "@/lib/hotkeys";
import type { Section } from "@/lib/steps";

/** ← and → step back and forward, when there's somewhere to go. */
function useArrowKeys(canPrev: boolean, canNext: boolean, onNavigate: (delta: number) => void) {
  // An effect event always sees the latest props, so the listener is attached once.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (shouldIgnoreKey(e)) return;
    if (e.key === "ArrowLeft" && canPrev) onNavigate(-1);
    else if (e.key === "ArrowRight" && canNext) onNavigate(1);
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

/**
 * The step at the end of a section: a recap, the save button, and a button to the next section's tab. The last
 * section's is the final "That's everything!". The header mirrors MappingFocus so the arrows never move.
 * Controls the user can never use here are not rendered (arrows are hidden but keep their space).
 */
export function MappingSummary({
  section,
  next,
  isLast,
  multiSection,
  canPrev,
  counts,
  swapCount,
  removeCount,
  sectionTitle,
  canApply,
  applyLabel,
  onApply,
  onNextSection,
  onNavigate,
}: {
  section: Section;
  /** The next section with cards to show (taking the filter into account), if any. */
  next: Section | null;
  /** Whether this is the last section at all (the final "That's everything!"), whatever the filter. */
  isLast: boolean;
  /** Whether there's more than one section (otherwise this is simply "All done!"). */
  multiSection: boolean;
  canPrev: boolean;
  counts: { replace: number; original: number; exclude: number };
  /** Already-mapped emotes the user chose to swap. */
  swapCount: number;
  /** Seasonal-set emotes the user chose to remove. */
  removeCount: number;
  /** Tab titles, e.g. "Already added". */
  sectionTitle: Record<Section, string>;
  canApply: boolean;
  applyLabel: string;
  onApply: () => void;
  onNextSection: (section: Section) => void;
  onNavigate: (delta: number) => void;
}) {
  const everything = isLast && multiSection;
  useArrowKeys(canPrev, !!next, onNavigate);

  const nothing = counts.replace + counts.original + counts.exclude + swapCount + removeCount === 0;
  const recap = everything
    ? "You've seen every emote in both sets."
    : section === "pending"
      ? "You've been through all the new emotes."
      : section === "mapped"
        ? "You've checked all the emotes already added."
        : "You've checked all the emotes not in your base set.";

  return (
    <section
      className="card focus summary-step"
      aria-label={everything ? "That's everything" : "All done"}
    >
      <div className="focus-head">
        <Button
          className={`btn nav${canPrev ? "" : " invisible"}`}
          onPress={() => onNavigate(-1)}
          isDisabled={!canPrev}
          aria-label="Previous"
        >
          ←
        </Button>
        <div className="focus-title">
          <div className="summary-emoji" aria-hidden>
            🎉
          </div>
          <h2 className="alias">{everything ? "That's everything!" : "All done!"}</h2>
          <div className="muted small">{recap}</div>
        </div>
        <Button
          className={`btn nav${next ? "" : " invisible"}`}
          onPress={() => onNavigate(1)}
          isDisabled={!next}
          aria-label="Next"
        >
          →
        </Button>
      </div>

      {nothing ? (
        <p className="summary-counts muted">Nothing to change. Everything already matches.</p>
      ) : (
        <p className="summary-counts">
          <b>{counts.replace}</b> seasonal · <b>{counts.original}</b> as-is ·{" "}
          <b>{counts.exclude}</b> skipped
          {swapCount > 0 && (
            <>
              {" "}
              · <b>{swapCount}</b> {swapCount === 1 ? "swap" : "swaps"}
            </>
          )}
          {removeCount > 0 && (
            <>
              {" "}
              · <b>{removeCount}</b> {removeCount === 1 ? "removal" : "removals"}
            </>
          )}
        </p>
      )}

      <div className="buttons-row">
        <Button className="btn primary" isDisabled={!canApply} onPress={onApply}>
          {applyLabel}
        </Button>
        {next && (
          <Button className="btn" onPress={() => onNextSection(next)}>
            Next: {sectionTitle[next]} →
          </Button>
        )}
      </div>
    </section>
  );
}
