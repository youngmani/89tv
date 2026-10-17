"use client";

import { useState } from "react";
import { App } from "@/components/App";
import { DemoRibbon, ExitDemo } from "@/components/DemoChrome";
import { createDemoServices } from "@/lib/demo";
import { ServicesProvider } from "@/lib/services";

/**
 * /demo: the real app with a fake account and fake saving (lib/demo.ts). Searches hit 7TV for real;
 * nothing is persisted, so a reload starts fresh and a real in-progress mapping is never touched.
 */
export default function DemoPage() {
  const [services] = useState(createDemoServices);
  return (
    <ServicesProvider value={services}>
      <DemoRibbon />
      <App headerAction={<ExitDemo />} />
    </ServicesProvider>
  );
}
