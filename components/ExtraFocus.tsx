"use client";

import { useEffect } from "react";
import { Button, Link, ToggleButton } from "react-aria-components";
import type { ApplyState, Choice } from "@/lib/mapping";
import { type SetEmote, emoteImage, emotePage, ownerName } from "@/lib/seventv";

/**
 * A target emote whose name isn't in the source (e.g. the source set changed since last season). The only
 * question is keep (default) or remove. Same header layout as MappingFocus so the arrows never move.
 * Keys: 0/K keep · X remove · →/Enter next · ← back.
 */
export function ExtraFocus({
  entry,
  position,
  canPrev,
  canNext,
  sourceName,
  targetName,
  choice,
  apply,
  onChoose,
  onNavigate,
}: {
  entry: SetEmote;
  position: string;
  canPrev: boolean;
  canNext: boolean;
  sourceName: string;
  targetName: string;
  choice: Choice;
  apply: ApplyState | undefined;
  onChoose: (choice: Choice, advance: boolean) => void;
  onNavigate: (delta: number) => void;
}) {
  const removing = choice.kind === "remove";
  const aliased = entry.alias !== entry.emote.defaultName;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || !t?.closest) return;
      if (t.closest("input, textarea, [role=listbox], [role=dialog]")) return;
      if ((e.key === "Enter" || e.key === " ") && t.closest("button, a, [role=button]")) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowLeft" && canPrev) onNavigate(-1);
      else if ((e.key === "ArrowRight" || e.key === "Enter") && canNext) onChoose(choice, true);
      else if (k === "0" || k === "k") onChoose({ kind: "keep" }, true);
      else if (k === "x") onChoose({ kind: "remove" }, true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choice, canPrev, canNext, onChoose, onNavigate]);

  return (
    <section className="card focus" aria-label={`${entry.alias}, only in ${targetName}`}>
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
          <img src={emoteImage(entry.emote.id, 3)} alt="" />
          <div className={`alias${removing ? " struck" : ""}`}>{entry.alias}</div>
          <div className="muted small">
            in {targetName} but not in {sourceName} · {position}
          </div>
        </div>
        <Button
          className={`btn nav${canNext ? "" : " invisible"}`}
          onPress={() => onChoose(choice, true)}
          isDisabled={!canNext}
          aria-label="Next"
        >
          →
        </Button>
      </div>

      <p className="muted small center">
        {entry.emote.defaultName}
        {aliased ? ` (added as ${entry.alias})` : ""} by {ownerName(entry.emote)}
        {entry.emote.deleted ? " · deleted from 7TV" : ""} ·{" "}
        <Link href={emotePage(entry.emote.id)} target="_blank" rel="noreferrer">
          view on 7tv.app
        </Link>
      </p>

      {apply?.state === "error" && (
        <div className="alert" role="alert">
          <b>Couldn&apos;t remove this one:</b> {apply.message}
        </div>
      )}
      {apply?.state === "removed" && <div className="ok small">✓ Removed from {targetName}</div>}

      <div className="buttons-row">
        <ToggleButton className="btn choice" isSelected={!removing} onChange={() => onChoose({ kind: "keep" }, true)}>
          Keep it <kbd aria-hidden>0</kbd>
        </ToggleButton>
        <ToggleButton
          className="btn choice danger"
          isSelected={removing}
          onChange={() => onChoose({ kind: "remove" }, true)}
        >
          Remove from {targetName} <kbd aria-hidden>X</kbd>
        </ToggleButton>
      </div>

      <div className="muted small keys" aria-hidden>
        <kbd>0</kbd> keep · <kbd>X</kbd> remove · <kbd>→</kbd>/<kbd>Enter</kbd> next · <kbd>←</kbd> back
      </div>
    </section>
  );
}
