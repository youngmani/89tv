"use client";

import { useRouter } from "next/navigation";
import { Link } from "react-aria-components";

/** The "DEMO" sash across the top-left corner. Purely decorative; screen readers get a plain label. */
export function DemoRibbon() {
  return (
    <div className="demo-ribbon" role="note" aria-label="Demo mode: nothing is saved to 7TV">
      <span aria-hidden>Demo</span>
    </div>
  );
}

/** Shown at the bottom of the demo, just above the footer. */
export function ExitDemo() {
  const router = useRouter();
  /** Like "Try the demo": the app is only prefetched once the user shows interest (hover or keyboard focus). */
  const prefetchApp = () => router.prefetch("/");
  return (
    <p className="exit-demo">
      <Link href="/" onHoverStart={prefetchApp} onFocus={prefetchApp}>
        Exit demo
      </Link>
    </p>
  );
}
