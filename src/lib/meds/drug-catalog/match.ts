/**
 * Matches a medication as people write it against the catalog: "左氧氟沙星" without the form, a mistyped
 * character, "200mg" for "0.2g", "40" with no unit, "恩华" for 江苏恩华药业. A product only counts as
 * matched when the strength agrees; otherwise the caller gets the possibilities, and only the tags
 * every one of them shares.
 */

import { V_BRAND, V_COMPANY, commonTags, toVariant, type CatalogData, type CatalogVariant, type Variant } from "./search";

export interface MatchInput {
  name: string;
  dosage?: string;
  brands?: readonly string[];
}

export interface CatalogMaker extends CatalogVariant {
  /** The manufacturer or brand that was typed. */
  matched: boolean;
}

export interface MatchCandidate {
  id: number;
  name: string;
  strength: string;
  form: string;
  companies: number;
}

export interface CatalogMatch {
  status: "matched" | "ambiguous" | "none";
  /** The catalog's name, when what was typed differs from it. */
  suggestedName: string | null;
  /** Why it differs: a likely typo, or part of the name. */
  nameBasis: "typo" | "partial" | null;
  group: MatchCandidate | null;
  tags: string[];
  /** Every strength of this drug, for picking one. */
  strengths: string[];
  /** Who makes it, those that were typed first. */
  makers: CatalogMaker[];
  candidates: MatchCandidate[];
}

const NONE: CatalogMatch = { status: "none", suggestedName: null, nameBasis: null, group: null, tags: [], strengths: [], makers: [], candidates: [] };

const MAX_CANDIDATES = 8;
const MAX_MAKERS = 200;
const MAX_STRENGTHS = 40;
const MIN_PARTIAL = 3;
const MIN_TYPO = 4;

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

interface Index {
  names: string[];
  companies: string[];
  brands: string[];
  byName: Map<number, number[]>;
}

const indexes = new WeakMap<CatalogData, Index>();

function indexOf(data: CatalogData): Index {
  let index = indexes.get(data);
  if (!index) {
    const byName = new Map<number, number[]>();
    data.drugs.forEach((d, id) => {
      const list = byName.get(d[0]);
      if (list) list.push(id);
      else byName.set(d[0], [id]);
    });
    index = { names: data.names.map(norm), companies: data.companyShort.map(norm), brands: data.brands.map(norm), byName };
    indexes.set(data, index);
  }
  return index;
}

/** Levenshtein distance, giving up once it is above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

function findNames(index: Index, typed: string): { ids: number[]; basis: CatalogMatch["nameBasis"] } {
  const exact = index.names.indexOf(typed);
  if (exact >= 0) return { ids: [exact], basis: null };
  const partial: number[] = [];
  const typos: number[] = [];
  index.names.forEach((n, i) => {
    if (typed.length >= MIN_PARTIAL && n.includes(typed)) partial.push(i);
    // "盐酸左氧氟沙星片" for a catalog that lists "左氧氟沙星片".
    else if (n.length >= MIN_TYPO && typed.includes(n)) partial.push(i);
    else if (typed.length >= MIN_TYPO && editDistance(typed, n, 1) <= 1) typos.push(i);
  });
  // A wrong character beats a looser reading of the name.
  if (typos.length) return { ids: typos, basis: "typo" };
  return { ids: partial, basis: partial.length ? "partial" : null };
}

interface Strength {
  text: string;
  value: number | null;
  mg: number | null;
}

const TO_MG: Record<string, number> = { g: 1000, mg: 1, μg: 0.001, ug: 0.001, mcg: 0.001 };

function parseStrength(raw: string): Strength {
  const text = norm(raw).replace(/\(.*\)$/, "").replace(/^每[片粒支袋瓶丸贴](?:装|含)?/, "");
  const m = /^(\d+(?:\.\d+)?)(g|mg|μg|ug|mcg)?$/.exec(text);
  if (!m) return { text, value: null, mg: null };
  const value = Number(m[1]);
  return { text, value, mg: m[2] ? value * TO_MG[m[2]] : null };
}

function sameStrength(a: Strength, b: Strength): boolean {
  if (a.text === b.text) return true;
  if (a.value === null || b.value === null) return false;
  if (a.mg !== null && b.mg !== null) return Math.abs(a.mg - b.mg) < 1e-6;
  return a.value === b.value;
}

/** "江苏恩华药业（静康）" is two names for the maker. */
const brandParts = (brands: readonly string[]) => brands.flatMap((b) => norm(b).split(/[()]/)).filter((p) => p.length >= 2);

function makerHit(index: Index, v: Variant, parts: readonly string[]): boolean {
  const company = index.companies[v[V_COMPANY] as number];
  const brandId = v[V_BRAND] as number;
  const brand = brandId >= 0 ? index.brands[brandId] : "";
  return parts.some((p) => company.includes(p) || p.includes(company) || (brand !== "" && (brand.includes(p) || p.includes(brand))));
}

const candidate = (data: CatalogData, id: number): MatchCandidate => {
  const [name, strength, form, variants] = data.drugs[id];
  return { id, name: data.names[name], strength: data.strengths[strength], form: data.forms[form], companies: new Set(variants.map((v) => v[V_COMPANY])).size };
};

function strengthOrder(a: string, b: string): number {
  const x = parseStrength(a);
  const y = parseStrength(b);
  return (x.mg ?? x.value ?? Infinity) - (y.mg ?? y.value ?? Infinity) || a.localeCompare(b, "zh-CN");
}

export function matchDrug(data: CatalogData, input: MatchInput): CatalogMatch {
  const typedName = norm(input.name).replace(/\([^)]*\)/g, "");
  if (typedName.length < 2) return NONE;
  const index = indexOf(data);
  const { ids, basis } = findNames(index, typedName);
  if (ids.length === 0) return NONE;

  const all = ids.flatMap((n) => index.byName.get(n) ?? []);
  const typedStrength = input.dosage?.trim() ? parseStrength(input.dosage) : null;
  const parts = brandParts(input.brands ?? []);
  const variantsOf = (id: number) => data.drugs[id][3];
  const madeBy = (id: number) => parts.length > 0 && variantsOf(id).some((v) => makerHit(index, v, parts));

  const sameDose = typedStrength ? all.filter((id) => sameStrength(typedStrength, parseStrength(data.strengths[data.drugs[id][1]]))) : [];
  const dosePool = sameDose.length ? sameDose : all;
  const byMaker = dosePool.filter(madeBy);
  const pool = (byMaker.length ? byMaker : dosePool).toSorted((a, b) => variantsOf(b).length - variantsOf(a).length || a - b);

  const oneName = new Set(pool.map((id) => data.drugs[id][0])).size === 1;
  // A bare "0.5" hits both 0.5mg and 0.5g: that is not knowing the strength.
  const oneDose = new Set(pool.map((id) => parseStrength(data.strengths[data.drugs[id][1]]).mg ?? data.drugs[id][1])).size === 1;
  const matched = sameDose.length > 0 && oneName && oneDose;

  const picked = pool.flatMap(variantsOf);
  const hits = parts.length ? picked.filter((v) => makerHit(index, v, parts)) : [];
  const seen = new Set<string>();
  const makers = [...hits, ...picked.filter((v) => !hits.includes(v))]
    .filter((v) => {
      const key = `${v[V_COMPANY]}|${v[V_BRAND]}|${v[2]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MAKERS)
    .map((v) => ({ ...toVariant(data, v), matched: hits.includes(v) }));

  const strengths = [...new Set(all.map((id) => data.strengths[data.drugs[id][1]]).filter(Boolean))].sort(strengthOrder).slice(0, MAX_STRENGTHS);
  const first = pool[0];
  const catalogName = data.names[data.drugs[first][0]];
  const named = (matched || oneName) && basis !== null;
  return {
    status: matched ? "matched" : "ambiguous",
    suggestedName: named ? catalogName : null,
    nameBasis: named ? basis : null,
    group: matched ? candidate(data, first) : null,
    tags: commonTags(data, hits.length ? hits : picked),
    strengths,
    makers,
    candidates: matched ? [] : pool.slice(0, MAX_CANDIDATES).map((id) => candidate(data, id)),
  };
}
