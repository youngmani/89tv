import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";
import { SITE_URL } from "@/lib/site";
import "./preflight.css";
import "./globals.css";

// Self-hosted at build time (no requests to Google from visitors). The variable font covers every weight used.
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });

// Tells the browser the page is dark before any CSS loads (its default background, form controls, scrollbars).
export const viewport: Viewport = { colorScheme: "dark" };

const description = "Make Halloween and Christmas versions of your 7TV emote set.";

// Social previews (Open Graph, X/Twitter) use app/opengraph-image.png; Next adds its tags and absolute URL.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "89TV", template: "%s · 89TV" },
  description,
  applicationName: "89TV",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "89TV",
    title: "89TV",
    description,
    url: "/",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: "89TV", description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="halloween" className={nunito.variable} suppressHydrationWarning>
      <head>
        {/* Pick the palette before first paint (no flash): the in-progress mapping's theme if there is one
            (not on /demo, which doesn't use saved data and would otherwise flash), otherwise the season. Keep
            in sync with themeForDate() in lib/mapping.ts. React 19 doesn't escape script children. */}
        <script>{`try{var saved=location.pathname.indexOf("/demo")===0?null:JSON.parse(localStorage.getItem("89tv:mapping")||"null"),theme=saved&&saved.theme;if(!theme){var d=new Date(),m=d.getMonth();theme=m===8||m===9?"halloween":m>=10||(m===0&&d.getDate()<=7)?"christmas":"custom"}document.documentElement.dataset.theme=theme==="christmas"?"winter":theme==="custom"?"neutral":"halloween"}catch(e){}`}</script>
        {/* Open connections early so the first API call and emote images skip DNS/TLS setup (~0.5s). The
            API is called with fetch (CORS), hence crossOrigin; images are plain requests. */}
        <link rel="preconnect" href="https://api.7tv.app" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn.7tv.app" />
      </head>
      <body>
        <Providers>
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
