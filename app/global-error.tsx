"use client";

import { ErrorCard } from "@/components/ErrorCard";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import { nunito } from "@/lib/fonts";
import "./preflight.css";
import "./globals.css";

// Replaces the root layout when that fails, so it brings its own document, styles and font.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>
        <Providers>
          <main>
            <SiteHeader />
            <ErrorCard onRetry={reset} />
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
