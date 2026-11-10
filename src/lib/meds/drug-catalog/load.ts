import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { CatalogData } from "./search";

/** Unpacked on first use and dropped when idle: it is tens of MB in a 512 MB container, used only when adding a drug. */
const IDLE_MS = 10 * 60 * 1000;

let cached: CatalogData | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function loadCatalog(): CatalogData {
  cached ??= JSON.parse(gunzipSync(readFileSync(path.join(process.cwd(), "data", "drug-catalog.json.gz"))).toString("utf8")) as CatalogData;
  clearTimeout(timer);
  timer = setTimeout(() => {
    cached = null;
  }, IDLE_MS);
  timer.unref();
  return cached;
}
