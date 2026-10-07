"use client";

import { useState } from "react";
import { Input, Label, TextField } from "react-aria-components";
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
  sets,
  value,
  onChange,
  allowCustom,
  disabledId,
}: {
  label: string;
  sets: EmoteSetInfo[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowCustom?: boolean;
  disabledId?: string | null;
}) {
  const [customChosen, setCustomChosen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  // `sets` may still be loading when a saved value is restored, so only treat an unknown ID as custom once
  // the list is in.
  const inList = !!value && sets.some((s) => s.id === value);
  const custom = !!allowCustom && (customChosen || (!!value && sets.length > 0 && !inList));

  const items = sets.map((s) => ({ id: s.id, label: setLabel(s), isDisabled: s.id === disabledId }));
  if (allowCustom) items.push({ id: CUSTOM, label: "Another set (paste a link or ID)…", isDisabled: false });

  return (
    <div className="field-group">
      <SelectField
        label={label}
        items={items}
        placeholder="Select a set…"
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
          value={text ?? value ?? ""}
          onChange={(v) => {
            setText(v);
            onChange(parseSetId(v));
          }}
        >
          <Label className="visually-hidden">Set link or ID</Label>
          <Input placeholder="https://7tv.app/emote-sets/01H…" />
        </TextField>
      )}
    </div>
  );
}
