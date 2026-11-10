import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TAGS } from "../tags";
import { catalogDetail, searchCatalog, type CatalogData } from "./search";

const fixture: CatalogData = {
  version: 1,
  source: { title: "t", maintainedAt: "2026-04-10", url: "u" },
  names: ["氯硝西泮片", "氯氮平片", "硝苯地平片"],
  nameKeys: ["lvxiaoxipanpian lxxpp", "lvdanpingpian ldpp", "xiaobendipingpian xbdpp"],
  companies: ["江苏恩华药业股份有限公司", "上海上药信谊药厂有限公司", "AstraZeneca AB"],
  companyShort: ["江苏恩华药业", "上海上药信谊药厂", "AstraZeneca AB"],
  companyKeys: ["jiangsuenhuayaoye jsehyy", "shanghaishangyaoxinyiyaochang shsyxyyc", ""],
  brands: ["静康"],
  brandKeys: ["jingkang jk"],
  strengths: ["2mg", "0.5mg", "25mg", "10mg"],
  forms: ["片剂"],
  materials: ["铝塑"],
  notes: ["限二级及以上医疗机构。"],
  units: ["片", "盒", "瓶"],
  tagSets: [["psy2", "rx", "ins-a", "domestic"], ["psy2", "rx", "domestic"], ["ins-b", "imported"]],
  drugs: [
    [0, 0, 0, [[1, -1, "国药准字H31022079", 1, 0, -1, 30, 0, 1, 0], [0, 0, "国药准字H10930144", 0, 1, 0, 100, 0, 2, -1, 20, 0, 1, 0]]],
    [0, 1, 0, [[0, -1, "国药准字H32020592", 1, 0, -1, 100, 0, 2, -1]]],
    [1, 2, 0, [[1, -1, "国药准字H31020001", 2, 2, -1, 100, 0, 2, -1]]],
    [2, 3, 0, [[2, -1, "H20140971", 2, 2, -1, 7, 0, 1, -1]]],
  ],
};

const names = (q: string) => searchCatalog(fixture, q).groups.map((g) => `${g.name} ${g.strength}`);

describe("searchCatalog", () => {
  it("finds by part of the name, pinyin and initials", () => {
    expect(names("氯硝西泮")).toEqual(["氯硝西泮片 2mg", "氯硝西泮片 0.5mg"]);
    expect(names("lvxiao")).toHaveLength(2);
    expect(names("lxxp")).toHaveLength(2);
  });
  it("needs every term, each from any field", () => {
    expect(names("氯硝 2mg")).toEqual(["氯硝西泮片 2mg"]);
    expect(names("氯硝 信谊")).toEqual(["氯硝西泮片 2mg"]);
    expect(names("氯硝 不存在")).toEqual([]);
  });
  it("finds by manufacturer, brand and approval number", () => {
    expect(names("恩华")).toEqual(["氯硝西泮片 2mg", "氯硝西泮片 0.5mg"]);
    expect(names("静康")).toEqual(["氯硝西泮片 2mg"]);
    expect(names("H31022079")).toEqual(["氯硝西泮片 2mg"]);
    expect(names("astrazeneca")).toEqual(["硝苯地平片 10mg"]);
  });
  it("ignores case, width and spaces around terms", () => {
    expect(names(" ＬＸＸＰ ")).toHaveLength(2);
    expect(names("h31022079")).toHaveLength(1);
  });
  it("puts a name match above a manufacturer match", () => {
    expect(names("硝")[0]).toBe("硝苯地平片 10mg");
  });
  it("reports the total beyond the limit", () => {
    const r = searchCatalog(fixture, "片", 2);
    expect(r.total).toBe(4);
    expect(r.groups).toHaveLength(2);
  });
  it("returns nothing for an empty query", () => {
    expect(searchCatalog(fixture, "   ")).toEqual({ total: 0, groups: [] });
  });
  it("counts manufacturers and keeps only tags they all share", () => {
    const g = searchCatalog(fixture, "氯硝 2mg").groups[0];
    expect(g.companies).toBe(2);
    expect(g.tags).toEqual(["psy2", "rx", "domestic"]);
  });
  it("lists the manufacturer the query named first", () => {
    expect(searchCatalog(fixture, "氯硝 2mg 恩华").groups[0].examples[0]).toBe("江苏恩华药业");
  });
});

describe("catalogDetail", () => {
  it("expands manufacturers and packs, smallest pack first", () => {
    const d = catalogDetail(fixture, 0)!;
    expect(d.variants.map((v) => v.companyShort)).toEqual(["上海上药信谊药厂", "江苏恩华药业"]);
    const enhua = d.variants[1];
    expect(enhua).toMatchObject({ brand: "静康", insurance: null, note: "限二级及以上医疗机构。", tags: ["psy2", "rx", "domestic"] });
    expect(enhua.packs).toEqual([
      { perBox: 20, unit: "片", packUnit: "盒", material: "铝塑" },
      { perBox: 100, unit: "片", packUnit: "瓶", material: null },
    ]);
  });
  it("puts the manufacturer the query named first, even off the insurance list", () => {
    expect(catalogDetail(fixture, 0, "恩华")!.variants[0].companyShort).toBe("江苏恩华药业");
  });
  it("is null for an unknown id", () => {
    expect(catalogDetail(fixture, 99)).toBeNull();
  });
});

describe("the bundled catalog", () => {
  const data = JSON.parse(gunzipSync(readFileSync(path.join(process.cwd(), "data", "drug-catalog.json.gz"))).toString("utf8")) as CatalogData;

  it("is complete", () => {
    expect(data.names.length).toBeGreaterThan(15_000);
    expect(data.companies.length).toBeGreaterThan(5_000);
    expect(data.drugs.length).toBeGreaterThan(50_000);
  });
  it("uses only tags the app knows", () => {
    const known = new Set(TAGS.map((t) => t.code));
    for (const code of data.tagSets.flat()) expect(known.has(code), code).toBe(true);
  });
  it("finds a real drug with its class and manufacturer", () => {
    const { groups } = searchCatalog(data, "氯硝西泮片 2mg");
    expect(groups[0]).toMatchObject({ name: "氯硝西泮片", strength: "2mg" });
    expect(groups[0].tags).toEqual(expect.arrayContaining(["psy2", "rx"]));
    const d = catalogDetail(data, groups[0].id)!;
    expect(d.variants.some((v) => v.companyShort === "上海上药信谊药厂" && v.approval === "国药准字H31022079")).toBe(true);
  });
  it("keeps pack sizes numeric", () => {
    const d = catalogDetail(data, searchCatalog(data, "阿莫西林胶囊 0.25g").groups[0].id)!;
    expect(d.variants.flatMap((v) => v.packs).every((p) => Number.isFinite(p.perBox) && p.unit.length > 0)).toBe(true);
  });
});
