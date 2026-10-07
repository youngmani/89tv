"use client";

import { useEffect } from "react";
import { Button } from "react-aria-components";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * An "All done!" step. "summary" sits right after the emotes to add; "end" comes after every other section.
 * The header mirrors MappingFocus so the arrows never move. Controls the user can never use here are not
 * rendered (arrows are hidden but keep their space, so nothing shifts).
 */
export function MappingSummary({
  variant,
  canPrev,
  counts,
  swapCount,
  removeCount,
  mappedCount,
  extraCount,
  sourceName,
  targetName,
  canApply,
  applyLabel,
  onApply,
  onReviewUndecided,
  onJump,
  onNavigate,
}: {
  variant: "summary" | "end";
  canPrev: boolean;
  counts: { replace: number; original: number; exclude: number; undecided: number };
  /** Already-mapped emotes the user chose to swap. */
  swapCount: number;
  /** Target-only emotes the user chose to remove. */
  removeCount: number;
  /** Emotes already in the target (section 2). */
  mappedCount: number;
  /** Emotes only in the target (section 3). */
  extraCount: number;
  sourceName: string;
  targetName: string;
  canApply: boolean;
  applyLabel: string;
  onApply: () => void;
  onReviewUndecided: () => void;
  onJump: (section: "mapped" | "extra") => void;
  onNavigate: (delta: number) => void;
}) {
  const end = variant === "end";
  const hasMapped = !end && mappedCount > 0;
  const hasExtras = !end && extraCount > 0;
  const canNext = hasMapped || hasExtras;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest?.("input, textarea, [role=listbox], [role=dialog]")) return;
      if (e.key === "ArrowLeft" && canPrev) onNavigate(-1);
      else if (e.key === "ArrowRight" && canNext) onNavigate(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNext, canPrev, onNavigate]);

  const nothing = counts.replace + counts.original + counts.exclude + counts.undecided + swapCount + removeCount === 0;

  return (
    <section className="card focus summary-step" aria-label="All done">
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
          <h2 className="alias">{end ? "That's everything!" : "All done!"}</h2>
          <div className="muted small">
            {end
              ? `You've seen every emote in ${sourceName} and ${targetName}.`
              : hasMapped
                ? `Up next: the ${plural(mappedCount, "emote")} ${targetName} already has`
                : hasExtras
                  ? `Up next: ${plural(extraCount, "emote")} in ${targetName} that ${sourceName} doesn't have`
                  : "\u00a0" /* keeps the line height so nothing shifts */}
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

      {nothing ? (
        <p className="summary-counts muted">Nothing to change. Everything already matches.</p>
      ) : (
        <p className="summary-counts">
          <b>{counts.replace}</b> seasonal · <b>{counts.original}</b> as-is · <b>{counts.exclude}</b> skipped
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
      {!end && counts.undecided > 0 && (
        <p className="muted small">
          {plural(counts.undecided, "emote")} {counts.undecided === 1 ? "is" : "are"} unreviewed and will be copied
          as-is.{" "}
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
          <Button className="btn" onPress={() => onJump("mapped")}>
            Check the {mappedCount} already in {targetName}
          </Button>
        )}
        {hasExtras && (
          <Button className="btn" onPress={() => onJump("extra")}>
            {hasMapped ? `Skip to the ${extraCount} only in ${targetName}` : `Check the ${extraCount} only in ${targetName}`}
          </Button>
        )}
      </div>
    </section>
  );
}
