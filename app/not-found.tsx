import type { Metadata } from "next";
import { Link } from "@/components/Link";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main>
      <SiteHeader />
      <section className="card narrow center stack">
        <h2>Page not found</h2>
        <p className="muted">This page does not exist.</p>
        <div className="buttons-row">
          <Link className="btn primary" href="/">
            Go to 89TV
          </Link>
        </div>
      </section>
    </main>
  );
}
