"use client";

import { Link } from "react-aria-components";

export function Footer() {
  return (
    <footer className="site-footer">
      created by{" "}
      <Link href="https://youngmani.com" target="_blank" rel="noreferrer">
        youngmani
      </Link>
    </footer>
  );
}
