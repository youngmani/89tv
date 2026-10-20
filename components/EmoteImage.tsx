"use client";

import { type ComponentProps, useState } from "react";
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

/** The file each emote's small image loaded (whichever format and scale the browser picked), shown while a large one loads. */
const loadedSmall = new Map<string, string>();

export const preloadEmote = (emote: Emote, size: Size) =>
  preloadImage(
    emoteImage(emote.id, SCALES[size][devicePixelRatio >= 1.5 ? 1 : 0], formatFor(emote)),
  );

/**
 * A 7TV emote. A large one shows the emote's already-loaded small image, scaled up, until it has loaded, and
 * instead of it if it fails to load.
 */
export function EmoteImage({
  emote,
  size,
  className,
  style,
  onLoad,
  onError,
  ...props
}: Omit<ComponentProps<typeof Image>, "src" | "srcSet"> & { emote: Emote; size: Size }) {
  const src = emoteImage(emote.id, SCALES[size][0], "webp");
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [failedSrc, setFailedSrc] = useState<string>();
  const small = size === "large" && loadedSrc !== src ? loadedSmall.get(emote.id) : undefined;
  if (small && failedSrc === src)
    return <Image {...props} src={small} className={className} style={style} onLoad={onLoad} />;
  return (
    <picture>
      {formatFor(emote) === "avif" && (
        <source type="image/avif" srcSet={srcSet(emote.id, size, "avif")} />
      )}
      <Image
        {...props}
        src={src}
        srcSet={srcSet(emote.id, size, "webp")}
        className={[className, small && "emote-preview"].filter(Boolean).join(" ") || undefined}
        style={small ? { ...style, backgroundImage: `url("${small}")` } : style}
        onLoad={(e) => {
          if (size === "small") loadedSmall.set(emote.id, e.currentTarget.currentSrc);
          setLoadedSrc(src);
          onLoad?.(e);
        }}
        onError={(e) => {
          setFailedSrc(src);
          onError?.(e);
        }}
      />
    </picture>
  );
}
