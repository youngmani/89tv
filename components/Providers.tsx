"use client";

import { useRouter } from "next/navigation";
import { RouterProvider } from "react-aria-components";

type RouterOptions = NonNullable<Parameters<ReturnType<typeof useRouter>["push"]>[1]> & {
  /** Load the page from scratch instead of routing client-side, e.g. to recover from an error. */
  reloadDocument?: boolean;
};

declare module "react-aria-components" {
  interface RouterConfig {
    routerOptions: RouterOptions;
  }
}

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Routes react-aria Links through the Next router (client-side navigation, basePath-aware). */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <RouterProvider
      navigate={(href, { reloadDocument, ...options } = {}) =>
        reloadDocument ? location.assign(basePath + href) : router.push(href, options)
      }
      useHref={(href) => (href.startsWith("/") ? basePath + href : href)}
    >
      {children}
    </RouterProvider>
  );
}
