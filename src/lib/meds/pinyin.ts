import "server-only";

import { pinyin } from "pinyin-pro";

/**
 * Search keys for Chinese text: full pinyin without tones ("amoxilin") and initials
 * ("amxl"). Server-only, so the pinyin dictionary never ships to the browser.
 */
export function pinyinKeys(text: string): string[] {
  if (!/[㐀-鿿]/.test(text)) return [];
  const full = pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive" }).join("");
  const initials = pinyin(text, { pattern: "first", toneType: "none", type: "array", nonZh: "consecutive" }).join("");
  return [full, initials].map((k) => k.toLowerCase().replace(/\s+/g, ""));
}
