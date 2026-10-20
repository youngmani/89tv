"use client";

import { useRouter } from "next/navigation";
import { Link as AriaLink, type LinkProps } from "react-aria-components";

/** react-aria's Link. Links within the site prefetch their page on hover, focus or the start of a press (touch). */
export function Link({ href, onHoverStart, onFocus, onPressStart, ...props }: LinkProps) {
  const router = useRouter();
  const prefetch = () => {
    if (href?.startsWith("/")) router.prefetch(href);
  };
  return (
    <AriaLink
      {...props}
      href={href}
      onHoverStart={(e) => {
        prefetch();
        onHoverStart?.(e);
      }}
      onFocus={(e) => {
        prefetch();
        onFocus?.(e);
      }}
      onPressStart={(e) => {
        prefetch();
        onPressStart?.(e);
      }}
    />
  );
}
