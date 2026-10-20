/** The site's title and tagline. `children` go in the corner beside it (the account, or the demo's exit link). */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="top">
      <h1>
        {/* All three are rendered and CSS picks one from <html data-theme>, which an inline script sets before
            first paint, so the logo is right even before hydration. */}
        <span className="logo" aria-hidden>
          <span className="logo-halloween">🎃</span>
          <span className="logo-winter">❄️</span>
          <span className="logo-neutral">✨</span>
        </span>{" "}
        {/* Styled like the favicon: the 9 in the accent colour, tucked into the 8. Reads as "89TV". */}
        <span className="wordmark">
          <span className="eight">8</span>
          <span className="nine">9</span>
          TV
        </span>
      </h1>
      <p className="tagline">Make a seasonal copy of your 7TV emote set</p>
      {children}
    </header>
  );
}
