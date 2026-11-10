/**
 * Search over the bundled drug catalog (data/drug-catalog.json.gz). Pure, so it is testable without
 * the file. The file interns every repeated string; a variant is a flat array to keep the heap small
 * in the 512 MB container: head fields, then the packs four numbers at a time.
 */

export interface CatalogData {
  version: 1;
  source: { title: string; maintainedAt: string; url: string };
  names: string[];
  nameKeys: string[];
  companies: string[];
  companyShort: string[];
  companyKeys: string[];
  brands: string[];
  brandKeys: string[];
  strengths: string[];
  forms: string[];
  materials: string[];
  notes: string[];
  units: string[];
  tagSets: string[][];
  /** [name, strength, form, variants]. */
  drugs: [number, number, number, (number | string)[][]][];
}

export type Variant = readonly (number | string)[];

export const V_COMPANY = 0;
export const V_BRAND = 1;
const V_APPROVAL = 2;
const V_INSURANCE = 3;
const V_TAGS = 4;
const V_NOTE = 5;
const V_PACKS = 6;
const PACK_FIELDS = 4;

export type Insurance = "甲" | "乙" | "商保" | null;
const INSURANCE: Insurance[] = [null, "甲", "乙", "商保"];

export interface CatalogGroup {
  id: number;
  name: string;
  strength: string;
  form: string;
  /** Manufacturers that make it. */
  companies: number;
  /** A few of them, the ones the query named first. */
  examples: string[];
  /** Tags every manufacturer's product shares. */
  tags: string[];
}

export interface CatalogPack {
  perBox: number;
  unit: string;
  packUnit: string;
  material: string | null;
}

export interface CatalogVariant {
  company: string;
  companyShort: string;
  brand: string | null;
  approval: string;
  insurance: Insurance;
  tags: string[];
  /** Restrictions the insurance list puts on payment. */
  note: string | null;
  packs: CatalogPack[];
}

export interface CatalogDetail extends Omit<CatalogGroup, "examples" | "companies"> {
  variants: CatalogVariant[];
}

export const normalizeQuery = (q: string) => q.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);

const EXACT = 4;
const PREFIX = 3;
const CONTAINS = 2;
const PINYIN = 1;

/** How each entry of a table matches a term: one byte per entry, 0 for no match. */
function matchTable(table: readonly string[], keys: readonly string[] | null, term: string): Uint8Array {
  const out = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) {
    const text = table[i].toLowerCase();
    const at = text.indexOf(term);
    if (at === 0) out[i] = text.length === term.length ? EXACT : PREFIX;
    else if (at > 0) out[i] = CONTAINS;
    else if (keys && keys[i].includes(term)) out[i] = PINYIN;
  }
  return out;
}

interface TermTables {
  term: string;
  names: Uint8Array;
  strengths: Uint8Array;
  companies: Uint8Array;
  brands: Uint8Array;
  /** Only a term that looks like part of a number is compared with approval numbers. */
  approval: boolean;
}

function termTables(data: CatalogData, terms: readonly string[]): TermTables[] {
  return terms.map((term) => ({
    term,
    names: matchTable(data.names, data.nameKeys, term),
    strengths: matchTable(data.strengths, null, term),
    companies: matchTable(data.companyShort, data.companyKeys, term),
    brands: matchTable(data.brands, data.brandKeys, term),
    approval: /\d{4}/.test(term) || term.includes("国药准字"),
  }));
}

/** How a variant answers a term: the best of manufacturer, brand and approval number. */
function variantHit(v: readonly (number | string)[], t: TermTables): number {
  const company = t.companies[v[V_COMPANY] as number];
  const brand = (v[V_BRAND] as number) >= 0 ? t.brands[v[V_BRAND] as number] : 0;
  const approval = t.approval && (v[V_APPROVAL] as string).toLowerCase().includes(t.term) ? CONTAINS : 0;
  return Math.max(company, brand, approval);
}

const NAME_WEIGHT = 30;
const BRAND_WEIGHT = 10;
const STRENGTH_WEIGHT = 5;

function scoreDrug(d: CatalogData["drugs"][number], tables: readonly TermTables[]): number {
  let score = 0;
  for (const t of tables) {
    const byName = t.names[d[0]] * NAME_WEIGHT;
    const byStrength = t.strengths[d[1]] * STRENGTH_WEIGHT;
    let best = Math.max(byName, byStrength);
    // A name that already answers the term outranks anything a manufacturer could add.
    if (best < PINYIN * NAME_WEIGHT) {
      for (const v of d[3]) best = Math.max(best, variantHit(v, t) * BRAND_WEIGHT);
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

const distinctCompanies = (variants: readonly (number | string)[][]) => new Set(variants.map((v) => v[V_COMPANY] as number));

export function commonTags(data: CatalogData, variants: readonly Variant[]): string[] {
  let tags = data.tagSets[variants[0][V_TAGS] as number];
  for (const v of variants) {
    if (tags.length === 0) break;
    const other = data.tagSets[v[V_TAGS] as number];
    tags = tags.filter((t) => other.includes(t));
  }
  return tags;
}

const isListed = (v: readonly (number | string)[]) => v[V_INSURANCE] === 1 || v[V_INSURANCE] === 2;

/** Manufacturers the query named first, then those the insurance list covers, then the rest. */
function orderVariants(variants: readonly (number | string)[][], tables: readonly TermTables[], data: CatalogData) {
  const rank = (v: readonly (number | string)[]) => tables.reduce((n, t) => n + variantHit(v, t), 0);
  return variants
    .map((v) => ({ v, hit: rank(v), listed: isListed(v) ? 1 : 0 }))
    .sort(
      (a, b) =>
        b.hit - a.hit ||
        b.listed - a.listed ||
        data.companyShort[a.v[V_COMPANY] as number].localeCompare(data.companyShort[b.v[V_COMPANY] as number], "zh-CN"),
    )
    .map((x) => x.v);
}

export const MAX_GROUPS = 40;
const MAX_EXAMPLES = 3;

export function searchCatalog(data: CatalogData, query: string, limit = MAX_GROUPS): { total: number; groups: CatalogGroup[] } {
  const terms = normalizeQuery(query);
  if (terms.length === 0) return { total: 0, groups: [] };
  const tables = termTables(data, terms);
  const hits: { id: number; score: number; listed: number; makers: number }[] = [];
  data.drugs.forEach((d, id) => {
    const score = scoreDrug(d, tables);
    if (score > 0) hits.push({ id, score, listed: d[3].some(isListed) ? 1 : 0, makers: d[3].length });
  });
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      b.listed - a.listed ||
      b.makers - a.makers ||
      data.names[data.drugs[a.id][0]].length - data.names[data.drugs[b.id][0]].length ||
      a.id - b.id,
  );
  const groups = hits.slice(0, limit).map(({ id }) => {
    const [name, strength, form, variants] = data.drugs[id];
    const ordered = orderVariants(variants, tables, data);
    return {
      id,
      name: data.names[name],
      strength: data.strengths[strength],
      form: data.forms[form],
      companies: distinctCompanies(variants).size,
      examples: [...new Set(ordered.map((v) => data.companyShort[v[V_COMPANY] as number]))].slice(0, MAX_EXAMPLES),
      tags: commonTags(data, variants),
    };
  });
  return { total: hits.length, groups };
}

export function toVariant(data: CatalogData, v: Variant): CatalogVariant {
  const packs: CatalogPack[] = [];
  for (let i = V_PACKS; i < v.length; i += PACK_FIELDS) {
    const material = v[i + 3] as number;
    packs.push({
      perBox: v[i] as number,
      unit: data.units[v[i + 1] as number],
      packUnit: data.units[v[i + 2] as number],
      material: material >= 0 ? data.materials[material] : null,
    });
  }
  return {
    company: data.companies[v[V_COMPANY] as number],
    companyShort: data.companyShort[v[V_COMPANY] as number],
    brand: (v[V_BRAND] as number) >= 0 ? data.brands[v[V_BRAND] as number] : null,
    approval: v[V_APPROVAL] as string,
    insurance: INSURANCE[v[V_INSURANCE] as number],
    tags: data.tagSets[v[V_TAGS] as number],
    note: (v[V_NOTE] as number) >= 0 ? data.notes[v[V_NOTE] as number] : null,
    packs: packs.sort((a, b) => a.perBox - b.perBox),
  };
}

/** Every manufacturer of one drug and strength, with its pack sizes. */
export function catalogDetail(data: CatalogData, id: number, query = ""): CatalogDetail | null {
  const drug = data.drugs[id];
  if (!drug) return null;
  const [name, strength, form, variants] = drug;
  const tables = termTables(data, normalizeQuery(query));
  return {
    id,
    name: data.names[name],
    strength: data.strengths[strength],
    form: data.forms[form],
    tags: commonTags(data, variants),
    variants: orderVariants(variants, tables, data).map((v) => toVariant(data, v)),
  };
}
