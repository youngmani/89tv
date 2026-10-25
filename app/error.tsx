"use client";

import { ErrorCard } from "@/components/ErrorCard";
import { SiteHeader } from "@/components/SiteHeader";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <SiteHeader />
      <ErrorCard onRetry={reset} />
    </main>
  );
}
