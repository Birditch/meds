// Packs the rows from extract-nhsa-pdf.swift into data/drug-catalog.json.gz (see the README).
//
// Usage: node scripts/drug-catalog/build.mjs <rows.jsonl> <YYYY-MM-DD the PDF was maintained to>
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { constants, gzipSync } from "node:zlib";
import { pinyin } from "pinyin-pro";
import { cleanStrength, deriveTags, shortCompany } from "../../src/lib/meds/drug-catalog/derive.ts";

const [rowsPath, maintainedAt] = process.argv.slice(2);
if (!rowsPath || !/^\d{4}-\d{2}-\d{2}$/.test(maintainedAt ?? "")) {
  console.error("usage: build.mjs <rows.jsonl> <YYYY-MM-DD>");
  process.exit(2);
}

class Table {
  list = [];
  ids = new Map();
  id(value) {
    let id = this.ids.get(value);
    if (id === undefined) {
      id = this.list.length;
      this.list.push(value);
      this.ids.set(value, id);
    }
    return id;
  }
}

const names = new Table();
const companies = new Table();
const brands = new Table();
const strengths = new Table();
const forms = new Table();
const materials = new Table();
const notes = new Table();
const units = new Table();
const tagSets = new Table();
const groups = new Map();

const INSURANCE = { 甲: 1, 乙: 2, 商保: 3 };
const none = (s) => !s || s === "无" || s === "/" || s === "-";
let rowCount = 0;

for await (const line of createInterface({ input: createReadStream(rowsPath, "utf8"), crlfDelay: Infinity })) {
  if (!line) continue;
  const c = JSON.parse(line);
  if (c.length !== 19) throw new Error(`expected 19 cells: ${line.slice(0, 120)}`);
  rowCount += 1;
  const [code, name, , registeredSpec, brand, form, spec, material, factor, minUnit, packUnit, company, approval, , insurance, insuranceNo, , , remark] = c;

  const strength = cleanStrength(spec, registeredSpec);
  const key = `${name}\0${strength}`;
  let group = groups.get(key);
  if (!group) {
    group = { name: names.id(name), strength: strengths.id(strength), forms: new Map(), variants: new Map() };
    groups.set(key, group);
  }
  group.forms.set(form, (group.forms.get(form) ?? 0) + 1);

  const variantKey = `${company}\0${brand}\0${approval}`;
  let variant = group.variants.get(variantKey);
  if (!variant) {
    const tags = deriveTags({ code, name, spec, registeredSpec, form, approval, insurance, insuranceNo }, strength);
    const note = remark.replace(/^◇/, "");
    variant = {
      head: [companies.id(company), none(brand) ? -1 : brands.id(brand), approval, INSURANCE[insurance] ?? 0, tagSets.id(tags.join(",")), note ? notes.id(note) : -1],
      packs: new Map(),
    };
    group.variants.set(variantKey, variant);
  }
  const packKey = `${factor}|${minUnit}|${packUnit}`;
  if (!variant.packs.has(packKey)) variant.packs.set(packKey, [Number(factor) || 0, units.id(minUnit), units.id(packUnit), none(material) ? -1 : materials.id(material)]);
}

/** Full pinyin and initials, as src/lib/meds/pinyin.ts builds them; empty when there is no Chinese. */
function keys(text) {
  if (!/[㐀-鿿]/.test(text)) return "";
  const full = pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive" }).join("");
  const initials = pinyin(text, { pattern: "first", toneType: "none", type: "array", nonZh: "consecutive" }).join("");
  return `${full} ${initials}`.toLowerCase();
}

const mostCommon = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
const drugs = [...groups.values()]
  .sort((a, b) => a.name - b.name || a.strength - b.strength)
  .map((g) => [g.name, g.strength, forms.id(mostCommon(g.forms)), [...g.variants.values()].map((v) => [...v.head, ...[...v.packs.values()].flat()])]);

const catalog = {
  version: 1,
  source: { title: "国家医保局《医保药品分类与代码数据库》", maintainedAt, url: "https://code.nhsa.gov.cn" },
  names: names.list,
  nameKeys: names.list.map(keys),
  companies: companies.list,
  companyShort: companies.list.map(shortCompany),
  companyKeys: companies.list.map((c) => keys(shortCompany(c))),
  brands: brands.list,
  brandKeys: brands.list.map(keys),
  strengths: strengths.list,
  forms: forms.list,
  materials: materials.list,
  notes: notes.list,
  units: units.list,
  tagSets: tagSets.list.map((t) => (t ? t.split(",") : [])),
  drugs,
};

const json = JSON.stringify(catalog);
const gz = gzipSync(json, { level: constants.Z_BEST_COMPRESSION });
writeFileSync(new URL("../../data/drug-catalog.json.gz", import.meta.url), gz);
console.log({
  rows: rowCount,
  names: names.list.length,
  drugs: drugs.length,
  variants: drugs.reduce((n, d) => n + d[3].length, 0),
  companies: companies.list.length,
  brands: brands.list.length,
  tagSets: tagSets.list.length,
  jsonMB: +(json.length / 1e6).toFixed(1),
  gzMB: +(gz.length / 1e6).toFixed(2),
});
