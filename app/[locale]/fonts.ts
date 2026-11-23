import { Atkinson_Hyperlegible_Next, Sarabun } from "next/font/google";

/** Latin UI. Wired into --font-sans in app/globals.css. Chinese uses system CJK fonts (see the stack there). */
export const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700", "800"],
  display: "swap",
  variable: "--font-atkinson",
});

/** Thai report text only (class `font-thai`). Not preloaded: only the Report summary uses it. */
export const sarabun = Sarabun({
  subsets: ["thai"],
  weight: ["400", "700"],
  display: "swap",
  preload: false,
  variable: "--font-sarabun",
});

export const fontVariables = `${atkinson.variable} ${sarabun.variable}`;
