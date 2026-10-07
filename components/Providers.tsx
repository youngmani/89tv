"use client";

import { useRouter } from "next/navigation";
import { RouterProvider } from "react-aria-components";

declare module "react-aria-components" {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>["push"]>[1]>;
  }
}

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Routes react-aria Links through the Next router (client-side navigation, basePath-aware). */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <RouterProvider navigate={router.push} useHref={(href) => (href.startsWith("/") ? basePath + href : href)}>
      {children}
    </RouterProvider>
  );
}
