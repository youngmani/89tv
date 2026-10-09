"use client";

import { type ComponentProps, useState } from "react";

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
  return (
    <img
      {...props}
      src={src}
      alt={alt}
      className={[className, loading ? "img-loading" : ""].filter(Boolean).join(" ") || undefined}
      style={loading ? { animationDelay: `${-index * 10}ms`, ...style } : style}
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
