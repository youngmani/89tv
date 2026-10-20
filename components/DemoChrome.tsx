"use client";

import { Link } from "@/components/Link";

/** The "DEMO" sash across the top-left corner. Purely decorative; screen readers get a plain label. */
export function DemoRibbon() {
  return (
    <div className="demo-ribbon" role="note" aria-label="Demo mode: nothing is saved to 7TV">
      <span aria-hidden>Demo</span>
    </div>
  );
}

/** Shown in the header, where the live app has the user's name and Sign out. */
export function ExitDemo() {
  return <Link href="/">Exit demo</Link>;
}
