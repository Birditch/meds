/**
 * Medication tags. The catalog follows the Chinese categories a prescription depends on
 * (special management under 《麻醉药品和精神药品管理条例》 / 《处方管理办法》, Rx / OTC,
 * medical insurance class, antibacterial grade) plus storage and use notes. Catalog tags are
 * stored by code; anything else the user types is kept as their own tag.
 *
 * Tags sharing a `set` exclude each other (a drug is 精一 or 精二, Rx or OTC, not both).
 */

export type TagTone = "red" | "orange" | "amber" | "green" | "sky" | "violet" | "slate";

export interface TagDef {
  code: string;
  /** Full name, e.g. 第二类精神药品. */
  label: string;
  /** Badge text, e.g. 精二. */
  short: string;
  group: TagGroupId;
  /** Mutually exclusive with the other tags of the same set. */
  set?: string;
  tone: TagTone;
  /** Other ways people write it; matched when typing a tag or searching. */
  aliases: string[];
  /** One line on what it means in practice. */
  note?: string;
}

export type TagGroupId = "control" | "rx" | "insurance" | "catalog" | "origin" | "antibacterial" | "storage" | "use";

export const TAG_GROUPS: { id: TagGroupId; title: string }[] = [
  { id: "control", title: "特殊管理药品" },
  { id: "rx", title: "处方 / 非处方" },
  { id: "insurance", title: "医保" },
  { id: "catalog", title: "目录 / 采购" },
  { id: "origin", title: "来源" },
  { id: "antibacterial", title: "抗菌药物分级" },
  { id: "storage", title: "储存" },
  { id: "use", title: "用法 / 注意" },
];

const SPECIAL_RX = "需专用处方，单张处方用量受限，开药前和医生确认够吃到下次复诊";

export const TAGS: TagDef[] = [
  // 特殊管理
  { code: "narcotic", label: "麻醉药品", short: "麻", group: "control", set: "psy", tone: "red", aliases: ["麻醉", "麻醉药", "麻"], note: `${SPECIAL_RX}（淡红色处方，标“麻、精一”）` },
  { code: "psy1", label: "第一类精神药品", short: "精一", group: "control", set: "psy", tone: "red", aliases: ["精一", "一类精神", "第一类精神", "一类精神药品", "一精"], note: `${SPECIAL_RX}（淡红色处方，标“麻、精一”）` },
  { code: "psy2", label: "第二类精神药品", short: "精二", group: "control", set: "psy", tone: "amber", aliases: ["精二", "二类精神", "第二类精神", "二类精神药品", "二精"], note: `${SPECIAL_RX}（白色处方，标“精二”；一般每张不超过 7 日用量，慢性病可适当延长，需医生注明理由）` },
  { code: "toxic", label: "医疗用毒性药品", short: "毒", group: "control", tone: "red", aliases: ["毒性药品", "毒性", "医疗用毒性"] },
  { code: "radioactive", label: "放射性药品", short: "放", group: "control", tone: "violet", aliases: ["放射性", "放射"] },
  { code: "precursor", label: "药品类易制毒化学品", short: "易制毒", group: "control", tone: "orange", aliases: ["易制毒", "易制毒化学品"] },
  { code: "doping", label: "含兴奋剂", short: "兴奋剂", group: "control", tone: "orange", aliases: ["兴奋剂", "含兴奋剂药品"] },
  { code: "special-compound", label: "含特殊药品复方制剂", short: "含特药复方", group: "control", tone: "orange", aliases: ["含特殊药品复方", "特药复方", "含麻复方"] },
  // 处方 / 非处方
  { code: "rx", label: "处方药", short: "Rx", group: "rx", set: "rx", tone: "slate", aliases: ["处方药", "处方", "rx", "凭处方"] },
  { code: "otc", label: "非处方药", short: "OTC", group: "rx", set: "rx", tone: "green", aliases: ["非处方药", "非处方", "otc"] },
  { code: "otc-a", label: "甲类非处方药", short: "OTC甲", group: "rx", set: "rx", tone: "red", aliases: ["甲类非处方", "甲类otc", "otc甲", "otc甲类", "红otc"] },
  { code: "otc-b", label: "乙类非处方药", short: "OTC乙", group: "rx", set: "rx", tone: "green", aliases: ["乙类非处方", "乙类otc", "otc乙", "otc乙类", "绿otc"] },
  // 医保
  { code: "ins", label: "医保", short: "医保", group: "insurance", set: "ins", tone: "sky", aliases: ["医保", "医保药", "医保报销"] },
  { code: "ins-a", label: "医保甲类", short: "医保甲", group: "insurance", set: "ins", tone: "green", aliases: ["甲类医保", "医保甲", "甲类"] },
  { code: "ins-b", label: "医保乙类", short: "医保乙", group: "insurance", set: "ins", tone: "sky", aliases: ["乙类医保", "医保乙", "乙类"] },
  { code: "self-pay", label: "自费", short: "自费", group: "insurance", set: "ins", tone: "slate", aliases: ["自费", "自费药", "非医保", "丙类"] },
  { code: "chronic-ins", label: "门诊慢特病", short: "慢特病", group: "insurance", tone: "sky", aliases: ["慢病", "门慢", "门特", "慢特病", "门诊慢性病", "门诊特殊病"] },
  // 目录 / 采购
  { code: "essential", label: "国家基本药物", short: "基药", group: "catalog", tone: "green", aliases: ["基药", "基本药物", "国家基药"] },
  { code: "vbp", label: "国家集采", short: "集采", group: "catalog", tone: "sky", aliases: ["集采", "集中采购", "带量采购", "国采"] },
  { code: "negotiated", label: "国家谈判药", short: "国谈", group: "catalog", tone: "violet", aliases: ["国谈", "谈判药", "国谈药", "医保谈判"] },
  { code: "dual-channel", label: "双通道药品", short: "双通道", group: "catalog", tone: "violet", aliases: ["双通道"] },
  // 来源
  { code: "imported", label: "进口药", short: "进口", group: "origin", set: "origin", tone: "violet", aliases: ["进口", "进口药品"], note: "医院一般月初才有进口药" },
  { code: "domestic", label: "国产", short: "国产", group: "origin", set: "origin", tone: "slate", aliases: ["国产药", "国内"] },
  { code: "originator", label: "原研药", short: "原研", group: "origin", set: "generic", tone: "violet", aliases: ["原研", "原研药品"] },
  { code: "generic", label: "仿制药", short: "仿制", group: "origin", set: "generic", tone: "slate", aliases: ["仿制", "仿制药品"] },
  { code: "consistency", label: "通过一致性评价", short: "过评", group: "origin", tone: "green", aliases: ["过评", "一致性评价", "通过一致性评价"] },
  // 抗菌药物分级（《抗菌药物临床应用管理办法》）
  { code: "abx", label: "抗菌药物", short: "抗菌药", group: "antibacterial", set: "abx", tone: "orange", aliases: ["抗菌药", "抗生素", "抗菌"] },
  { code: "abx-unrestricted", label: "抗菌药物·非限制使用级", short: "抗菌·非限制", group: "antibacterial", set: "abx", tone: "orange", aliases: ["非限制使用级", "非限制级", "非限制"] },
  { code: "abx-restricted", label: "抗菌药物·限制使用级", short: "抗菌·限制", group: "antibacterial", set: "abx", tone: "orange", aliases: ["限制使用级", "限制级"] },
  { code: "abx-special", label: "抗菌药物·特殊使用级", short: "抗菌·特殊", group: "antibacterial", set: "abx", tone: "red", aliases: ["特殊使用级", "特殊级"] },
  // 储存
  { code: "cold", label: "冷藏（2–8℃）", short: "冷藏", group: "storage", set: "temp", tone: "sky", aliases: ["冷藏", "2-8度", "2~8℃", "冰箱"] },
  { code: "cool", label: "阴凉（不超过 20℃）", short: "阴凉", group: "storage", set: "temp", tone: "sky", aliases: ["阴凉", "阴凉处", "20度以下"] },
  { code: "dark", label: "避光", short: "避光", group: "storage", tone: "slate", aliases: ["避光", "遮光"] },
  { code: "dry", label: "密封防潮", short: "防潮", group: "storage", tone: "slate", aliases: ["防潮", "密封", "干燥"] },
  // 用法 / 注意
  { code: "high-alert", label: "高警示药品", short: "高警示", group: "use", tone: "red", aliases: ["高警示", "高危药品", "高警讯"] },
  { code: "no-split", label: "缓控释·不可掰开嚼碎", short: "不可掰", group: "use", set: "split", tone: "amber", aliases: ["不可掰开", "不能掰", "整片吞服", "不可嚼碎"] },
  { code: "splittable", label: "可掰开", short: "可掰开", group: "use", set: "split", tone: "slate", aliases: ["可掰", "可以掰开", "有刻痕"] },
  { code: "prn", label: "必要时服用", short: "必要时", group: "use", tone: "sky", aliases: ["必要时", "按需", "prn", "需要时"] },
  { code: "course", label: "短期疗程", short: "疗程", group: "use", tone: "slate", aliases: ["疗程", "短期", "短期用药"] },
  { code: "external", label: "外用", short: "外用", group: "use", tone: "slate", aliases: ["外用药", "外用"] },
  { code: "injection", label: "注射剂", short: "注射", group: "use", tone: "slate", aliases: ["注射", "针剂", "打针"] },
];

const BY_CODE = new Map(TAGS.map((t) => [t.code, t]));
const keyOf = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s·・()（）]/g, "");
const BY_NAME = new Map<string, string>();
for (const t of TAGS) for (const n of [t.code, t.label, t.short, ...t.aliases]) if (!BY_NAME.has(keyOf(n))) BY_NAME.set(keyOf(n), t.code);

export const tagDef = (code: string): TagDef | undefined => BY_CODE.get(code);

/** What to store for a typed tag: the catalog code when it names one, else the trimmed text; null when empty. */
export function resolveTag(input: string): string | null {
  const text = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return BY_NAME.get(keyOf(text)) ?? text.slice(0, 20);
}

/** Badge text and full name for a stored tag. */
export function tagLabel(tag: string): { short: string; label: string; tone: TagTone; custom: boolean } {
  const d = BY_CODE.get(tag);
  return d ? { short: d.short, label: d.label, tone: d.tone, custom: false } : { short: tag, label: tag, tone: "slate", custom: true };
}

/** Adds a tag, dropping the ones it excludes; toggling a tag already there removes it. */
export function toggleTag(tags: readonly string[], tag: string): string[] {
  if (tags.includes(tag)) return tags.filter((t) => t !== tag);
  const set = BY_CODE.get(tag)?.set;
  return sortTags([...tags.filter((t) => !set || BY_CODE.get(t)?.set !== set), tag]);
}

const ORDER = new Map(TAGS.map((t, i) => [t.code, i]));

/** Catalog order (control first), then the user's own tags as entered; no duplicates. */
export function sortTags(tags: readonly string[]): string[] {
  const unique = [...new Set(tags)];
  return [...unique.filter((t) => ORDER.has(t)).sort((a, b) => ORDER.get(a)! - ORDER.get(b)!), ...unique.filter((t) => !ORDER.has(t))];
}

/** Clean a stored or submitted list: resolved, unique, exclusive sets respected (the last wins), sorted. */
export function normalizeTags(tags: readonly string[]): string[] {
  let out: string[] = [];
  for (const raw of tags) {
    const t = resolveTag(raw);
    if (t && !out.includes(t)) out = toggleTag(out, t);
  }
  return out;
}

/** Words a search should find a medication by: every tag's names. */
export const tagSearchWords = (tags: readonly string[]) =>
  tags.flatMap((t) => {
    const d = BY_CODE.get(t);
    return d ? [d.label, d.short, ...d.aliases] : [t];
  });

/** Tags that need a special prescription (麻醉 / 精一 / 精二). */
export const isSpecialRx = (tags: readonly string[]) => tags.some((t) => t === "narcotic" || t === "psy1" || t === "psy2");
