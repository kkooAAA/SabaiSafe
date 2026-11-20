import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // pdfkit reads its font metric files from disk at runtime; don't bundle it.
  serverExternalPackages: ["pdfkit"],
  // Tree-shake the radix-ui umbrella package and lucide icons (shadcn imports them whole).
  experimental: { optimizePackageImports: ["radix-ui", "lucide-react"] },
  // Thai font files for the PDF are read from disk at runtime by /api/report/pdf.
  // Sample mode (no Supabase) reads content/ files at runtime from pages and API routes.
  outputFileTracingIncludes: {
    "/api/report/pdf": ["./lib/pdf/fonts/**/*"],
    // Sample-mode legal search (lib/ai/legal-index.ts) reads content/legal at runtime.
    "/api/chat": ["./content/legal/**/*"],
    "/**/*": ["./content/prices.csv", "./content/help.json"],
  },
};

export default withNextIntl(nextConfig);
