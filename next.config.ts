import type { NextConfig } from "next";
import { pdfFontFiles } from "./src/lib/meds/pdf-fonts";

const pdfFonts = pdfFontFiles();

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  // PDFKit loads its own data files at runtime: keep it a plain Node dependency.
  serverExternalPackages: ["pdfkit"],
  // Where src/lib/meds/pdf.ts finds its fonts (inlined at build time).
  env: { MEDS_PDF_FONTS: JSON.stringify(pdfFonts) },
  outputFileTracingIncludes: {
    // The SQL migrations are read at boot by src/instrumentation.ts.
    "/*": ["./drizzle/**/*"],
    // The two font files the PDF lists embed.
    // Keys are globs over route paths: the brackets are literal.
    "/api/reports/\\[kind\\]": [pdfFonts.regular, pdfFonts.bold],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
