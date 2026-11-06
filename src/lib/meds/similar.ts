/**
 * Telling medications apart. A medication is one pill: a drug in one dosage form and one
 * strength. Manufacturers are packs of the same medication; another strength or dosage form is
 * another medication of the same drug.
 *
 *   氯硝西泮片 2mg 湖南洞庭 / 江苏恩华   → the same medication, two packs
 *   帕利哌酮缓释片 3mg / 6mg             → the same drug, two strengths
 *   盐酸普萘洛尔片 / 盐酸普萘洛尔缓释片   → the same ingredient, two dosage forms
 */

import { matchScore, type Searchable } from "./search";

const clean = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s()（）[\]【】·・\-_/,，、。:：;；'"“”‘’]/g, "");

// Longest first, so 缓释片 wins over 片.
const FORMS = [
  "缓释胶囊", "控释胶囊", "肠溶胶囊", "缓释片", "控释片", "肠溶片", "分散片", "口崩片", "口腔崩解片", "咀嚼片", "泡腾片", "含片",
  "舌下片", "薄膜衣片", "糖衣片", "软胶囊", "硬胶囊", "胶囊", "颗粒", "干混悬剂", "混悬液", "口服溶液", "口服液", "糖浆", "滴丸",
  "丸", "散", "注射液", "注射剂", "注射用", "滴眼液", "滴耳液", "滴鼻液", "眼膏", "乳膏", "软膏", "凝胶", "贴剂", "贴膏", "喷雾剂",
  "气雾剂", "吸入剂", "吸入粉雾剂", "栓", "溶液", "片", "粉",
].sort((a, b) => b.length - a.length);

// Salt / ester parts that name the same active moiety.
const SALTS = [
  "盐酸", "硫酸", "磷酸", "硝酸", "氢溴酸", "马来酸", "甲磺酸", "苯磺酸", "富马酸", "琥珀酸", "酒石酸", "枸橼酸", "醋酸", "乳酸",
  "草酸", "碳酸", "二盐酸", "氢氯酸", "门冬氨酸", "葡萄糖酸",
].sort((a, b) => b.length - a.length);
const SALT_SUFFIXES = ["钠", "钾", "钙", "镁", "锌"];

export interface DrugName {
  /** The active ingredient: no salt part, no dosage form. */
  core: string;
  /** The dosage form (片, 缓释片, 胶囊…), or "" when the name gives none. */
  form: string;
}

export function drugName(name: string): DrugName {
  let s = clean(name);
  let form = "";
  for (const f of FORMS) {
    if (s.endsWith(f) && s.length > f.length) {
      form = f;
      s = s.slice(0, -f.length);
      break;
    }
    if (f === "注射用" && s.startsWith(f) && s.length > f.length) {
      form = "注射剂";
      s = s.slice(f.length);
      break;
    }
  }
  if (form === "注射液") form = "注射剂";
  for (const salt of SALTS) {
    if (s.startsWith(salt) && s.length > salt.length + 1) {
      s = s.slice(salt.length);
      break;
    }
  }
  for (const suffix of SALT_SUFFIXES) {
    if (s.endsWith(suffix) && s.length > suffix.length + 1) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return { core: s, form };
}

/** Medications with the same key are the same drug in the same form (they differ in strength only). */
export function drugKey(name: string): string {
  const { core, form } = drugName(name);
  return `${core}|${form}`;
}

const MASS: Record<string, number> = { g: 1000, 克: 1000, mg: 1, 毫克: 1, μg: 0.001, µg: 0.001, ug: 0.001, mcg: 0.001, 微克: 0.001 };

/** Whether two strengths are the same: 0.1g = 100mg; "1mg×50粒" is 1mg; units must agree. */
export function sameDosage(a: string, b: string): boolean {
  const ka = clean(a);
  const kb = clean(b);
  if (!ka || !kb) return ka === kb;
  if (ka === kb) return true;
  const unit = /^(\d+(?:\.\d+)?)(mg|g|μg|µg|ug|mcg|毫克|克|微克)(?![a-z])/;
  const ma = unit.exec(ka);
  const mb = unit.exec(kb);
  if (ma && mb) return Math.abs(Number(ma[1]) * MASS[ma[2]] - Number(mb[1]) * MASS[mb[2]]) < 1e-9;
  // Same leading text, the rest being a pack description: 1mg×50粒 / 1mg.
  const lead = /^([\d.]+)([a-zμµ%毫微克升单位]*)/;
  const la = lead.exec(ka);
  const lb = lead.exec(kb);
  if (!la || !lb || la[1] !== lb[1]) return false;
  // A bare number (40) is taken to be in the other's unit (40mg).
  return la[2] === lb[2] || !la[2] || !lb[2];
}

export type Similarity =
  /** Same drug, form and strength: it is this medication (add a manufacturer instead). */
  | "same"
  /** Same drug and form; no strength typed yet. */
  | "drug"
  /** Same drug and form, another strength. */
  | "strength"
  /** Same active ingredient, another dosage form (片 / 缓释片). */
  | "form"
  /** The name is close (typing, pinyin, a brand name). */
  | "similar";

export interface SimilarCandidate extends Searchable {
  id: number;
  packs?: readonly { brand: string | null }[];
}

export interface SimilarMatch<T> {
  medication: T;
  kind: Similarity;
  /** For "same": a pack with the brand typed (it is already there). */
  samePack: boolean;
}

const RANK: Record<Similarity, number> = { same: 0, drug: 1, strength: 2, form: 3, similar: 4 };

/**
 * Existing medications the one being entered may duplicate, closest first. `dosage` / `brand`
 * may be empty while typing.
 */
export function findSimilar<T extends SimilarCandidate>(
  input: { name: string; dosage?: string; brand?: string | null },
  meds: readonly T[],
): SimilarMatch<T>[] {
  const name = clean(input.name);
  if (name.length < 1) return [];
  const typed = drugName(input.name);
  const brand = clean(input.brand ?? "");
  const out: (SimilarMatch<T> & { score: number })[] = [];
  for (const m of meds) {
    const their = drugName(m.name);
    const brands = (m.packs ?? [{ brand: m.brand }]).map((p) => clean(p.brand ?? "")).filter(Boolean);
    const samePack = !!brand && brands.includes(brand);
    let kind: Similarity | null = null;
    if (typed.core && typed.core === their.core) {
      // A name without a form (氯硝西泮) is taken to mean the form on file.
      const sameForm = typed.form === their.form || !typed.form || !their.form;
      if (!sameForm) kind = "form";
      else if (input.dosage?.trim() && !sameDosage(input.dosage, m.dosage)) kind = "strength";
      else kind = input.dosage?.trim() ? "same" : "drug";
    } else {
      const core = typed.core || name;
      const contains = core.length >= 2 && their.core.length >= 2 && (their.core.includes(core) || core.includes(their.core));
      const brandHit = name.length >= 2 && brands.some((b) => b === name || b.includes(name));
      const score = name.length >= 2 ? matchScore(m, input.name) : 0;
      if (contains || brandHit || score >= Math.max(3, Math.min(6, name.length))) kind = "similar";
    }
    if (kind) out.push({ medication: m, kind, samePack, score: matchScore(m, input.name) });
  }
  return out
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.score - a.score)
    .map(({ medication, kind, samePack }) => ({ medication, kind, samePack }));
}

export const SIMILARITY_LABEL: Record<Similarity, string> = {
  same: "同一种药",
  drug: "同一药物",
  strength: "同药不同规格",
  form: "同成分不同剂型",
  similar: "名称相近",
};
