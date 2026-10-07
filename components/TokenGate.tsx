"use client";

import { useState } from "react";
import { Button, Form, Label, Link, TextArea, TextField } from "react-aria-components";

// Copies the token and also prints it, in case copy() is unavailable or the clipboard write is blocked.
const SNIPPET = `(t => (copy(t), t))(localStorage.getItem("7tv-token"))`;

/**
 * Tokens are JWTs (base64url segments joined by dots), so whitespace and quotes are never part of one.
 * Strip them anywhere, which handles console output like "eyJ…" or a value wrapped across lines.
 */
export function cleanToken(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]?\s*bearer\s+/i, "")
    .replace(/[\s"'`]/g, "");
}

type Env = { mobile: boolean; mac: boolean; browser: "chromium" | "firefox" | "safari" };

/** Rough platform sniffing, only used to show the right keyboard shortcut. */
function detectEnv(): Env {
  if (typeof navigator === "undefined") return { mobile: false, mac: false, browser: "chromium" };
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const mobile = iPadOS || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const mac = /Mac OS X|Macintosh/.test(ua);
  const browser = /Firefox\//.test(ua)
    ? "firefox"
    : /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR/.test(ua)
      ? "safari"
      : "chromium";
  return { mobile, mac, browser };
}

const Keys = ({ keys }: { keys: string[] }) => (
  <span className="keys-inline">
    {keys.map((k) => (
      <kbd key={k}>{k}</kbd>
    ))}
  </span>
);

/** How to get to the console for this browser + OS. */
function OpenConsoleStep({ env }: { env: Env }) {
  if (env.browser === "safari")
    return (
      <>
        Turn on <b>Safari → Settings → Advanced → Show features for web developers</b>, then press{" "}
        <Keys keys={["⌥", "⌘", "C"]} /> to open the Console.
      </>
    );
  const keys =
    env.browser === "firefox"
      ? env.mac
        ? ["⌥", "⌘", "K"]
        : ["Ctrl", "Shift", "K"]
      : env.mac
        ? ["⌥", "⌘", "J"]
        : ["Ctrl", "Shift", "J"];
  return (
    <>
      Press <Keys keys={keys} /> to open the DevTools Console.
    </>
  );
}

// 7TV's OAuth callback is pinned to https://7tv.app/login/callback, so a third-party site can't finish
// the login flow itself. Instead the user copies their existing 7tv.app session token.
export function TokenGate({ onToken, error }: { onToken: (t: string) => void; error?: string | null }) {
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  // This component only renders client-side (the page waits for hydration), so sniffing here is safe.
  const [env] = useState(detectEnv);

  return (
    <section className="card narrow">
      <h2>Connect your 7TV account</h2>
      <p className="muted">
        7TV only lets its own website finish a login, so this tool uses your existing 7tv.app session token. It stays
        in your browser and is only ever sent to <code>api.7tv.app</code>.
      </p>

      {env.mobile && (
        <p className="notice">
          Mobile browsers don&apos;t have a developer console, so you can&apos;t get your token on this device. Open 89TV
          on a computer instead. If you already have your token, you can paste it below.
        </p>
      )}

      <ol className="steps" hidden={env.mobile}>
        <li>
          Open{" "}
          <Link href="https://7tv.app" target="_blank" rel="noreferrer">
            7tv.app
          </Link>{" "}
          and make sure you&apos;re logged in.
        </li>
        <li>
          <OpenConsoleStep env={env} />
        </li>
        <li>
          Run this. It copies the token to your clipboard and also prints it:
          <div className="snippet">
            <code>{SNIPPET}</code>
            <Button
              className="btn small"
              onPress={async () => {
                try {
                  await navigator.clipboard.writeText(SNIPPET);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard unavailable; the user can select the text */
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {env.browser !== "safari" && (
            <span className="muted small">
              If the console warns about pasting, type <code>allow pasting</code> and press Enter first.
            </span>
          )}
        </li>
        <li>Paste the token below.</li>
      </ol>

      <Form
        onSubmit={(e) => {
          e.preventDefault();
          const t = cleanToken(value);
          if (t) onToken(t);
        }}
      >
        <TextField className="field" value={value} onChange={setValue}>
          <Label>7TV token</Label>
          <TextArea rows={3} placeholder="eyJhbGciOi…" spellCheck={false} autoComplete="off" />
        </TextField>
        <Button type="submit" className="btn primary" isDisabled={!value.trim()}>
          Connect
        </Button>
      </Form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
