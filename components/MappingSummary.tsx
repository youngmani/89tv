"use client";

import { useEffect } from "react";
import { Button } from "react-aria-components";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * An "All done!" step. "summary" sits between the emotes to add and the ones already in the target; "end"
 * comes after the last already-mapped emote and only offers the commit button. The header mirrors
 * MappingFocus (same arrow buttons, same positions) so stepping onto it doesn't shift anything.
 */
export function MappingSummary({
  variant,
  canPrev,
  counts,
  swapCount,
  mappedCount,
  targetName,
  canApply,
  applyLabel,
  onApply,
  onReviewUndecided,
  onNavigate,
}: {
  variant: "summary" | "end";
  canPrev: boolean;
  counts: { replace: number; original: number; exclude: number; undecided: number };
  /** Already-mapped emotes the user chose to swap. */
  swapCount: number;
  /** Emotes already in the target; when > 0, "next" continues into them. */
  mappedCount: number;
  targetName: string;
  canApply: boolean;
  applyLabel: string;
  onApply: () => void;
  onReviewUndecided: () => void;
  onNavigate: (delta: number) => void;
}) {
  const end = variant === "end";
  const hasMapped = !end && mappedCount > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest?.("input, textarea, [role=listbox], [role=dialog]")) return;
      if (e.key === "ArrowLeft" && canPrev) onNavigate(-1);
      else if (e.key === "ArrowRight" && hasMapped) onNavigate(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasMapped, canPrev, onNavigate]);

  return (
    <section className="card focus summary-step" aria-label="All done">
      <div className="focus-head">
        <Button className="btn nav" onPress={() => onNavigate(-1)} isDisabled={!canPrev} aria-label="Previous">
          ←
        </Button>
        <div className="focus-title">
          <div className="summary-emoji" aria-hidden>
            🎉
          </div>
          <h2 className="alias">All done!</h2>
          <div className="muted small">
            {end
              ? "You've been through every emote."
              : hasMapped
                ? `Keep going → to review the ${plural(mappedCount, "emote")} already in ${targetName}`
                : "\u00a0" /* keeps the line height so nothing shifts */}
          </div>
        </div>
        {/* Always rendered so the arrows never shift; disabled when there's nothing after this step. */}
        <Button
          className="btn nav"
          onPress={() => onNavigate(1)}
          isDisabled={!hasMapped}
          aria-label={hasMapped ? "Review emotes already in the target" : "Next"}
        >
          →
        </Button>
      </div>

      {counts.replace + counts.original + counts.exclude + counts.undecided + swapCount === 0 ? (
        <p className="summary-counts muted">Nothing to change.</p>
      ) : (
      <p className="summary-counts">
        <b>{counts.replace}</b> seasonal · <b>{counts.original}</b> kept as original · <b>{counts.exclude}</b> not
        copied
        {swapCount > 0 && (
          <>
            {" "}
            · <b>{swapCount}</b> to swap
          </>
        )}
      </p>
      )}
      {!end && counts.undecided > 0 && (
        <p className="muted small">
          {plural(counts.undecided, "emote")} haven&apos;t been reviewed; they&apos;ll be copied as the original.{" "}
          <Button className="link-button" onPress={onReviewUndecided}>
            Review them
          </Button>
        </p>
      )}

      <div className="buttons-row">
        <Button className="btn primary" isDisabled={!canApply} onPress={onApply}>
          {applyLabel}
        </Button>
        {hasMapped && (
          <Button className="btn" onPress={() => onNavigate(1)}>
            Review emotes already in the target
          </Button>
        )}
      </div>
    </section>
  );
}
