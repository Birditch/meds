import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { fmtDate, weekdayCN } from "./dates";
import { COUNT_MOMENT_LABEL, fmtQty, formatRegimen, formatRegimenShort, intakeLabel, packNote } from "./format";
import {
  countLines,
  gapWarning,
  medicationLabel,
  needReason,
  needText,
  packSize,
  prescriptionText,
  purchaseLines,
  type ReportInput,
  type ReportItem,
  type ReserveReport,
  type StockReport,
  type VisitReport,
} from "./reports";
import type { PdfFontFiles } from "./pdf-fonts";
import { dailyTotal } from "./simulate";
import { visitOrdinal, spanText } from "./visits";

/*
 * A4 lists rendered with PDFKit, in Noto Sans SC (SIL OFL 1.1); PDFKit embeds only the glyphs used.
 * next.config.ts keeps pdfkit external, traces the two font files into the build and passes
 * their paths (see ./pdf-fonts.ts).
 */

let fontData: { regular: Buffer; bold: Buffer } | null = null;
function fonts() {
  if (fontData) return fontData;
  const files = JSON.parse(process.env.MEDS_PDF_FONTS ?? "null") as PdfFontFiles | null;
  if (!files) throw new Error("MEDS_PDF_FONTS is not set (next.config.ts provides it)");
  // The two files are traced by next.config.ts; keep Turbopack from tracing the whole project.
  const read = (file: string) => readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), file));
  return (fontData = { regular: read(files.regular), bold: read(files.bold) });
}

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const HEAD_FILL = "#f3f4f6";
const ALERT = "#b91c1c";

const MARGIN = { top: 48, bottom: 54, left: 44, right: 44 };

type Align = "left" | "right" | "center";
interface Cell {
  text: string;
  sub?: string | null;
  bold?: boolean;
  color?: string;
}
interface Column {
  header: string;
  /** Share of the content width. */
  width: number;
  align?: Align;
}

class Writer {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(
    private readonly title: string,
    private readonly generated: string,
  ) {
    const { regular, bold } = fonts();
    this.doc = new PDFDocument({
      size: "A4",
      margins: MARGIN,
      bufferPages: true,
      // A buffer, not a standard font name: PDFKit then never loads Helvetica.
      font: regular as unknown as string,
      lang: "zh-CN",
      displayTitle: true,
      info: { Title: title, Author: "药品余量", Creator: "药品余量" },
    });
    this.doc.registerFont("regular", regular);
    this.doc.registerFont("bold", bold);
    this.doc.on("data", (c: Buffer) => this.chunks.push(c));
    this.done = new Promise((resolve, reject) => {
      this.doc.on("end", () => resolve(Buffer.concat(this.chunks)));
      this.doc.on("error", reject);
    });
  }

  get left() {
    return this.doc.page.margins.left;
  }
  get width() {
    return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right;
  }
  private get bottom() {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  /** Start a new page unless `height` still fits on this one. */
  ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  private style(size: number, bold = false, color = INK) {
    return this.doc.font(bold ? "bold" : "regular").fontSize(size).fillColor(color);
  }

  private measure(text: string, width: number, size: number, bold = false) {
    return this.style(size, bold).heightOfString(text, { width, lineGap: 1 });
  }

  space(h: number) {
    this.doc.y += h;
  }

  header(lines: string[]) {
    this.style(18, true).text(this.title, this.left, MARGIN.top, { width: this.width });
    this.space(4);
    for (const line of lines) this.style(9.5, false, MUTED).text(line, this.left, this.doc.y, { width: this.width, lineGap: 1 });
    this.space(6);
    this.rule(INK, 1);
    this.space(10);
  }

  rule(color = RULE, thickness = 0.5) {
    const y = this.doc.y;
    this.doc.save().moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(thickness).strokeColor(color).stroke().restore();
  }

  private sectionHeight(title: string, note?: string) {
    return 12 + this.measure(title, this.width, 12.5, true) + (note ? 1 + this.measure(note, this.width, 9) : 0);
  }

  /** A heading kept on one page with at least `keep` points of what follows it. */
  section(title: string, note?: string, keep = 50) {
    this.ensure(this.sectionHeight(title, note) + keep);
    this.space(6);
    this.style(12.5, true).text(title, this.left, this.doc.y, { width: this.width });
    if (note) this.style(9, false, MUTED).text(note, this.left, this.doc.y + 1, { width: this.width, lineGap: 1 });
    this.space(6);
  }

  paragraph(text: string, { size = 9.5, color = INK, bold = false } = {}) {
    const h = this.measure(text, this.width, size, bold);
    this.ensure(h);
    this.style(size, bold, color).text(text, this.left, this.doc.y, { width: this.width, lineGap: 1 });
    this.space(3);
  }

  /** A table with its section heading; a short one stays on one page, a long one repeats its header row. */
  table(heading: { title: string; note?: string } | null, columns: Column[], rows: Cell[][]) {
    const pad = 4;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const xs = widths.map((_, i) => this.left + widths.slice(0, i).reduce((s, w) => s + w, 0));

    const drawHead = () => {
      const h = Math.max(...columns.map((c, i) => this.measure(c.header, widths[i] - 2 * pad, 8.5, true))) + 2 * pad;
      const y = this.doc.y;
      this.doc.save().rect(this.left, y, this.width, h).fill(HEAD_FILL).restore();
      columns.forEach((c, i) =>
        this.style(8.5, true, MUTED).text(c.header, xs[i] + pad, y + pad, { width: widths[i] - 2 * pad, align: c.align ?? "left", lineGap: 1 }),
      );
      this.doc.y = y + h;
    };

    const cellHeight = (cell: Cell, w: number) =>
      this.measure(cell.text || " ", w, 9.5, cell.bold) + (cell.sub ? this.measure(cell.sub, w, 8) + 1 : 0);

    const headHeight = Math.max(...columns.map((c, i) => this.measure(c.header, widths[i] - 2 * pad, 8.5, true))) + 2 * pad;
    const heights = rows.map((row) => Math.max(...row.map((cell, i) => cellHeight(cell, widths[i] - 2 * pad))) + 2 * pad);
    const all = heights.reduce((s, h) => s + h, 0);
    const keep = headHeight + (all <= 240 ? all : heights.slice(0, 2).reduce((s, h) => s + h, 0));
    if (heading) this.section(heading.title, heading.note, keep);
    else this.ensure(keep);

    drawHead();
    for (const [r, row] of rows.entries()) {
      const h = heights[r];
      if (this.doc.y + h > this.bottom) {
        this.doc.addPage();
        drawHead();
      }
      const y = this.doc.y;
      row.forEach((cell, i) => {
        const opts = { width: widths[i] - 2 * pad, align: columns[i].align ?? "left", lineGap: 1 } as const;
        this.style(9.5, cell.bold, cell.color ?? INK).text(cell.text || " ", xs[i] + pad, y + pad, opts);
        if (cell.sub) this.style(8, false, MUTED).text(cell.sub, xs[i] + pad, this.doc.y + 1, opts);
      });
      this.doc.y = y + h;
      this.rule();
    }
    this.space(10);
  }

  /** A numbered medication heading with a right-hand figure. */
  itemHeading(text: string, right?: { text: string; color?: string }) {
    const rightWidth = right ? Math.min(170, this.width * 0.4) : 0;
    const leftWidth = this.width - rightWidth - (right ? 8 : 0);
    const h = Math.max(this.measure(text, leftWidth, 11, true), right ? this.measure(right.text, rightWidth, 11, true) : 0);
    this.ensure(h + 50);
    const y = this.doc.y;
    this.style(11, true).text(text, this.left, y, { width: leftWidth, lineGap: 1 });
    if (right) this.style(11, true, right.color ?? INK).text(right.text, this.left + this.width - rightWidth, y, { width: rightWidth, align: "right", lineGap: 1 });
    this.doc.y = y + h + 3;
  }

  /** "label   value" with the value wrapping in its own column; several values go on separate lines. */
  field(label: string, value: string | string[], color = INK) {
    const labelWidth = 62;
    const valueWidth = this.width - labelWidth;
    const values = Array.isArray(value) ? value : [value];
    const text = values.join("\n");
    const h = this.measure(text, valueWidth, 9.5);
    // Long lists may break across pages; keep at least the first lines with the label.
    this.ensure(Math.min(h, 40));
    const y = this.doc.y;
    this.style(9.5, false, MUTED).text(label, this.left, y, { width: labelWidth - 6, lineGap: 1 });
    this.style(9.5, false, color).text(text, this.left + labelWidth, y, { width: valueWidth, lineGap: 1 });
    this.doc.y = Math.max(this.doc.y, y + this.measure(label, labelWidth - 6, 9.5)) + 2;
  }

  endItem() {
    this.space(4);
    this.rule();
    this.space(8);
  }

  async finish(): Promise<Buffer> {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would otherwise start a new page.
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 32;
      this.style(8, false, MUTED).text(`${this.title} · 生成于 ${this.generated}`, this.left, y, { width: this.width * 0.75, lineBreak: false });
      this.style(8, false, MUTED).text(`第 ${i + 1} / ${range.count} 页`, this.left, y, { width: this.width, align: "right", lineBreak: false });
      doc.page.margins.bottom = keep;
    }
    doc.end();
    return this.done;
  }
}

/* -------------------------------------- helpers -------------------------------------- */

const nameCell = (m: ReportItem["medication"]): Cell => ({
  text: m.name,
  bold: true,
  sub: [m.brand, m.dosage, packSize(m)].filter(Boolean).join(" · ") || null,
});

const regimenCell = (it: ReportItem): Cell =>
  it.status.current
    ? { text: formatRegimenShort(it.status.current), sub: `${fmtQty(dailyTotal(it.status.current))} 颗/天` }
    : { text: "未设置", color: MUTED };

const pillsCell = (pills: number, m: ReportItem["medication"]): Cell => ({ text: `${fmtQty(pills)} 颗`, sub: packNote(pills, m) });

const headline = (it: ReportItem) => it.status.conclusion.headline + (it.status.conclusion.detail ? `（${it.status.conclusion.detail}）` : "");

const periodLabel = (days: number) => (days % 7 === 0 ? `${days / 7} 周` : `${days} 天`);

export interface RenderContext {
  input: ReportInput;
  /** "2026.11.06 周五 17:40（北京时间）" */
  generated: string;
}

/** "2026.11.07 周六 08:30（北京时间），早上服药后" */
const nowText = ({ input, generated }: RenderContext) => `${generated}，${COUNT_MOMENT_LABEL[input.now.slotsDone]}`;

/* ------------------------------------- the lists ------------------------------------- */

export async function renderVisitPdf(r: VisitReport, ctx: RenderContext): Promise<Buffer> {
  const w = new Writer("复诊开药清单", ctx.generated);
  const today = ctx.input.now.date;
  const visitToday = r.date === today;
  const period = periodLabel(r.days);
  const leftLabel = visitToday ? "现在剩" : `截止${weekdayCN(r.cutoff)}晚剩`;

  w.header([
    `复诊日期：${fmtDate(r.date)}（${visitOrdinal(r.index)}复诊）`,
    visitToday
      ? `库存按现在（${COUNT_MOMENT_LABEL[ctx.input.now.slotsDone]}）计算`
      : `库存截止：${fmtDate(r.cutoff)} 晚上服药后`,
    `开药要够：${fmtDate(r.date)} 起，吃到 ${fmtDate(r.coverUntil)} 晚上，共 ${spanText(r.days)}` +
      (r.estimated ? "（未录入再下一次复诊，按 4 周后的周四估算）" : r.following ? `（再下一次复诊 ${fmtDate(r.following)}）` : ""),
    "只按现有药物计算，不含药物储备；每一次补药都视为一次购买。",
  ]);

  w.paragraph(
    `需开药 ${r.needed.length} 种，无需开药 ${r.covered.length} 种` + (r.inactive.length ? `，未在吃 ${r.inactive.length} 种（不需要开）。` : "。"),
    { bold: true },
  );

  if (r.needed.length) {
    w.table(
      { title: `需开药品（${r.needed.length} 种）`, note: "“需开”是缺少的盒数，括号里是缺少的颗数；未写明每盒颗数的药只按颗计。" },
      [
        { header: "#", width: 4, align: "center" },
        { header: "药品", width: 30 },
        { header: "服用规律", width: 17 },
        { header: leftLabel, width: 14, align: "right" },
        { header: `未来 ${period}需`, width: 15, align: "right" },
        { header: "需开（缺少）", width: 20, align: "right" },
      ],
      r.needed.map((it, i) => [
        { text: String(i + 1) },
        nameCell(it.medication),
        regimenCell(it),
        { text: `${fmtQty(it.need.stockBefore)} 颗` },
        { text: `${fmtQty(it.need.demand)} 颗`, sub: it.need.supplied > 0 ? `已记补药 +${fmtQty(it.need.supplied)}` : null },
        { text: needText(it.need, it.medication), bold: true, color: ALERT },
      ]),
    );

    w.section("明细与复购原因");
    r.needed.forEach((it, i) => {
      const m = it.medication;
      w.itemHeading(`${i + 1}. ${medicationLabel(m)}`, { text: `缺 ${needText(it.need, m)}`, color: ALERT });
      w.field("规格", packSize(m) ? `每${m.packUnit} ${fmtQty(m.perBox!)} 颗` : `未写明每${m.packUnit}颗数（按颗计）`);
      w.field("服用规律", formatRegimen(it.status.current));
      w.field("现有药", headline(it));
      w.field("复购原因", needReason(it, r, ctx.input.now));
      w.field("本次开药", prescriptionText(it.need, m));
      const bought = purchaseLines(m, today);
      w.field("购买记录", bought.length ? bought : "暂无购买记录");
      const counted = countLines(m);
      if (counted.length) w.field("盘点记录", counted);
      const gap = gapWarning(it, r);
      if (gap) w.field("注意", gap, ALERT);
      w.endItem();
    });
  }

  if (r.covered.length) {
    w.table(
      { title: `本次无需开药（${r.covered.length} 种）`, note: `现有药够吃到 ${fmtDate(r.coverUntil)} 晚上。` },
      [
        { header: "#", width: 4, align: "center" },
        { header: "药品", width: 36 },
        { header: leftLabel, width: 16, align: "right" },
        { header: `未来 ${period}需`, width: 16, align: "right" },
        { header: "说明", width: 28 },
      ],
      r.covered.map((it, i) => [
        { text: String(i + 1) },
        nameCell(it.medication),
        { text: `${fmtQty(it.need.stockBefore)} 颗` },
        { text: `${fmtQty(it.need.demand)} 颗`, sub: it.need.supplied > 0 ? `已记补药 +${fmtQty(it.need.supplied)}` : null },
        {
          text: it.need.demand > 0 ? "够用" : "期间不服用",
          sub: gapWarning(it, r) ? "但等不到这次就诊就会断药" : null,
          color: gapWarning(it, r) ? ALERT : INK,
        },
      ]),
    );
  }

  if (r.inactive.length) {
    w.section(`未在吃（${r.inactive.length} 种）`, "已停药或没设服用规律，不需要开药。");
    w.paragraph(r.inactive.map((it, i) => `${i + 1}. ${medicationLabel(it.medication)}（${intakeLabel(it.intake)}）`).join("\n"));
  }

  if (!r.needed.length && !r.covered.length && !r.inactive.length) w.paragraph("暂无药品。", { color: MUTED });
  return w.finish();
}

export async function renderStockPdf(r: StockReport, ctx: RenderContext): Promise<Buffer> {
  const w = new Writer("药品现有清单", ctx.generated);
  const today = ctx.input.now.date;
  w.header([
    `截至：${nowText(ctx)}`,
    `共 ${r.items.length} 种药品${r.nextVisit ? `；下次复诊 ${fmtDate(r.nextVisit)}` : ""}`,
    "只列现有药物，不含药物储备（储备见《药品储备清单》）；每一次补药都视为一次购买。",
  ]);

  if (!r.items.length) {
    w.paragraph("暂无药品。", { color: MUTED });
    return w.finish();
  }

  const taking = r.items.filter((it) => it.taking);
  const inactive = r.items.filter((it) => !it.taking);
  const columns: Column[] = [
    { header: "#", width: 4, align: "center" },
    { header: "药品", width: 32 },
    { header: "服用规律", width: 17 },
    { header: "现有", width: 19, align: "right" },
    { header: "能吃到", width: 28 },
  ];
  // Numbered across both tables, matching the records below.
  const rows = (items: ReportItem[], offset: number): Cell[][] =>
    items.map((it, i) => [
      { text: String(offset + i + 1) },
      nameCell(it.medication),
      regimenCell(it),
      { ...pillsCell(it.status.balanceNow, it.medication), bold: true },
      {
        text: it.taking ? it.status.conclusion.badge : intakeLabel(it.intake)!,
        sub: it.taking ? it.status.conclusion.detail : it.intake.kind === "stopped" ? `${fmtDate(it.intake.since)} 起` : null,
        color: it.taking && it.status.conclusion.tone === "danger" ? ALERT : it.taking ? INK : MUTED,
      },
    ]);
  if (taking.length) w.table({ title: `在吃（${taking.length} 种）` }, columns, rows(taking, 0));
  if (inactive.length) w.table({ title: `未在吃（${inactive.length} 种）`, note: "已停药或没设服用规律。" }, columns, rows(inactive, taking.length));

  w.section("购买与盘点记录");
  r.items.forEach((it, i) => {
    const m = it.medication;
    w.itemHeading(`${i + 1}. ${medicationLabel(m)}`, { text: `现有 ${fmtQty(it.status.balanceNow)} 颗` });
    w.field("规格", packSize(m) ? `每${m.packUnit} ${fmtQty(m.perBox!)} 颗` : `未写明每${m.packUnit}颗数`);
    w.field("服用规律", formatRegimen(it.status.current));
    w.field("现有药", headline(it));
    const bought = purchaseLines(m, today);
    w.field("购买记录", bought.length ? bought : "暂无购买记录");
    const counted = countLines(m);
    if (counted.length) w.field("盘点记录", counted);
    w.endItem();
  });
  return w.finish();
}

export async function renderReservePdf(r: ReserveReport, ctx: RenderContext): Promise<Buffer> {
  const w = new Writer("药品储备清单", ctx.generated);
  w.header([
    `截至：${nowText(ctx)}`,
    `有储备 ${r.items.length} 种，无储备 ${r.empty.length} 种`,
    "储备是另外存放的药，不计入现有库存，也不计入复诊开药量（现有药见《药品现有清单》）。",
  ]);

  if (r.items.length) {
    w.table(
      null,
      [
        { header: "#", width: 4, align: "center" },
        { header: "药品", width: 36 },
        { header: "储备", width: 22, align: "right" },
        { header: "按当前规律可用", width: 38 },
      ],
      r.items.map((it, i) => [
        { text: String(i + 1) },
        nameCell(it.medication),
        { ...pillsCell(it.medication.reserve, it.medication), bold: true },
        { text: it.lasts, sub: it.status.current ? formatRegimen(it.status.current) : null },
      ]),
    );
  } else {
    w.paragraph("目前没有任何药物储备。", { color: MUTED });
  }

  if (r.empty.length) {
    w.section(`无储备（${r.empty.length} 种）`);
    w.paragraph(r.empty.map((m, i) => `${i + 1}. ${medicationLabel(m)}`).join("\n"));
  }
  return w.finish();
}
