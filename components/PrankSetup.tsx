"use client";

import { useState } from "react";
import {
  Button,
  Form,
  Input,
  RadioButton,
  RadioField,
  RadioGroup,
  TextField,
} from "react-aria-components";
import { EmoteImage } from "@/components/EmoteImage";
import { ErrorText } from "@/components/ui";
import type { ExistingEmotes, Prank } from "@/lib/mapping";
import { type SearchResult, friendlyError } from "@/lib/seventv";
import { plural } from "@/lib/util";

type Step = "existing" | "prank";

/**
 * The April Fools questions asked once the sets have loaded: what to do with the emotes already in the seasonal
 * set (only when there are any), then which prank. How many emotes the prank covers depends on the first answer, and
 * shuffling needs at least two, so the questions come in that order. Options that would leave nothing to prank are
 * disabled up front.
 */
export function PrankSetup({
  targetName,
  pendingCount,
  mappedCount,
  extrasCount,
  search,
  onBack,
  onDone,
}: {
  targetName: string;
  /** Base names not in the seasonal set yet. */
  pendingCount: number;
  /** Base names already in the seasonal set. */
  mappedCount: number;
  /** Seasonal set names the base set doesn't have. */
  extrasCount: number;
  search: (query: string) => Promise<SearchResult[]>;
  onBack: () => void;
  onDone: (prank: Prank) => void;
}) {
  const existingCount = mappedCount + extrasCount;
  const countFor: Record<ExistingEmotes, number> = {
    keep: pendingCount,
    reset: pendingCount + mappedCount,
    include: pendingCount + existingCount,
  };
  const options = (["reset", "keep", "include"] as const).filter((o) => countFor[o] > 0);
  const [step, setStep] = useState<Step>(existingCount > 0 ? "existing" : "prank");
  const [existing, setExisting] = useState<ExistingEmotes>(options[0] ?? "reset");
  const [kind, setKind] = useState<Prank["kind"] | null>(null);
  const [emote, setEmote] = useState<SearchResult | null>(null);

  const count = countFor[existing];
  const canShuffle = count >= 2;
  const ready = kind === "shuffle" ? canShuffle : kind === "single" && !!emote;

  if (options.length === 0)
    return (
      <section className="card narrow stack center prank-setup" aria-label="April Fools">
        <h2>Nothing to prank</h2>
        <p className="muted">Both sets are empty.</p>
        <div className="buttons-row">
          <Button className="btn" onPress={onBack}>
            Back
          </Button>
        </div>
      </section>
    );

  if (step === "existing")
    return (
      <section className="card narrow stack prank-setup" aria-label="April Fools">
        <h2>Emotes already in {targetName}</h2>
        <p className="muted center">
          This emote set is not empty. Choose how to handle the existing emotes.
        </p>
        <RadioGroup
          className="choice-list"
          value={existing}
          onChange={(v) => setExisting(v as ExistingEmotes)}
          aria-label="Emotes already in the seasonal set"
        >
          <RadioField value="reset" isDisabled={countFor.reset === 0}>
            <RadioButton className="choice">
              <b>Delete them</b>
              <span className="muted small">
                {countFor.reset === 0
                  ? "The base set is empty."
                  : `Removes the ${plural(existingCount, "existing emote")}, then builds the prank from the base set.`}
              </span>
            </RadioButton>
          </RadioField>
          <RadioField value="keep" isDisabled={countFor.keep === 0}>
            <RadioButton className="choice">
              <b>Leave them alone</b>
              <span className="muted small">
                {pendingCount === 0
                  ? "The base set has no new emotes."
                  : `Keeps the ${plural(existingCount, "existing emote")} and pranks only the ${plural(pendingCount, "new one")}.`}
              </span>
            </RadioButton>
          </RadioField>
          <RadioField value="include">
            <RadioButton className="choice">
              <b>Prank them too</b>
              <span className="muted small">
                {`Pranks all ${plural(countFor.include, "emote")}, including the ${plural(existingCount, "existing one")}.`}
              </span>
            </RadioButton>
          </RadioField>
        </RadioGroup>
        <div className="buttons-row">
          <Button className="btn" onPress={onBack}>
            Back
          </Button>
          <Button className="btn primary" onPress={() => setStep("prank")}>
            Next
          </Button>
        </div>
      </section>
    );

  return (
    <section className="card narrow stack prank-setup" aria-label="April Fools">
      <h2>Choose a prank</h2>
      <RadioGroup
        className="choice-list"
        value={kind}
        onChange={(v) => setKind(v as Prank["kind"])}
        aria-label="Prank"
      >
        <RadioField value="single">
          <RadioButton className="choice">
            <b>One emote everywhere</b>
            <span className="muted small">Every emote shows the emote chosen below.</span>
          </RadioButton>
        </RadioField>
        <RadioField value="shuffle" isDisabled={!canShuffle}>
          <RadioButton className="choice">
            <b>Shuffle</b>
            <span className="muted small">
              {canShuffle
                ? "Every emote shows a different emote from the set."
                : "Shuffling requires at least 2 emotes to prank."}
            </span>
          </RadioButton>
        </RadioField>
      </RadioGroup>
      {kind === "single" && <EmotePicker search={search} value={emote} onChange={setEmote} />}
      <div className="buttons-row">
        <Button
          className="btn"
          onPress={() => (existingCount > 0 ? setStep("existing") : onBack())}
        >
          Back
        </Button>
        <Button
          className="btn primary"
          isDisabled={!ready}
          onPress={() =>
            onDone(
              kind === "single" && emote
                ? { kind, existing, emote }
                : { kind: "shuffle", existing },
            )
          }
        >
          Start picking
        </Button>
      </div>
    </section>
  );
}

function EmotePicker({
  search,
  value,
  onChange,
}: {
  search: (query: string) => Promise<SearchResult[]>;
  value: SearchResult | null;
  onChange: (emote: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (q: string) => {
    if (!q) return;
    setSearched(q);
    setSearching(true);
    setError(null);
    try {
      setResults(await search(q));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSearching(false);
    }
  };

  const shown =
    value && !results?.some((r) => r.id === value.id) ? [value, ...(results ?? [])] : results;
  return (
    <div className="stack emote-picker">
      <Form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(query.trim());
        }}
      >
        <TextField className="field grow" value={query} onChange={setQuery} aria-label="Emote">
          <Input placeholder="Search, or paste an emote link" />
        </TextField>
        <Button type="submit" className="btn" isDisabled={!query.trim() || searching}>
          Search
        </Button>
      </Form>
      {shown && shown.length > 0 && (
        <RadioGroup
          className="emote-options"
          value={value?.id ?? null}
          onChange={(id) => {
            const picked = shown.find((r) => r.id === id);
            if (picked) onChange(picked);
          }}
          aria-label="Emote to show everywhere"
        >
          {shown.map((r, i) => (
            <RadioField key={r.id} value={r.id}>
              <RadioButton className="emote-option">
                <EmoteImage emote={r} size="large" alt="" index={i} />
                <span className="name">{r.defaultName}</span>
              </RadioButton>
            </RadioField>
          ))}
        </RadioGroup>
      )}
      {(searching || error || shown?.length === 0) && (
        <div className="muted small status" aria-live="polite">
          {searching ? (
            "Searching…"
          ) : error ? (
            <>
              <span className="error">
                Couldn&apos;t search: <ErrorText message={error} />
              </span>{" "}
              <Button className="link-button" onPress={() => void run(searched)}>
                Retry
              </Button>
            </>
          ) : (
            "No emotes found."
          )}
        </div>
      )}
    </div>
  );
}
