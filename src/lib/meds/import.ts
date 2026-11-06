/**
 * One-click import: a pasted list, one medication per line, read into stock counts, reserves,
 * pack sizes, regimens and new medications. Lines are free text, e.g.
 *
 *   他克莫司胶囊，普乐可复，1mg，每盒50颗，余 3盒12颗，储备 2盒，早1 晚1
 *   阿托伐他汀钙片(立普妥) 20mg 7片×2板 剩 20 片
 *
 * Amounts count as current stock unless a reserve word (储备 / 备用…) comes before them. A
 * number with no unit is only read right after such a word (余 86 → 86 颗).
 * Pure: shared by the import dialog and the tests.
 */

import { fmtPacks, fmtQty } from "./format";
import type { Dose } from "./simulate";
import type { PackUnit } from "./types";

export interface ImportAmount {
  /** Whole packs (boxes / bottles). */
  packs: number;
  /** Loose pills, or the whole amount when it was given in pills. */
  pills: number;
}

export interface ImportEntry {
  /** 1-based line number in the pasted text. */
  line: number;
  raw: string;
  name: string;
  brand: string | null;
  dosage: string | null;
  packUnit: PackUnit | null;
  perBox: number | null;
  stock: ImportAmount | null;
  reserve: ImportAmount | null;
  regimen: Dose | null;
  /** Parts of the line that could not be read. */
  warnings: string[];
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const PILL = "(?:颗|粒|片|丸|枚)";
const PACK = "(盒|瓶)";
const BLISTER = "(?:板|排|袋|条)";
const DOSE_UNIT = "(?:mg|g|μg|µg|ug|mcg|ml|iu|u|万单位|万u|单位|%)";
const SEP = " | ";

const RESERVE_WORDS = "储备|备用|备药|存货|囤货|另备";
const STOCK_WORDS = "当前余量|当前剩余|当前|余量|剩余|还剩|剩下|现有|手上|手头|在用|库存|剩|余";
const FILLER = /^(?:共|约|大约|大概|还有|有|和|及|另|另有|加|又|零|个|装)+$/;

const slotOf = (ch: string): keyof Dose => (ch === "早" ? "morning" : ch === "晚" ? "evening" : "noon");
const num = (s: string) => Number(s);

function parseLine(raw: string, line: number): ImportEntry | null {
  let rest = raw
    .normalize("NFKC")
    .replace(/^\s*(?:[-*•·]+|\d{1,3}\s*[.、)](?!\d))\s*/, "")
    .trim();
  if (!rest || rest.startsWith("#") || rest.startsWith("//")) return null;

  const entry: ImportEntry = {
    line,
    raw: raw.trim(),
    name: "",
    brand: null,
    dosage: null,
    packUnit: null,
    perBox: null,
    stock: null,
    reserve: null,
    regimen: null,
    warnings: [],
  };
  const take = (re: RegExp, on: (...m: string[]) => string | void) => {
    rest = rest.replace(re, (...args) => on(...(args.slice(0, -2) as string[])) ?? SEP);
  };
  const setPerBox = (value: number, unit?: string) => {
    if (!(value > 0) || !Number.isInteger(value * 2)) {
      entry.warnings.push(`每盒颗数 ${fmtQty(value)} 无效`);
    } else if (entry.perBox === null) {
      entry.perBox = value;
    } else if (entry.perBox !== value) {
      entry.warnings.push(`每盒颗数写了两次（${fmtQty(entry.perBox)}、${fmtQty(value)}），按 ${fmtQty(entry.perBox)}`);
    }
    if (unit && !entry.packUnit) entry.packUnit = unit as PackUnit;
  };

  // Labels: 药名：… / 品牌：… / 规格：…
  take(/(?:药名|名称|药品)\s*:\s*/g, () => " ");
  take(/(?:品牌|厂家|厂商|生产厂家)\s*:?\s*([^\s|,;，、]+)/g, (_, b) => void (entry.brand ??= b));
  take(/(?:规格|含量|剂量)\s*:?\s*([^\s|,;，、]+)/g, (_, v) =>
    new RegExp(`\\d${DOSE_UNIT}`, "i").test(v) ? ` ${v} ` : void (entry.dosage ??= v),
  );

  // Regimen: 早1 中0 晚1 / 早1/晚1 / 早晚各1片
  const dose: Partial<Dose> = {};
  take(new RegExp(`([早中午晚]{2,3})(?:各|都)\\s*${NUM}\\s*${PILL}?`, "g"), (_, slots, n) => {
    for (const ch of slots) dose[slotOf(ch)] = num(n);
  });
  take(new RegExp(`(早|中|午|晚)(?:上|晨|午|间)?\\s*:?\\s*${NUM}\\s*${PILL}?`, "g"), (_, ch, n) => {
    dose[slotOf(ch)] = num(n);
  });
  if (Object.keys(dose).length) entry.regimen = { morning: dose.morning ?? 0, noon: dose.noon ?? 0, evening: dose.evening ?? 0 };

  // Dosage: 10mg, 0.25g, 100mg/片
  const dosages: string[] = [];
  take(
    new RegExp(`${NUM}\\s*${DOSE_UNIT}(?![a-z])(?:\\s*\\/\\s*(?:\\d+(?:\\.\\d+)?\\s*)?(?:mg|g|ml|片|粒|颗|揿|喷|支))?`, "gi"),
    (m) => void dosages.push(m.replace(/\s+/g, "")),
  );
  if (dosages.length) entry.dosage ??= dosages.join("+");

  // Pills per pack: 7片×2板, ×24粒/盒, 30颗/盒, 每盒30颗, 28片装, 瓶装
  take(new RegExp(`${NUM}\\s*${PILL}?\\s*[x×*]\\s*${NUM}\\s*${BLISTER}(?:\\s*[/每]?\\s*${PACK})?`, "gi"), (_, a, b, u) =>
    setPerBox(num(a) * num(b), u),
  );
  take(new RegExp(`${NUM}\\s*${BLISTER}\\s*[x×*]\\s*${NUM}\\s*${PILL}(?:\\s*[/每]?\\s*${PACK})?`, "gi"), (_, a, b, u) =>
    setPerBox(num(a) * num(b), u),
  );
  take(new RegExp(`[x×*]\\s*${NUM}\\s*${PILL}(?:\\s*[/每]?\\s*${PACK})?`, "gi"), (_, a, u) => setPerBox(num(a), u));
  take(new RegExp(`${NUM}\\s*${PILL}\\s*(?:/|每)\\s*${PACK}`, "g"), (_, a, u) => setPerBox(num(a), u));
  take(new RegExp(`每\\s*${PACK}\\s*(?:装|有)?\\s*${NUM}\\s*${PILL}?`, "g"), (_, u, a) => setPerBox(num(a), u));
  take(new RegExp(`${PACK}装\\s*${NUM}\\s*${PILL}`, "g"), (_, u, a) => setPerBox(num(a), u));
  take(new RegExp(`${NUM}\\s*${PILL}\\s*装`, "g"), (_, a) => setPerBox(num(a)));
  take(new RegExp(`${PACK}装`, "g"), (_, u) => void (entry.packUnit ??= u as PackUnit));

  // Amounts, in the context of the last stock / reserve word before them.
  let ctx: "stock" | "reserve" = "stock";
  let keywordEnd = -1;
  const add = (packs: number, pills: number) => {
    const a = (entry[ctx] ??= { packs: 0, pills: 0 });
    a.packs += packs;
    a.pills += pills;
  };
  const amountRe = new RegExp(`(${RESERVE_WORDS})|(${STOCK_WORDS})|${NUM}\\s*(盒|瓶|${PILL})|${NUM}(?![\\d.])`, "g");
  const source = rest;
  rest = source.replace(amountRe, (m, reserveWord, stockWord, n, unit, bare, offset: number) => {
    if (reserveWord || stockWord) {
      ctx = reserveWord ? "reserve" : "stock";
      keywordEnd = offset + m.length;
      return SEP;
    }
    if (n !== undefined) {
      keywordEnd = -1;
      if (unit === "盒" || unit === "瓶") {
        add(num(n), 0);
        entry.packUnit ??= unit;
      } else add(0, num(n));
      return SEP;
    }
    // A bare number only counts right after a stock / reserve word: 余 86.
    if (keywordEnd >= 0 && /^[\s:=]*$/.test(source.slice(keywordEnd, offset))) {
      keywordEnd = -1;
      add(0, num(bare));
      return SEP;
    }
    return m;
  });

  // What is left: the name, then the brand. (立普妥) right after the name is a brand too.
  take(/\(([^()]*)\)/g, (_, b) => {
    const brand = b.replace(/\|/g, " ").trim();
    if (brand && !/^\d+(?:\.\d+)?$/.test(brand)) entry.brand ??= brand;
  });
  const tokens = rest
    .split(/[|,;，、；\t\s]+/)
    .map((t) => t.replace(/^[:=\-—.。]+|[:=\-—.。]+$/g, ""))
    .filter((t) => t && !FILLER.test(t));
  const words: string[] = [];
  for (const t of tokens) {
    if (/^\d+(?:\.\d+)?$/.test(t)) entry.warnings.push(`「${t}」没有单位，没能识别`);
    else words.push(t);
  }
  entry.name = words[0] ?? "";
  if (words.length > 1) entry.brand ??= words.slice(1).join(" ");
  if (!entry.name) entry.warnings.push("没有识别出药名");
  return entry;
}

/** Every non-empty line that is not a comment (# or //). */
export function parseImportText(text: string): ImportEntry[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => parseLine(raw, i + 1))
    .filter((e): e is ImportEntry => e !== null);
}

/* -------------------------------------- matching -------------------------------------- */

export interface ImportCandidate {
  id: number;
  name: string;
  brand: string | null;
  dosage: string;
  /** Pinyin keys (full and initials) of the name and brand. */
  searchKeys?: readonly string[];
  /** Every manufacturer / brand (packs); `brand` is the default one. */
  packs?: readonly { brand: string | null }[];
}

export type ImportMatch =
  | { kind: "match"; id: number }
  /** Several medications fit equally well: the user picks one. */
  | { kind: "ambiguous"; ids: number[] }
  /** No medication fits; `similar` share the name but not the dosage. */
  | { kind: "none"; similar: number[] };

export const key = (s: string | null | undefined) =>
  (s ?? "").normalize("NFKC").toLowerCase().replace(/[\s()（）·・\-_/]/g, "");
const brandsOf = (m: ImportCandidate) => (m.packs ?? [{ brand: m.brand }]).map((p) => key(p.brand)).filter(Boolean);

/**
 * The existing medication a line is about: same name (or brand, or pinyin), then narrowed by
 * dosage and brand when the line gives them. A name match whose dosage differs is a different
 * medication.
 */
export function matchEntry(entry: Pick<ImportEntry, "name" | "brand" | "dosage">, meds: readonly ImportCandidate[]): ImportMatch {
  const k = key(entry.name);
  if (!k) return { kind: "none", similar: [] };
  const contains = (a: string, b: string) => a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
  const tiers = [
    (m: ImportCandidate) => key(m.name) === k,
    (m: ImportCandidate) => brandsOf(m).includes(k),
    (m: ImportCandidate) => contains(key(m.name), k),
    (m: ImportCandidate) => (m.searchKeys ?? []).some((s) => key(s) === k),
  ];
  let found: ImportCandidate[] = [];
  for (const tier of tiers) {
    found = meds.filter(tier);
    if (found.length) break;
  }
  if (!found.length) return { kind: "none", similar: [] };

  if (entry.dosage) {
    const d = key(entry.dosage);
    // From the start only: "1mg×50粒" is 1mg, but "0.5mg" is not 5mg.
    const same = found.filter((m) => {
      const md = key(m.dosage);
      return md.startsWith(d) || d.startsWith(md);
    });
    if (!same.length) return { kind: "none", similar: found.map((m) => m.id) };
    found = same;
  }
  if (found.length > 1 && entry.brand) {
    const b = key(entry.brand);
    const same = found.filter((m) => brandsOf(m).includes(b));
    if (same.length) found = same;
  }
  return found.length === 1 ? { kind: "match", id: found[0].id } : { kind: "ambiguous", ids: found.map((m) => m.id) };
}

/* -------------------------------------- amounts -------------------------------------- */

export type ResolvedImportAmount = { value: number | null } | { error: string };

/** Packs + loose pills as typed in the import table; both empty = leave unchanged. */
export function resolveImportAmount(boxes: string, loose: string, perBox: number | null, unit: string = "盒"): ResolvedImportAmount {
  const b = boxes.trim();
  const l = loose.trim();
  if (!b && !l) return { value: null };
  const packs = b ? Number(b) : 0;
  const pills = l ? Number(l) : 0;
  if (!Number.isFinite(packs) || packs < 0) return { error: `${unit}数无效` };
  if (!Number.isFinite(pills) || pills < 0 || !Number.isInteger(pills * 2)) return { error: "颗数只能是整数或 0.5 的倍数" };
  if (packs > 0 && !perBox) return { error: `未写明每${unit}颗数，无法按${unit}计算` };
  const halves = (packs * (perBox ?? 0) + pills) * 2;
  if (Math.abs(halves - Math.round(halves)) > 1e-9) return { error: "合计颗数只能是整数或 0.5 的倍数" };
  if (halves > 200_000) return { error: "数量过大" };
  return { value: Math.round(halves) / 2 };
}

/* -------------------------------------- template -------------------------------------- */

export interface TemplateItem {
  name: string;
  brand: string | null;
  dosage: string;
  packUnit: PackUnit;
  perBox: number | null;
  stock: number;
  reserve: number;
  regimen: Dose | null;
}

/** The current list in the import format, to edit and paste back. */
export function importTemplate(items: readonly TemplateItem[]): string {
  return items
    .map((m) =>
      [
        m.name,
        m.brand,
        m.dosage,
        m.perBox ? `每${m.packUnit}${fmtQty(m.perBox)}颗` : null,
        `余 ${fmtPacks(m.stock, m.perBox, m.packUnit)}`,
        `储备 ${fmtPacks(m.reserve, m.perBox, m.packUnit)}`,
        m.regimen ? `早${fmtQty(m.regimen.morning)} 中${fmtQty(m.regimen.noon)} 晚${fmtQty(m.regimen.evening)}` : null,
      ]
        .filter(Boolean)
        .join("，"),
    )
    .join("\n");
}
