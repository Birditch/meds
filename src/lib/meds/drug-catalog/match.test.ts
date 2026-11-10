import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { editDistance, matchDrug } from "./match";
import { proposeTags } from "./propose";
import type { CatalogData } from "./search";

const fixture: CatalogData = {
  version: 1,
  source: { title: "t", maintainedAt: "2026-04-10", url: "u" },
  names: ["氯硝西泮片", "左氧氟沙星片", "左氧氟沙星注射液", "盐酸普萘洛尔缓释片", "富马酸喹硫平片"],
  nameKeys: ["", "", "", "", ""],
  companies: ["江苏恩华药业股份有限公司", "江苏恩华赛德药业有限责任公司", "湖南洞庭药业股份有限公司", "AstraZeneca UK Limited"],
  companyShort: ["江苏恩华药业", "江苏恩华赛德药业", "湖南洞庭药业", "AstraZeneca UK Limited"],
  companyKeys: ["", "", "", ""],
  brands: ["静康", "可乐必妥", "思瑞康"],
  brandKeys: ["", "", ""],
  strengths: ["2mg", "0.5mg", "0.5g", "100ml:0.5g", "40mg", "0.2g", "0.2g(按C21H25N3O2S计)"],
  forms: ["片剂", "注射液"],
  materials: [],
  notes: [],
  units: ["片", "盒", "瓶"],
  tagSets: [["psy2", "rx", "ins-a", "domestic"], ["ins-a", "domestic", "abx"], ["ins-b", "domestic", "abx", "injection"], ["ins-b", "domestic"], ["ins-a", "imported"]],
  drugs: [
    [0, 0, 0, [[0, 0, "国药准字H1", 1, 0, -1, 20, 0, 1, -1, 100, 0, 2, -1], [2, -1, "国药准字H2", 1, 0, -1, 14, 0, 1, -1]]],
    [0, 1, 0, [[1, -1, "国药准字H3", 1, 0, -1, 100, 0, 2, -1]]],
    [1, 2, 0, [[2, 1, "国药准字H4", 1, 1, -1, 4, 0, 1, -1]]],
    [2, 3, 1, [[2, -1, "国药准字H5", 2, 2, -1, 1, 0, 1, -1]]],
    [3, 4, 0, [[2, -1, "国药准字H6", 2, 3, -1, 24, 0, 1, -1]]],
    [4, 5, 0, [[3, 2, "H20000001", 1, 4, -1, 20, 0, 1, -1]]],
    [4, 6, 0, [[2, -1, "国药准字H7", 1, 3, -1, 30, 0, 1, -1]]],
  ],
};

const match = (name: string, dosage = "", brands: string[] = []) => matchDrug(fixture, { name, dosage, brands });
const hitNames = (m: ReturnType<typeof match>) => m.makers.filter((x) => x.matched).map((x) => x.companyShort);

describe("matchDrug: name", () => {
  it("matches the exact name and strength", () => {
    expect(match("氯硝西泮片", "2mg")).toMatchObject({ status: "matched", suggestedName: null, group: { name: "氯硝西泮片", strength: "2mg" } });
  });
  it("needs a name", () => {
    expect(match("", "2mg").status).toBe("none");
    expect(match("氯", "2mg").status).toBe("none");
    expect(match("不存在的药", "2mg").status).toBe("none");
  });
  it("reads a likely typo as the catalog's name and says so", () => {
    expect(match("氯硝西冸片", "2mg")).toMatchObject({ status: "matched", suggestedName: "氯硝西泮片", nameBasis: "typo", tags: ["psy2", "rx", "ins-a", "domestic"] });
  });
  it("offers the catalog's name when part of it was written", () => {
    expect(match("左氧氟沙星片".slice(0, 5), "0.5g")).toMatchObject({ status: "matched", suggestedName: "左氧氟沙星片", nameBasis: "partial" });
  });
  it("accepts a salt the catalog leaves out, and ignores a bracketed note", () => {
    expect(match("盐酸左氧氟沙星片", "0.5g").group?.name).toBe("左氧氟沙星片");
    expect(match("氯硝西泮片（早上吃）", "2mg")).toMatchObject({ status: "matched", suggestedName: null });
  });
});

describe("matchDrug: strength", () => {
  it("compares across units", () => {
    expect(match("富马酸喹硫平片", "200mg").group?.strength).toBe("0.2g");
    expect(match("左氧氟沙星片", "500mg").group?.strength).toBe("0.5g");
  });
  it("accepts a number without a unit", () => {
    expect(match("盐酸普萘洛尔缓释片", "40").group?.strength).toBe("40mg");
  });
  it("treats the content basis as the same strength and merges the entries", () => {
    const m = match("富马酸喹硫平片", "0.2g");
    expect(m.status).toBe("matched");
    expect(m.makers.map((x) => x.companyShort).sort()).toEqual(["AstraZeneca UK Limited", "湖南洞庭药业"].sort());
  });
  it("is unsure when a strength is missing or unknown, and keeps only what all share", () => {
    for (const dosage of ["", "99mg"]) {
      const m = match("氯硝西泮片", dosage);
      expect(m.status).toBe("ambiguous");
      expect(m.group).toBeNull();
      expect(m.candidates.map((c) => c.strength).sort()).toEqual(["0.5mg", "2mg"]);
      expect(m.tags).toEqual(["psy2", "rx", "ins-a", "domestic"]);
    }
  });
  it("lists every strength of the drug, smallest first", () => {
    expect(match("氯硝西泮片", "2mg").strengths).toEqual(["0.5mg", "2mg"]);
  });
  it("does not call a different product of a partial name the same", () => {
    const m = match("左氧氟沙星");
    expect(m.status).toBe("ambiguous");
    expect(m.tags).toEqual(["domestic", "abx"]);
  });
});

describe("matchDrug: manufacturer", () => {
  it("knows a manufacturer by a short name or brand", () => {
    expect(hitNames(match("氯硝西泮片", "2mg", ["湖南洞庭"]))).toEqual(["湖南洞庭药业"]);
    expect(hitNames(match("氯硝西泮片", "2mg", ["静康"]))).toEqual(["江苏恩华药业"]);
    expect(hitNames(match("氯硝西泮片", "2mg", ["江苏恩华药业（静康）"]))).toEqual(["江苏恩华药业"]);
  });
  it("uses the typed manufacturer's tags, where they differ", () => {
    expect(match("富马酸喹硫平片", "0.2g", ["思瑞康"]).tags).toEqual(["ins-a", "imported"]);
    expect(match("富马酸喹硫平片", "0.2g").tags).toEqual([]);
  });
  it("lists the typed manufacturer first and still offers the others", () => {
    const m = match("氯硝西泮片", "2mg", ["湖南洞庭"]);
    expect(m.makers.map((x) => [x.companyShort, x.matched])).toEqual([["湖南洞庭药业", true], ["江苏恩华药业", false]]);
  });
  it("still matches the drug when the manufacturer is unknown", () => {
    expect(match("氯硝西泮片", "2mg", ["没听说过"])).toMatchObject({ status: "matched", tags: ["psy2", "rx", "ins-a", "domestic"] });
  });
  it("lets a brand settle which product a partial name means", () => {
    expect(match("左氧氟沙星", "", ["可乐必妥"]).candidates.map((c) => c.name)).toEqual(["左氧氟沙星片"]);
  });
});

describe("editDistance", () => {
  it("counts changes and gives up past the limit", () => {
    expect(editDistance("劳拉西冸片", "劳拉西泮片", 1)).toBe(1);
    expect(editDistance("abc", "abc", 1)).toBe(0);
    expect(editDistance("abcd", "abef", 1)).toBe(2);
    expect(editDistance("a", "abcd", 1)).toBe(2);
  });
});

describe("proposeTags", () => {
  it("separates additions from changes", () => {
    const p = proposeTags(["rx", "ins-b", "饭后服"], ["rx", "ins-a", "domestic"]);
    expect(p.additions).toEqual(["domestic"]);
    expect(p.conflicts).toEqual([{ from: "ins-b", to: "ins-a" }]);
    expect(p.safeNext).toEqual(expect.arrayContaining(["rx", "ins-b", "饭后服", "domestic"]));
    expect(p.next).toEqual(expect.arrayContaining(["rx", "ins-a", "饭后服", "domestic"]));
    expect(p.next).not.toContain("ins-b");
  });
  it("does not trade a specific antibacterial grade for the plain tag", () => {
    expect(proposeTags(["abx-restricted"], ["abx"])).toMatchObject({ additions: [], conflicts: [], next: ["abx-restricted"] });
  });
  it("has nothing to say when the tags agree", () => {
    expect(proposeTags(["ins-a", "rx"], ["rx"])).toMatchObject({ additions: [], conflicts: [] });
  });
});

describe("matching against the bundled catalog", () => {
  const data = JSON.parse(gunzipSync(readFileSync(path.join(process.cwd(), "data", "drug-catalog.json.gz"))).toString("utf8")) as CatalogData;

  it.each([
    ["劳拉西冸片", "0.5mg", ["罗拉"], "劳拉西泮片", "0.5mg"],
    ["左氧氟沙星", "0.5g", ["可乐必妥"], "左氧氟沙星片", "0.5g"],
    ["富马酸喹硫平片", "200mg", ["思瑞康"], "富马酸喹硫平片", "0.2g"],
    ["盐酸普萘洛尔缓释片", "40", [], "盐酸普萘洛尔缓释片", "40mg"],
    ["碳酸锂缓释片", "0.3g", ["恩华"], "碳酸锂缓释片", "0.3g"],
  ])("%s %s", (name, dosage, brands, catalogName, strength) => {
    expect(matchDrug(data, { name, dosage, brands })).toMatchObject({ status: "matched", group: { name: catalogName, strength } });
  });
  it("carries the class of a controlled drug through a typo", () => {
    expect(matchDrug(data, { name: "劳拉西冸片", dosage: "0.5mg", brands: ["罗拉"] }).tags).toEqual(expect.arrayContaining(["psy2", "rx"]));
  });
});
