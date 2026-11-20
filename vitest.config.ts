import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // next-intl's ESM build imports "next/server" without an extension; inline it so Vite resolves it.
    server: { deps: { inline: ["next-intl"] } },
    // Tests never call real services: AI_PROVIDER=mock and no Supabase env => in-memory sample data.
    env: {
      AI_PROVIDER: "mock",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SAMPLE_REPORTS_IN_MEMORY: "1",
    },
  },
});
