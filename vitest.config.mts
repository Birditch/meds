import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { pdfFontFiles } from "./src/lib/meds/pdf-fonts";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // As next.config.ts provides it to the server code.
    env: { MEDS_PDF_FONTS: JSON.stringify(pdfFontFiles()) },
  },
});
