/**
 * The PDF font files (Noto Sans SC, SIL OFL 1.1), as paths relative to the project root.
 *
 * Resolved through pnpm's symlinks at build time: the standalone output copies the real files
 * but not the links. next.config.ts traces exactly these two files into the build and hands the
 * paths to the server code as MEDS_PDF_FONTS; vitest.config.mts does the same for the tests.
 */

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface PdfFontFiles {
  regular: string;
  bold: string;
}

export function pdfFontFiles(root: string = process.cwd()): PdfFontFiles {
  const require = createRequire(path.join(root, "package.json"));
  const file = (weight: string) =>
    path.relative(root, realpathSync(require.resolve(`@expo-google-fonts/noto-sans-sc/${weight}/NotoSansSC_${weight}.ttf`)));
  return { regular: file("400Regular"), bold: file("700Bold") };
}
