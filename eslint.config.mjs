import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "coverage/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Catches lost escapes such as "\." in strings (this shell's heredocs collapse "\\" to "\").
  { rules: { "no-useless-escape": "error" } },
  // Client components never touch the DB or LLM layers directly (contracts §4). Server Components in
  // app/[locale]/** may call lib/db read helpers.
  {
    files: ["components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/lib/db/*", "@/lib/ai/*", "**/lib/db/*", "**/lib/ai/*"], message: "Call the HTTP API instead (contracts §4)." }] },
      ],
    },
  },
];

export default config;
