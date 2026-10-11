"use client";

import { type ComponentProps, useState } from "react";

/** Must match the `img-loading` animation's duration in globals.css. */
const CYCLE_MS = 1500;
const STAGGER_MS = 10;

/**
 * An `<img>` that shows a pulsing placeholder until it loads. `index` staggers the pulse
 * so a grid of images ripples instead of blinking in unison.
 */
export function Image({
  src,
  alt,
  index = 0,
  className,
  style,
  onLoad,
  onError,
  ...props
}: Omit<ComponentProps<"img">, "src" | "alt"> & { src: string; alt: string; index?: number }) {
  // Tracked per src, so swapping the image in place shows the placeholder again.
  const [doneSrc, setDoneSrc] = useState<string>();
  const loading = doneSrc !== src;
  // Later images lag further behind, so the wave runs in reading order. Kept within one cycle below zero, since a
  // positive delay would leave the image unanimated until it kicks in.
  const delay = ((index * STAGGER_MS) % CYCLE_MS) - CYCLE_MS;
  return (
    <img
      {...props}
      src={src}
      alt={alt}
      className={[className, loading ? "img-loading" : ""].filter(Boolean).join(" ") || undefined}
      style={loading ? { animationDelay: `${delay}ms`, ...style } : style}
      onLoad={(e) => {
        setDoneSrc(src);
        onLoad?.(e);
      }}
      onError={(e) => {
        setDoneSrc(src);
        onError?.(e);
      }}
    />
  );
}
