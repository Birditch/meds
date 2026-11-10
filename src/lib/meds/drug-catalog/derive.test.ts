import { describe, expect, it } from "vitest";
import { TAGS } from "../tags";
import { cleanStrength, deriveTags, shortCompany, type SourceRow } from "./derive";

const row = (over: Partial<SourceRow>): SourceRow => ({
  code: "XN03AEL188A001010101359",
  name: "氯硝西泮片",
  spec: "2mg",
  registeredSpec: "2mg",
  form: "片剂",
  approval: "国药准字H31022079",
  insurance: "",
  insuranceNo: "",
  ...over,
});
const tags = (over: Partial<SourceRow>) => deriveTags(row(over), cleanStrength(row(over).spec, row(over).registeredSpec));

describe("cleanStrength", () => {
  it("drops the content basis", () => {
    expect(cleanStrength("0.1g(按C21H25N3O2S计)", "0.1g")).toBe("0.1g");
    expect(cleanStrength("按C21H25N3O2S计0.1g", "0.1g")).toBe("0.1g");
    expect(cleanStrength("0.1g按C21H25N3O2S计", "0.1g")).toBe("0.1g");
  });
  it("converts Chinese units and subscripts", () => {
    expect(cleanStrength("0.25毫克", "0.25mg")).toBe("0.25mg");
    expect(cleanStrength("10ml:1.0mg(按C₁₃H₁₆N₂计)", "x")).toBe("10ml:1.0mg");
  });
  it("repairs cells that overflowed in the PDF", () => {
    expect(cleanStrength("计)2mg", "2mg")).toBe("2mg");
    expect(cleanStrength("咖啡因:65mg盐酸羟考酮5mg和对乙酰氨基酚325mg", "盐酸羟考酮5mg和对乙酰氨基酚325mg")).toBe("盐酸羟考酮5mg和对乙酰氨基酚325mg");
    expect(cleanStrength("0.5g与氯化100ml:左氧氟沙星0.5g与", "100ml:左氧氟沙星0.5g")).toBe("100ml:左氧氟沙星0.5g");
  });
  it("falls back to the registered strength, unless that lists several", () => {
    expect(cleanStrength("/", "0.5mg")).toBe("0.5mg");
    expect(cleanStrength("无", "(1)0.25mg(2)0.5mg")).toBe("");
    expect(cleanStrength("复方", "碘化铵1.5mg,薄荷油4.4mg")).toBe("碘化铵1.5mg,薄荷油4.4mg");
    expect(cleanStrength("复方", "复方")).toBe("复方");
  });
  it("keeps the actual product over a registered list", () => {
    expect(cleanStrength("0.25mg", "(1)0.25mg(2)0.25mg(无糖型)")).toBe("0.25mg");
  });
});

describe("shortCompany", () => {
  it("drops the legal form", () => {
    expect(shortCompany("江苏恩华药业股份有限公司")).toBe("江苏恩华药业");
    expect(shortCompany("四川国瑞药业有限责任公司")).toBe("四川国瑞药业");
    expect(shortCompany("华益制药(广东)有限公司")).toBe("华益制药(广东)");
  });
  it("leaves foreign names alone", () => {
    expect(shortCompany("AstraZeneca UK Limited")).toBe("AstraZeneca UK Limited");
  });
});

describe("deriveTags: 麻醉 / 精神 (2025 list)", () => {
  it("classifies listed drugs, each implying a prescription", () => {
    expect(tags({})).toEqual(expect.arrayContaining(["psy2", "rx"]));
    expect(tags({ name: "盐酸哌甲酯缓释片" })).toContain("psy1");
    expect(tags({ name: "盐酸吗啡片" })).toContain("narcotic");
    expect(tags({ name: "右佐匹克隆片" })).toContain("psy2");
    expect(tags({ name: "氨酚曲马多片" })).toContain("psy2");
  });
  it("splits 咪达唑仑 and 丁丙诺啡 by preparation, as the list does", () => {
    expect(tags({ name: "咪达唑仑注射液" })).toContain("psy1");
    expect(tags({ name: "马来酸咪达唑仑片" })).toContain("psy2");
    expect(tags({ name: "盐酸丁丙诺啡舌下片" })).toContain("psy1");
    expect(tags({ name: "丁丙诺啡透皮贴剂" })).toContain("psy2");
  });
  it("grades oxycodone with naloxone by the oxycodone per tablet", () => {
    const name = "羟考酮纳洛酮缓释片";
    expect(tags({ name, spec: "每片含盐酸羟考酮5mg与盐酸纳洛酮2.5mg", registeredSpec: "每片含盐酸羟考酮5mg与盐酸纳洛酮2.5mg" })).toContain("psy2");
    expect(tags({ name, spec: "每片含盐酸羟考酮10mg与盐酸纳洛酮5mg", registeredSpec: "每片含盐酸羟考酮10mg与盐酸纳洛酮5mg" })).toContain("psy1");
  });
  it.each([
    ["盐酸阿扑吗啡舌下片", "not morphine"],
    ["盐酸罂粟碱片", "not poppy straw"],
    ["氯氮平片", "not 氯氮䓬"],
    ["奥美沙坦酯片", "not methadone"],
    ["依托咪酯注射液", "the entry excludes approved preparations"],
    ["复方地西泮片", "a compound the list does not name"],
    ["氨基比林咖啡因片", "a compound the list does not name"],
    ["复方氢溴酸右美沙芬糖浆", "a compound the list does not name"],
  ])("does not flag %s: %s", (name) => {
    const t = tags({ name });
    expect(t).not.toContain("narcotic");
    expect(t).not.toContain("psy1");
    expect(t).not.toContain("psy2");
    expect(t).not.toContain("rx");
  });
});

describe("deriveTags: other fields", () => {
  it("reads insurance class and the negotiated section", () => {
    expect(tags({ insurance: "甲" })).toContain("ins-a");
    expect(tags({ insurance: "乙", insuranceNo: "TX12" })).toEqual(expect.arrayContaining(["ins-b", "negotiated"]));
    expect(tags({ insurance: "乙", insuranceNo: "TJ3" })).toContain("negotiated");
    expect(tags({ insurance: "商保", insuranceNo: "TS1" })).not.toContain("negotiated");
    expect(tags({ insurance: "乙", insuranceNo: "1187" })).not.toContain("negotiated");
  });
  it.each([
    ["国药准字H31022079", "domestic"],
    ["国药准字Z20050001", "domestic"],
    ["国药准字C20250003", "domestic"],
    ["国药准字H20193181(参照)", "domestic"],
    ["国药准字HJ20180019", "imported"],
    ["国药准字J20171027", "imported"],
    ["国药准字HC20181023", "imported"],
    ["H20140971", "imported"],
    ["HC20150021", "imported"],
  ])("origin of %s is %s", (approval, expected) => {
    expect(tags({ approval })).toContain(expected);
  });
  it("leaves the origin unset for an unknown number format", () => {
    const t = tags({ approval: "批件123" });
    expect(t).not.toContain("domestic");
    expect(t).not.toContain("imported");
  });
  it("tells drug classes apart", () => {
    expect(tags({ name: "板蓝根颗粒", code: "ZA01AAB0001010101234", approval: "国药准字Z11020001" })).toContain("tcm");
    expect(tags({ name: "重组人胰岛素注射液", approval: "国药准字S10980001" })).toContain("biologic");
    expect(tags({ name: "重组人胰岛素注射液", approval: "S20100001" })).toContain("biologic");
  });
  it("marks antibacterials and antifungals, not tuberculosis or antiviral drugs", () => {
    expect(tags({ name: "左氧氟沙星片", code: "XJ01MAZ077A001" })).toContain("abx");
    expect(tags({ name: "氟康唑片", code: "XJ02ACF038A001" })).toContain("abx");
    expect(tags({ name: "异烟肼片", code: "XJ04ACY046A001" })).not.toContain("abx");
    expect(tags({ name: "奥司他韦胶囊", code: "XJ05AHA176E001" })).not.toContain("abx");
  });
  it("reads the route from the form", () => {
    expect(tags({ name: "注射用头孢曲松钠", form: "注射剂" })).toContain("injection");
    expect(tags({ name: "莫匹罗星软膏", form: "软膏剂" })).toContain("external");
    expect(tags({ name: "红霉素眼膏", form: "眼用软膏" })).not.toContain("external");
  });
  it("never claims 处方药 or 非处方药 without a listed drug", () => {
    const t = tags({ name: "布洛芬片", insurance: "甲" });
    expect(t).not.toContain("rx");
    expect(t.some((x) => x.startsWith("otc"))).toBe(false);
  });
  it("only produces tags the app knows", () => {
    const known = new Set(TAGS.map((t) => t.code));
    const sample = [tags({ insurance: "乙", insuranceNo: "TX1", form: "注射剂", code: "XJ01" }), tags({ code: "Z", approval: "H20140971", form: "软膏剂", name: "x" })];
    for (const code of sample.flat()) expect(known.has(code), code).toBe(true);
  });
});
