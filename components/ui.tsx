"use client";

import { createContext, useContext } from "react";
import type { Key } from "react-aria-components";
import {
  Button,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  ProgressBar,
  Select,
  SelectValue,
  Text,
} from "react-aria-components";

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
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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

/** Indeterminate spinner (react-aria ProgressBar), announced to screen readers via `label`. */
export function Spinner({
  label,
  size = "md",
  className,
}: {
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <ProgressBar className={`spinner-wrap ${className ?? ""}`} isIndeterminate aria-label={label}>
      <span className={`spinner-ring${size === "sm" ? " sm" : ""}`} aria-hidden />
    </ProgressBar>
  );
}

/** Full-width "please wait" card for states where there's nothing the user can do yet. */
export function LoadingCard({ message }: { message: string }) {
  return (
    <section className="card narrow center loading-card">
      <Spinner label={message} />
      <p className="muted">{message}</p>
    </section>
  );
}

/** Signs the user out to the login screen, keeping their in-progress mapping. Provided by App. */
export const LogInAgainContext = createContext<(() => void) | null>(null);

/**
 * An error message as text, except that "Log in" in "…Log in again…" (an expired session, see friendlyError)
 * becomes a button back to the login screen.
 */
export function ErrorText({ message }: { message: string }) {
  const logInAgain = useContext(LogInAgainContext);
  const i = message.indexOf("Log in again");
  if (i < 0 || !logInAgain) return <>{message}</>;
  return (
    <>
      {message.slice(0, i)}
      <Button className="link-button" onPress={logInAgain}>
        Log in
      </Button>
      {message.slice(i + "Log in".length)}
    </>
  );
}
