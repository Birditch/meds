import { describe, expect, it } from "vitest";
import { TAGS, isSpecialRx, normalizeTags, resolveTag, tagLabel, toggleTag } from "./tags";

describe("tags", () => {
  it("has unique codes and names", () => {
    expect(new Set(TAGS.map((t) => t.code)).size).toBe(TAGS.length);
    expect(new Set(TAGS.map((t) => t.label)).size).toBe(TAGS.length);
  });
  it("resolves typed names and aliases to codes", () => {
    expect(resolveTag("精二")).toBe("psy2");
    expect(resolveTag(" 第二类精神药品 ")).toBe("psy2");
    expect(resolveTag("OTC")).toBe("otc");
    expect(resolveTag("非处方药")).toBe("otc");
    expect(resolveTag("麻醉药品")).toBe("narcotic");
    expect(resolveTag("抗生素")).toBe("abx");
    expect(resolveTag("饭后服")).toBe("饭后服");
    expect(resolveTag("  ")).toBeNull();
  });
  it("keeps exclusive tags exclusive", () => {
    expect(toggleTag(["psy1", "rx"], "psy2")).toEqual(["psy2", "rx"]);
    expect(toggleTag(["rx"], "otc-b")).toEqual(["otc-b"]);
    expect(toggleTag(["psy2", "rx"], "psy2")).toEqual(["rx"]);
    expect(normalizeTags(["处方药", "精二", "冷藏", "非处方", "自定义", "精二"])).toEqual(["psy2", "otc", "cold", "自定义"]);
  });
  it("labels catalog and own tags", () => {
    expect(tagLabel("psy2")).toMatchObject({ short: "精二", label: "第二类精神药品", custom: false });
    expect(tagLabel("饭后服")).toMatchObject({ short: "饭后服", custom: true });
    expect(isSpecialRx(["rx", "psy2"])).toBe(true);
    expect(isSpecialRx(["rx"])).toBe(false);
  });
});
