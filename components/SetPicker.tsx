"use client";

import { useState } from "react";
import { FieldError, Input, Label, TextField } from "react-aria-components";
import { SelectField } from "@/components/ui";
import { type EmoteSetInfo, parseSetId } from "@/lib/seventv";

const CUSTOM = "__custom__";

export function setLabel(s: EmoteSetInfo) {
  const owner = s.owner?.mainConnection?.platformDisplayName;
  const cap = s.capacity ? `/${s.capacity}` : "";
  return `${s.name}${owner ? ` — ${owner}` : ""} (${s.emotes.totalCount}${cap})`;
}

/**
 * Picks one of the user's editable sets, or (when allowCustom) any set by ID / 7tv URL.
 * `value` is the chosen set ID.
 */
export function SetPicker({
  label,
  description,
  sets,
  value,
  onChange,
  allowCustom,
  disabledId,
  linkError,
}: {
  label: string;
  description?: string;
  sets: EmoteSetInfo[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowCustom?: boolean;
  disabledId?: string | null;
  /** A problem found when the pasted link was checked with 7TV (only happens on submit). */
  linkError?: string | null;
}) {
  const [customChosen, setCustomChosen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  // `sets` may still be loading when a saved value is restored, so only treat an unknown ID as custom once
  // the list is in.
  const inList = !!value && sets.some((s) => s.id === value);
  const custom = !!allowCustom && (customChosen || (!!value && sets.length > 0 && !inList));

  // The link field's own checks are local (no request): "required" and "looks like a set link". They only
  // show once the field has been visited and left, so nothing is flagged while someone is still typing.
  const [touched, setTouched] = useState(false);
  const raw = text ?? value ?? "";
  const localError = !raw.trim()
    ? "Paste a link to an emote set."
    : parseSetId(raw)
      ? null
      : "That isn't an emote set link. It should look like https://7tv.app/emote-sets/01H…";
  const error = (touched ? localError : null) ?? linkError ?? null;

  const items = sets.map((s) => ({
    id: s.id,
    label: setLabel(s),
    isDisabled: s.id === disabledId,
  }));
  if (allowCustom)
    items.push({ id: CUSTOM, label: "Any other set (paste a link)…", isDisabled: false });

  return (
    <div className="field-group">
      <SelectField
        label={label}
        description={description}
        items={items}
        placeholder="Choose a set…"
        value={custom ? CUSTOM : inList ? value : null}
        onChange={(id) => {
          if (id === CUSTOM) {
            setCustomChosen(true);
            onChange(parseSetId(text ?? ""));
          } else {
            setCustomChosen(false);
            onChange(id);
          }
        }}
      />
      {custom && (
        <TextField
          className="field"
          value={raw}
          onChange={(v) => {
            setText(v);
            onChange(parseSetId(v));
          }}
          onBlur={() => setTouched(true)}
          isInvalid={!!error}
          validationBehavior="aria"
          // Focus it when the user picks "Any other set", not when a saved choice is restored.
          autoFocus={customChosen}
        >
          <Label className="visually-hidden">Emote set link or ID</Label>
          <Input placeholder="https://7tv.app/emote-sets/01H…" />
          <FieldError className="field-error">{error}</FieldError>
        </TextField>
      )}
    </div>
  );
}
