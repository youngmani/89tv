"use client";

import type { Key } from "react-aria-components";
import { Button, FieldError, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, Text } from "react-aria-components";

export interface SelectItem {
  id: string;
  label: string;
  isDisabled?: boolean;
}

/** Labelled react-aria Select with a popover list box. */
export function SelectField({
  label,
  items,
  value,
  onChange,
  placeholder,
  description,
  className,
  "aria-label": ariaLabel,
}: {
  label?: string;
  items: SelectItem[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  description?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select
      className={`field ${className ?? ""}`}
      value={value as Key | null}
      onChange={(k) => k != null && onChange(String(k))}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabledKeys={items.filter((i) => i.isDisabled).map((i) => i.id)}
    >
      {label && <Label>{label}</Label>}
      <Button className="select-button">
        <SelectValue className="select-value" />
        <svg className="chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
      {description && (
        <Text slot="description" className="muted small">
          {description}
        </Text>
      )}
      <FieldError />
      <Popover className="popover" offset={4}>
        <ListBox className="listbox" items={items}>
          {(item) => (
            <ListBoxItem className="option" id={item.id} textValue={item.label}>
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
