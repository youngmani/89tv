"use client";

import { useState } from "react";
import { App } from "@/components/App";
import { ServicesProvider, createLiveServices } from "@/lib/services";

export default function Page() {
  // Created once; a stable value means consuming the context never re-renders anything.
  const [services] = useState(createLiveServices);
  return (
    <ServicesProvider value={services}>
      <App />
    </ServicesProvider>
  );
}
