import { Nunito } from "next/font/google";

// Self-hosted at build time (no requests to Google from visitors). The variable font covers every weight used.
export const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
