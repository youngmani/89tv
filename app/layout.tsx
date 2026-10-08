import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "89TV",
  description: "Build Halloween and Christmas versions of a 7TV emote set.",
};

// Pick the palette before first paint (no flash): the in-progress mapping's theme if there is one (never on
// /demo, which doesn't use saved data), otherwise
// the season — keep in sync with themeForDate() in lib/mapping.ts.
const themeScript = `try{var m=location.pathname.indexOf("/demo")===0?null:JSON.parse(localStorage.getItem("89tv:mapping")||"null"),t=m&&m.theme;if(!t){var d=new Date(),mo=d.getMonth();t=mo===8||mo===9?"halloween":mo>=10||(mo===0&&d.getDate()<=7)?"christmas":"custom"}document.documentElement.dataset.theme=t==="christmas"?"winter":t==="custom"?"neutral":"halloween"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="halloween" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
