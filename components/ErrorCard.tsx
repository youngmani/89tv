"use client";

import { useLayoutEffect, useState } from "react";
import { Button } from "react-aria-components";
import { Link } from "@/components/Link";
import { THEMES, type Theme, loadMapping, themeForDate } from "@/lib/mapping";

function savedTheme(): Theme | null {
  if (location.pathname.startsWith("/demo")) return null;
  try {
    return loadMapping()?.theme ?? null;
  } catch {
    // Reading the saved mapping may be what failed; the date's theme still works.
    return null;
  }
}

// Features the app relies on that roughly mark the browser targets in package.json (range media queries arrived in
// Safari 16.4). Keep in step with the targets.
function isSupportedBrowser() {
  try {
    return (
      "findLast" in Array.prototype &&
      typeof structuredClone === "function" &&
      typeof AbortSignal.prototype.throwIfAborted === "function" &&
      CSS.supports("height: 1dvh") &&
      matchMedia("(width >= 0px)").matches
    );
  } catch {
    return false;
  }
}

export function ErrorCard({ onRetry }: { onRetry: () => void }) {
  // When the error happens while hydrating, React re-renders <html> and drops the palette the inline <head> script
  // set, and the app isn't there to set it again. global-error has no such script at all. Set before the first paint.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = THEMES[savedTheme() ?? themeForDate()].palette;
  }, []);
  const [unsupported] = useState(() => !isSupportedBrowser());

  return (
    <section className="card narrow center stack">
      <h2>Unexpected error</h2>
      <p className="muted">This page could not be displayed.</p>
      {unsupported && (
        <p className="notice small">
          This browser may not be supported. Update it, or use a recent version of Chrome, Edge,
          Firefox or Safari.
        </p>
      )}
      <div className="buttons-row">
        <Button className="btn primary" onPress={onRetry}>
          Try again
        </Button>
        <Link className="btn" href="/" routerOptions={{ reloadDocument: true }}>
          Go to 89TV
        </Link>
      </div>
    </section>
  );
}
