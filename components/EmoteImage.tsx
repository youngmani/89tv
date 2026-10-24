"use client";

import { type ComponentProps, useEffect, useState } from "react";
import { Image } from "@/components/Image";
import { type EmoteSummary, emoteImage } from "@/lib/seventv";
import { preloadImage } from "@/lib/util";

type Emote = Pick<EmoteSummary, "id" | "flags">;
type Size = "small" | "large";

/** 7TV scales for each size: at 1x pixel density, and at 2x and above. */
const SCALES = { small: [1, 2], large: [3, 4] } as const;

/** AVIF is smaller, but animated AVIF isn't reliably supported (Safari), so animated emotes stay WebP. */
const formatFor = (emote: Emote) => (emote.flags.animated ? "webp" : "avif");

const srcSet = (id: string, size: Size, format: "avif" | "webp") =>
  SCALES[size].map((scale, i) => `${emoteImage(id, scale, format)} ${i + 1}x`).join(", ");

/**
 * The file each emote's small image loaded (whichever format and scale the browser picked), shown while its large one
 * loads. Dropped once the large one has loaded, as it's cached from then on.
 */
const loadedSmall = new Map<string, string>();

export const preloadEmote = (emote: Emote, size: Size) =>
  preloadImage(
    emoteImage(emote.id, SCALES[size][devicePixelRatio >= 1.5 ? 1 : 0], formatFor(emote)),
  );

/**
 * A 7TV emote. A large one first shows the emote's already-loaded small image, scaled up, while the large one loads
 * out of view (an animated image starts playing before it has finished loading, out of step with the small one), and
 * keeps showing it if the large one fails.
 */
export function EmoteImage({
  emote,
  size,
  className,
  style,
  onLoad,
  ...props
}: Omit<ComponentProps<typeof Image>, "src" | "srcSet"> & { emote: Emote; size: Size }) {
  const src = emoteImage(emote.id, SCALES[size][0], "webp");
  const small = size === "large" ? loadedSmall.get(emote.id) : undefined;
  const [ready, setReady] = useState<{ src: string; loaded: boolean }>();
  const waiting = !!small && ready?.src !== src;

  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    void preloadEmote(emote, size).then((loaded) => {
      if (cancelled) return;
      if (loaded) loadedSmall.delete(emote.id);
      setReady({ src, loaded });
    });
    return () => {
      cancelled = true;
    };
  }, [waiting, emote, size, src]);

  if (small && (waiting || !ready?.loaded))
    return (
      <Image
        {...props}
        src={small}
        className={[className, "cached"].filter(Boolean).join(" ")}
        style={style}
        onLoad={onLoad}
      />
    );
  return (
    <picture>
      {formatFor(emote) === "avif" && (
        <source type="image/avif" srcSet={srcSet(emote.id, size, "avif")} />
      )}
      <Image
        {...props}
        src={src}
        srcSet={srcSet(emote.id, size, "webp")}
        className={
          [className, ready?.src === src && ready.loaded && "cached"].filter(Boolean).join(" ") ||
          undefined
        }
        style={style}
        onLoad={(e) => {
          if (size === "small") loadedSmall.set(emote.id, e.currentTarget.currentSrc);
          onLoad?.(e);
        }}
      />
    </picture>
  );
}
