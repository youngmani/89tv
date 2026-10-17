"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Form, Input, Label, Link, TextField } from "react-aria-components";

// Copies the token without printing it: copy() returns undefined, so the console only shows "undefined".
// Pasting the whole line at once also avoids DevTools' eager-evaluation preview, which would show the
// token if `localStorage.getItem(...)` were typed on its own.
const SNIPPET = `copy(localStorage.getItem("7tv-token"))`;

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

/**
 * 7TV session tokens are HS256 JWTs (apps/api/src/jwt.rs): three base64url segments, and the first two are
 * JSON objects, so they start with "eyJ". Anything else on the clipboard (a chat message, a link…) is
 * rejected here and never sent anywhere.
 */
export const looksLikeToken = (t: string) =>
  t.length <= 4096 && /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t);

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
// The token is never displayed: it's read straight from the clipboard (or typed into a masked field), and
// no message ever echoes what was pasted. That way streamers can log in on stream.
export function TokenGate({
  onToken,
  error,
}: {
  onToken: (t: string) => void;
  error?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Shown only when the browser won't let us read the clipboard. */
  const [manual, setManual] = useState(false);
  const [value, setValue] = useState("");
  // This component only renders client-side (the page waits for hydration), so sniffing here is safe.
  const [env] = useState(detectEnv);
  const router = useRouter();
  /** /demo is only prefetched when the user shows interest (hover or keyboard focus), not up front. */
  const prefetchDemo = () => router.prefetch("/demo");

  const submit = (raw: string) => {
    const t = cleanToken(raw);
    if (!looksLikeToken(t)) {
      // Deliberately vague: never repeat clipboard contents back.
      setProblem("Invalid 7TV token. Run the command on 7tv.app again, then try again.");
      return;
    }
    setProblem(null);
    setValue("");
    onToken(t);
  };

  const pasteAndLogIn = async () => {
    try {
      submit(await navigator.clipboard.readText());
    } catch {
      setManual(true);
      setProblem("Unable to access the clipboard. Paste the token below.");
    }
  };

  return (
    <>
      {env.mobile && (
        <div className="card narrow notice-card" role="note">
          <span>
            Mobile browsers don&apos;t have a developer console, so you can&apos;t get your token on
            this device. Open 89TV on a computer instead. If your token is already on your
            clipboard, press the button below.
          </span>
        </div>
      )}
      <section className="card narrow stack">
        <h2>Connect your 7TV account</h2>
        <p className="muted">
          7TV doesn't support third-party login, so this tool uses your existing 7tv.app session
          token. It stays in your browser and is only ever sent to <code>api.7tv.app</code>.
        </p>

        <ol className="steps">
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
            Paste this into the Console and press Enter. It copies your token without showing it:
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
                If the console warns about pasting, type <code>allow pasting</code> and press Enter
                first.
              </span>
            )}
          </li>
          <li>Come back here and press the button.</li>
        </ol>

        <div className="buttons-row">
          <Button className="btn primary" onPress={pasteAndLogIn}>
            Paste and log in
          </Button>
        </div>

        {manual && (
          <Form
            className="manual-token"
            onSubmit={(e) => {
              e.preventDefault();
              submit(value);
            }}
          >
            <TextField className="field" value={value} onChange={setValue} type="password">
              <Label>7TV token (hidden)</Label>
              <Input autoComplete="off" spellCheck={false} />
            </TextField>
            <Button type="submit" className="btn" isDisabled={!value.trim()}>
              Log in
            </Button>
          </Form>
        )}

        {(problem || error) && (
          <p className="error center" role="alert">
            {problem ?? error}
          </p>
        )}
      </section>
      <p className="demo-link">
        Just looking?{" "}
        <Link href="/demo" onHoverStart={prefetchDemo} onFocus={prefetchDemo}>
          Try the demo
        </Link>
      </p>
    </>
  );
}
