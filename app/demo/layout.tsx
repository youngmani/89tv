import type { Metadata } from "next";

/** app/opengraph-image.png, which only applies automatically to pages that don't set openGraph themselves. */
const OG_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "89TV · Make a seasonal copy of your 7TV emote set",
};

// The demo page is a client component, so its metadata lives here.
const description =
  "Try 89TV without logging in. Make Halloween and Christmas versions of a sample 7TV emote set.";

export const metadata: Metadata = {
  title: "Demo",
  description,
  alternates: { canonical: "/demo" },
  // Setting openGraph/twitter replaces the root layout's, so the shared fields and the image are repeated.
  openGraph: {
    type: "website",
    siteName: "89TV",
    title: "89TV demo",
    description,
    url: "/demo",
    locale: "en_US",
    images: OG_IMAGE,
  },
  twitter: { card: "summary_large_image", title: "89TV demo", description, images: OG_IMAGE },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
