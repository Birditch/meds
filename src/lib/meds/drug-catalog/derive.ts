/**
 * Turns a row of 国家医保局's 《医保药品分类与代码数据库》 into what the app stores: a usable strength,
 * a short manufacturer name, and the tags the row's own fields establish.
 *
 * Only used by scripts/drug-catalog/build.ts and the tests. No imports, so Node runs it directly.
 */

export interface SourceRow {
  /** 药品代码: X… 西药 (ATC-like class after the X), Z… 中成药. */
  code: string;
  name: string;
  /** 规格 and 注册规格. */
  spec: string;
  registeredSpec: string;
  form: string;
  /** 批准文号. */
  approval: string;
  /** 甲乙类: 甲 / 乙 / 商保, or empty when not in the national list. */
  insurance: string;
  /** 目录编号: T… marks the negotiated section. */
  insuranceNo: string;
}

const BLANK = new Set(["", "无", "/", "-", "--", "---", "——"]);

function tidyStrength(raw: string): string {
  return (
    raw
      .normalize("NFKC")
      .replace(/\s+/g, "")
      // A cell that overflowed in the PDF lost its start: "计)2mg".
      .replace(/^[^()]*\)(?=.)/, "")
      // The basis of the content: "0.1g(按C21H25N3O2S计)", "按C21H25N3O2S计0.1g".
      .replace(/\(按[^()]*(?:\([^()]*\)[^()]*)*计\)/g, "")
      .replace(/^按[^计]*计(?=.)/, "")
      .replace(/(?<=.)按[^()]*计$/, "")
      .replace(/∶/g, ":")
      .replace(/^每(?:片|粒|支|袋|瓶|丸|贴)(?:装|含)?(?=.)/, "")
      .replace(/毫克/g, "mg")
      .replace(/微克/g, "μg")
      .replace(/毫升/g, "ml")
      .replace(/(\d)克/g, "$1g")
  );
}

/** A long cell that the PDF clipped: it stops mid-phrase or leaves a bracket open. */
const looksCut = (s: string) => /[与和及,、(:按]$/.test(s) || s.split("(").length !== s.split(")").length;

/** The 规格 column is the actual product; 注册规格 can list several, but is cleaner when a cell overflowed. */
export function cleanStrength(spec: string, registeredSpec: string): string {
  const actual = tidyStrength(spec);
  const registered = tidyStrength(registeredSpec);
  const single = !BLANK.has(registered) && registered !== "复方" && !/^(?:\(1\)|1\.|①)/.test(registered);
  // The text of the row above ran into this cell: "咖啡因:65mg盐酸羟考酮5mg…".
  if (single && !looksCut(registered) && (looksCut(actual) || (actual.length > registered.length && actual.endsWith(registered)))) return registered;
  if (!BLANK.has(actual) && actual !== "复方") return actual;
  if (single) return registered;
  return actual === "复方" ? "复方" : "";
}

/** "江苏恩华药业股份有限公司" → "江苏恩华药业". Foreign names stay as they are. */
export function shortCompany(name: string): string {
  const short = name.normalize("NFKC").replace(/(?:集团)?(?:股份)?(?:有限责任|有限)公司$/, "").replace(/(?:股份)?公司$/, "");
  return short || name;
}

/**
 * 《药用类麻醉药品目录（2025年版）》 and 《药用类精神药品目录（2025年版）》 (NMPA 2025 No. 55), as the
 * registered names they cover in the database. Whole names on purpose: the lists cover "salts and
 * single-ingredient preparations unless stated otherwise", so a word match would wrongly catch
 * 阿扑吗啡, 罂粟碱, 氯氮平 and compounds that merely contain a listed ingredient. 依托咪酯 is absent
 * because its entry excludes every preparation approved in China.
 */
const CONTROLLED: Record<"narcotic" | "psy1" | "psy2", readonly string[]> = {
  narcotic: [
    "盐酸阿芬太尼注射液",
    "盐酸布桂嗪注射液",
    "盐酸布桂嗪片",
    "磷酸可待因注射液",
    "磷酸可待因片",
    "磷酸可待因糖浆",
    "磷酸可待因缓释片",
    "酒石酸双氢可待因片",
    "枸橼酸舒芬太尼注射液",
    "枸橼酸芬太尼注射液",
    "注射用盐酸瑞芬太尼",
    "芬太尼透皮贴剂",
    "盐酸氢吗啡酮注射液",
    "盐酸氢吗啡酮缓释片",
    "盐酸美沙酮口服溶液",
    "盐酸美沙酮片",
    "盐酸吗啡注射液",
    "盐酸吗啡片",
    "盐酸吗啡缓释片",
    "硫酸吗啡口服溶液",
    "硫酸吗啡栓",
    "硫酸吗啡注射液",
    "硫酸吗啡片",
    "硫酸吗啡缓释片",
    "富马酸奥赛利定注射液",
    "阿片片",
    "阿片酊",
    "复方樟脑酊",
    "阿桔片",
    "盐酸羟考酮注射液",
    "盐酸羟考酮片",
    "盐酸羟考酮缓释片",
    "盐酸羟考酮胶囊",
    "盐酸哌替啶注射液",
    "盐酸哌替啶片",
    "福尔可定片",
    "富马酸泰吉利定注射液",
    "盐酸替利定口服溶液",
    "盐酸替利定片",
    "盐酸二氢埃托啡舌下片",
  ],
  psy1: [
    "盐酸丁丙诺啡注射液",
    "盐酸丁丙诺啡舌下片",
    "羟丁酸钠注射液",
    "盐酸氯胺酮注射液",
    "盐酸艾司氯胺酮注射液",
    "盐酸艾司氯胺酮鼻喷雾剂",
    "注射用盐酸哌甲酯",
    "盐酸右哌甲酯缓释胶囊",
    "盐酸哌甲酯片",
    "盐酸哌甲酯缓释咀嚼片",
    "盐酸哌甲酯缓释干混悬剂",
    "盐酸哌甲酯缓释片",
    "盐酸哌甲酯缓释胶囊",
    "咪达唑仑注射液",
    "司可巴比妥钠胶囊",
    "盐酸他喷他多片",
    "三唑仑片",
  ],
  psy2: [
    "丁丙诺啡透皮贴剂",
    "咪达唑仑口服溶液",
    "咪达唑仑口颊粘膜溶液",
    "盐酸咪达唑仑口服溶液",
    "马来酸咪达唑仑片",
    "阿普唑仑片",
    "阿普唑仑胶囊",
    "注射用异戊巴比妥钠",
    "注射用苯巴比妥钠",
    "苯巴比妥片",
    "苯巴比妥钠注射液",
    "酒石酸布托啡诺注射液",
    "酒石酸布托啡诺鼻喷剂",
    "枸橼酸咖啡因注射液",
    "麦角胺咖啡因片",
    "安钠咖片",
    "氯氮䓬片",
    "氯氮卓片",
    "氯巴占片",
    "氯硝西泮注射液",
    "氯硝西泮片",
    "硝西泮片",
    "氢溴酸右美沙芬分散片",
    "氢溴酸右美沙芬口服液",
    "氢溴酸右美沙芬口服溶液",
    "氢溴酸右美沙芬咀嚼片",
    "氢溴酸右美沙芬注射液",
    "氢溴酸右美沙芬溶液",
    "氢溴酸右美沙芬滴丸",
    "氢溴酸右美沙芬片",
    "氢溴酸右美沙芬糖浆",
    "氢溴酸右美沙芬胶囊",
    "氢溴酸右美沙芬软胶囊",
    "氢溴酸右美沙芬颗粒",
    "注射用氢溴酸右美沙芬",
    "右美沙芬缓释混悬液",
    "地佐辛注射液",
    "地达西尼胶囊",
    "氢溴酸依他佐辛注射液",
    "地西泮注射液",
    "地西泮片",
    "地西泮膜",
    "地西泮鼻喷雾剂",
    "艾司唑仑注射液",
    "艾司唑仑片",
    "劳拉西泮片",
    "莫达非尼胶囊",
    "盐酸纳布啡注射液",
    "盐酸纳呋拉啡口崩片",
    "奥沙西泮片",
    "喷他佐辛注射液",
    "吡仑帕奈口服混悬液",
    "吡仑帕奈片",
    "注射用甲苯磺酸瑞马唑仑",
    "注射用苯磺酸瑞马唑仑",
    // 曲马多: the entry includes its compounds.
    "复方曲马多片",
    "氨酚曲马多片",
    "氨酚曲马多胶囊",
    "注射用盐酸曲马多",
    "盐酸曲马多分散片",
    "盐酸曲马多栓",
    "盐酸曲马多氯化钠注射液",
    "盐酸曲马多泡腾颗粒",
    "盐酸曲马多注射液",
    "盐酸曲马多片",
    "盐酸曲马多缓释片",
    "盐酸曲马多缓释片(III)",
    "盐酸曲马多缓释片(Ⅱ)",
    "盐酸曲马多缓释胶囊",
    "盐酸曲马多胶囊",
    "盐酸曲马多葡萄糖注射液",
    "扎来普隆分散片",
    "扎来普隆口腔崩解片",
    "扎来普隆片",
    "扎来普隆胶囊",
    "酒石酸唑吡坦分散片",
    "酒石酸唑吡坦口腔崩解片",
    "酒石酸唑吡坦片",
    "佐匹克隆片",
    "佐匹克隆胶囊",
    "右佐匹克隆片",
    "单盐酸氟西泮胶囊",
    // 含可待因复方口服液体制剂.
    "可待因异丙嗪糖浆",
    "复方可待因口服溶液",
    "复方磷酸可待因口服溶液",
    "复方磷酸可待因溶液",
    "复方磷酸可待因溶液(Ⅱ)",
    "复方地芬诺酯片",
    // 羟考酮 / 氢可酮 compounds of at most 5mg base a tablet; every registered strength is 5mg of the salt.
    "氨酚羟考酮片",
    "氨酚氢可酮片",
  ],
};

const CONTROL_BY_NAME = new Map(Object.entries(CONTROLLED).flatMap(([tag, names]) => names.map((n) => [n, tag] as const)));

function controlTag(name: string, strength: string): string | undefined {
  // The list draws the line at 5mg of oxycodone base; 10mg of the hydrochloride is already above it.
  if (name === "羟考酮纳洛酮缓释片") return /羟考酮5mg/.test(strength) ? "psy2" : "psy1";
  return CONTROL_BY_NAME.get(name);
}

/** Imported or domestic, from the format of the approval number; undefined when it fits neither. */
function originTag(approval: string): string | undefined {
  const a = approval.normalize("NFKC").toUpperCase();
  // HJ/SJ/ZJ 境外生产, J 进口分包装, HC/ZC/SC 港澳台, a bare H/S/Z number is an older import licence.
  if (/^(?:国药准字)?(?:[HSZ]J|J|[HSZ]C)/.test(a) || /^[HSZ]\d{8}/.test(a)) return "imported";
  if (/^国药准字[HSZBC]\d{8}/.test(a)) return "domestic";
  return undefined;
}

/**
 * The catalog tags this row establishes. Absent is "not known" rather than "no": the database has no
 * Rx / OTC column, so 处方药 is only implied for 麻醉 / 精神 drugs, which always need a prescription.
 */
export function deriveTags(row: SourceRow, strength: string): string[] {
  const tags: string[] = [];
  const control = controlTag(row.name, strength);
  if (control) tags.push(control, "rx");
  if (row.insurance === "甲") tags.push("ins-a");
  else if (row.insurance === "乙") tags.push("ins-b");
  // TX / TZ 谈判, TJ 竞价: both sit in the negotiated section of the list. TS is the commercial list.
  if (/^T[XZJ]/.test(row.insuranceNo)) tags.push("negotiated");
  const origin = originTag(row.approval);
  if (origin) tags.push(origin);
  if (row.code.startsWith("Z")) tags.push("tcm");
  else if (/^(?:国药准字)?S/.test(row.approval.normalize("NFKC").toUpperCase())) tags.push("biologic");
  // 《抗菌药物临床应用管理办法》 covers bacteria and fungi, not tuberculosis (J04) or viruses (J05).
  if (/^XJ0[12]/.test(row.code)) tags.push("abx");
  if (/注射|针剂|粉针/.test(`${row.form}${row.name}`)) tags.push("injection");
  else if (/乳膏|软膏|凝胶|搽剂|洗剂|涂剂|贴膏|橡胶膏|贴剂/.test(row.form) && !/眼|鼻|耳|口腔|阴道|直肠/.test(`${row.form}${row.name}`)) tags.push("external");
  return tags;
}
