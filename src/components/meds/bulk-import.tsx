"use client";

import {
  ClipboardCopyIcon,
  HistoryIcon,
  ListPlusIcon,
  PlusIcon,
  RotateCcwIcon,
  ScanTextIcon,
  TagIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { importStock } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate, wallClock } from "@/lib/meds/dates";
import { COUNT_MOMENT_LABEL, fmtQty, formatRegimenShort, packNote, type MedicationStatus } from "@/lib/meds/format";
import {
  key,
  importTemplate,
  matchEntry,
  parseImportText,
  resolveImportAmount,
  type ImportAmount,
  type ImportEntry,
} from "@/lib/meds/import";
import { balanceAt, packBalancesAt, regimenAt, type Dose, type Moment } from "@/lib/meds/simulate";
import { PACK_UNITS, type MedicationRecord, type PackRecord, type PackUnit } from "@/lib/meds/types";
import { importSchema, medicationSchema, perBoxSchema, type ImportFields } from "@/lib/meds/validation";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { FormError, SubmitButton, useActionForm } from "./forms";
import { clearImportDraft, loadImportDraft, saveImportDraft } from "./import-draft";

type Amount = { boxes: string; loose: string };
type Doses = { morning: string; noon: string; evening: string };

interface Row {
  key: string;
  /** Existing medication, or null for a new one. */
  medId: number | null;
  /**
   * Existing medication: the pack (manufacturer) the row is about — its size, stock and
   * reserve — or "new" = add `brand` as another manufacturer of it. null for a new medication.
   */
  pack?: number | "new" | null;
  name: string;
  brand: string;
  dosage: string;
  packUnit: PackUnit;
  /** The pack unit the pasted line named, if any. */
  readUnit: PackUnit | null;
  perBox: string;
  stock: Amount;
  reserve: Amount;
  /** null = keep the current regimen (existing) / none (new). */
  doses: Doses | null;
  /** The pasted line this row was read from. */
  line: number | null;
  notes: string[];
  /** For a new row read from text: existing medications it might be. */
  choices: number[];
}

type ImportRow = ImportFields["rows"][number];

const emptyAmount: Amount = { boxes: "", loose: "" };
const digits = (v: string) => v.replace(/[^\d.]/g, "");
const amountFields = (a: ImportAmount): Amount => ({
  boxes: a.packs ? String(a.packs) : "",
  loose: a.pills || !a.packs ? String(a.pills) : "",
});
const doseFields = (d: Dose): Doses => ({ morning: String(d.morning), noon: String(d.noon), evening: String(d.evening) });
const sameDose = (a: Dose, b: Dose) => a.morning === b.morning && a.noon === b.noon && a.evening === b.evening;

let seq = 0;
const nextKey = () => `row-${++seq}`;

const packKey = (m: MedicationRecord, p: PackRecord) => `med-${m.id}-${p.id}`;

/** One existing pack (manufacturer) of a medication, nothing changed yet. */
function existingRow(m: MedicationRecord, p: PackRecord = m.packs[0]): Row {
  return {
    key: packKey(m, p),
    medId: m.id,
    pack: p.id,
    name: m.name,
    brand: p.brand ?? "",
    dosage: m.dosage,
    packUnit: p.packUnit,
    readUnit: null,
    perBox: p.perBox ? String(p.perBox) : "",
    stock: emptyAmount,
    reserve: emptyAmount,
    doses: null,
    line: null,
    notes: [],
    choices: [],
  };
}

/** Every pack of every medication, a row each. */
const existingRows = (meds: readonly MedicationRecord[]) => meds.flatMap((m) => m.packs.map((p) => existingRow(m, p)));

/** A row adding `brand` as another manufacturer of `m`. */
const newPackRow = (m: MedicationRecord, brand: string): Row => ({
  ...existingRow(m),
  key: nextKey(),
  pack: "new",
  brand: brand.trim(),
  perBox: "",
});

/**
 * The row for the manufacturer a line names (the default one when it names none), adding a row
 * for a manufacturer the medication does not have yet. Returns the rows and that row's index.
 */
function rowFor(rows: Row[], m: MedicationRecord, brand: string): { rows: Row[]; index: number } {
  const b = key(brand);
  const pack = b ? m.packs.find((p) => key(p.brand) === b) : m.packs[0];
  const index = pack
    ? rows.findIndex((r) => r.key === packKey(m, pack))
    : rows.findIndex((r) => r.medId === m.id && r.pack === "new" && key(r.brand) === b);
  if (index >= 0) return { rows, index };
  if (pack) return { rows: [...rows, existingRow(m, pack)], index: rows.length };
  // Right after the medication's other rows.
  const last = rows.findLastIndex((r) => r.medId === m.id);
  const at = last < 0 ? rows.length : last + 1;
  return { rows: [...rows.slice(0, at), newPackRow(m, brand), ...rows.slice(at)], index: at };
}

function newRow(e?: ImportEntry, notes: string[] = [], choices: number[] = []): Row {
  return {
    key: nextKey(),
    medId: null,
    pack: null,
    name: e?.name ?? "",
    brand: e?.brand ?? "",
    dosage: e?.dosage ?? "",
    packUnit: e?.packUnit ?? "盒",
    readUnit: e?.packUnit ?? null,
    perBox: e?.perBox ? String(e.perBox) : "",
    stock: e?.stock ? amountFields(e.stock) : emptyAmount,
    reserve: e?.reserve ? amountFields(e.reserve) : emptyAmount,
    doses: e?.regimen ? doseFields(e.regimen) : null,
    line: e?.line ?? null,
    notes,
    choices,
  };
}

/** A saved draft against today's list: rows of deleted medications / packs go, new packs get a row. */
function restoreRows(saved: Row[], medications: MedicationRecord[]): Row[] {
  const byId = new Map(medications.map((m) => [m.id, m]));
  const keys = new Set<string>();
  const kept = saved
    .filter((r) => r && typeof r.key === "string" && (r.medId === null || byId.has(r.medId)))
    .map((r) => {
      const m = r.medId === null ? null : byId.get(r.medId)!;
      const choices = (r.choices ?? []).filter((id) => byId.has(id));
      if (!m) return { ...r, choices };
      if (r.pack === "new") return { ...r, name: m.name, dosage: m.dosage, choices };
      // A draft from before rows were per pack is about the default one.
      const pack = m.packs.find((p) => p.id === r.pack) ?? m.packs[0];
      return { ...r, key: packKey(m, pack), name: m.name, dosage: m.dosage, choices, pack: pack.id, brand: pack.brand ?? "" };
    })
    .filter((r) => !keys.has(r.key) && !!keys.add(r.key));
  // New-row keys continue after the restored ones.
  for (const r of kept) seq = Math.max(seq, Number(/^row-(\d+)$/.exec(r.key)?.[1] ?? 0));
  return [...kept, ...existingRows(medications).filter((r) => !keys.has(r.key))];
}

/** The stock the records give for the row's pack at the counted moment (0 for a new manufacturer). */
function expectedStock(row: Row, med: MedicationRecord | undefined, status: MedicationStatus | undefined, at: Moment): number | null {
  if (!med || !status) return null;
  if (row.pack === "new") return 0;
  if (med.packs.length <= 1) return balanceAt(status.sim, at);
  const i = med.packs.findIndex((p) => p.id === row.pack);
  return packBalancesAt(status.sim, at)[Math.max(0, i)] ?? 0;
}

/** "2026.11.07 周六 01:55" in Beijing time. */
function savedAtText(ms: number) {
  const { date, minutes } = wallClock(new Date(ms));
  return `${fmtDate(date)} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The pack an existing row is about (undefined for a new manufacturer). */
const rowPack = (row: Row, med: MedicationRecord) => (row.pack === "new" ? undefined : (med.packs.find((p) => p.id === row.pack) ?? med.packs[0]));

/** Values read for a medication override what the row had. */
function fill(row: Row, from: Pick<Row, "readUnit" | "perBox" | "stock" | "reserve" | "doses" | "line">, notes: string[]): Row {
  const has = (a: Amount) => a.boxes !== "" || a.loose !== "";
  return {
    ...row,
    packUnit: from.readUnit ?? row.packUnit,
    perBox: from.perBox || row.perBox,
    stock: has(from.stock) ? from.stock : row.stock,
    reserve: has(from.reserve) ? from.reserve : row.reserve,
    doses: from.doses ?? row.doses,
    line: from.line,
    notes,
  };
}

interface Built {
  /** null = nothing to change. */
  item: ImportRow | null;
  error: string | null;
  /** Counted stock / reserve, for the row's preview. */
  stock: number | null;
  reserve: number | null;
}

function parseDoses(d: Doses): Dose | null {
  const values = [d.morning, d.noon, d.evening].map((v) => (v.trim() === "" ? 0 : Number(v)));
  if (values.some((v) => !Number.isFinite(v) || v < 0 || !Number.isInteger(v * 2))) return null;
  return { morning: values[0], noon: values[1], evening: values[2] };
}

/** `expected`: the stock the records give at the counted moment; counting exactly that changes nothing. */
function build(row: Row, med: MedicationRecord | undefined, at: Moment, expected: number | null): Built {
  const perBoxRaw = row.perBox.trim();
  const perBoxParsed = perBoxSchema.safeParse(perBoxRaw ? Number(perBoxRaw) : null);
  const fail = (error: string): Built => ({ item: null, error, stock: null, reserve: null });
  if (!perBoxParsed.success) return fail(perBoxParsed.error.issues[0]?.message ?? `每${row.packUnit}颗数无效`);
  const perBox = perBoxParsed.data;
  const stock = resolveImportAmount(row.stock.boxes, row.stock.loose, perBox, row.packUnit);
  if ("error" in stock) return fail(`余量：${stock.error}`);
  const reserve = resolveImportAmount(row.reserve.boxes, row.reserve.loose, perBox, row.packUnit);
  if ("error" in reserve) return fail(`储备：${reserve.error}`);
  let regimen: Dose | null = null;
  if (row.doses) {
    regimen = parseDoses(row.doses);
    if (!regimen) return fail("服用规律：每次颗数只能是整数或 0.5 的倍数");
  }
  const counted = { stock: stock.value, reserve: reserve.value };

  if (med) {
    const current = regimenAt(med.regimens, at.date);
    if (regimen && current && sameDose(regimen, current)) regimen = null;
    if (regimen && !current && sameDose(regimen, { morning: 0, noon: 0, evening: 0 })) regimen = null;
    const count = stock.value !== null && stock.value !== expected ? stock.value : null;
    const target = rowPack(row, med);
    if (!target && !row.brand.trim()) return fail("请填写新厂家 / 品牌");
    const changed =
      count !== null ||
      (reserve.value !== null && reserve.value !== (target?.reserve ?? 0)) ||
      !target ||
      perBox !== target.perBox ||
      row.packUnit !== target.packUnit ||
      regimen !== null;
    if (!changed) return { item: null, error: null, ...counted };
    const pack = !target ? { brand: row.brand.trim() } : target.id > 0 ? { id: target.id } : null;
    return {
      item: { kind: "existing", id: med.id, pack, packUnit: row.packUnit, perBox, stock: count, reserve: reserve.value, regimen },
      error: null,
      ...counted,
    };
  }

  const fields = medicationSchema.safeParse({ name: row.name, brand: row.brand, dosage: row.dosage, packUnit: row.packUnit, perBox });
  if (!fields.success) return fail(fields.error.issues[0]?.message ?? "药品信息无效");
  return {
    item: { kind: "new", ...fields.data, brand: fields.data.brand ?? "", stock: stock.value, reserve: reserve.value, regimen },
    error: null,
    ...counted,
  };
}

/* ------------------------------------------------------------------------------------ */

export function BulkImportDialog({
  open,
  onOpenChange,
  medications,
  statuses,
  now,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medications: MedicationRecord[];
  statuses: Map<number, MedicationStatus>;
  now: Moment;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>一键录入</DialogTitle>
          <DialogDescription>
            粘贴清单或直接在下面填写，一次把所有药的当前余量、储备和每盒颗数录进系统，也可以顺带新增药品。留空的格子保持不变。填写的内容会自动保存在这台设备上，录入成功后清除。
          </DialogDescription>
        </DialogHeader>
        {open && (
          <BulkImportForm medications={medications} statuses={statuses} now={now} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkImportForm({
  medications,
  statuses,
  now,
  onDone,
}: {
  medications: MedicationRecord[];
  statuses: Map<number, MedicationStatus>;
  now: Moment;
  onDone: () => void;
}) {
  const uid = useId();
  // Read once: this form is only rendered on the client, after the dialog opens.
  const [draft] = useState(() => loadImportDraft<Row>());
  const [restoredAt, setRestoredAt] = useState<number | null>(draft?.savedAt ?? null);
  const [text, setText] = useState(draft?.text ?? "");
  const [unread, setUnread] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>(() => (draft ? restoreRows(draft.rows, medications) : existingRows(medications)));
  const [at, setAt] = useState<Moment>(draft?.at ?? now);
  const { pending, error, setError, submit } = useActionForm();
  const byId = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  // Keep a draft while anything is filled in; an untouched form leaves none.
  const pristine = useMemo(() => JSON.stringify(existingRows(medications)), [medications]);
  const dirty = text.trim() !== "" || JSON.stringify(rows) !== pristine;
  const finished = useRef(false);
  useEffect(() => {
    if (finished.current) return;
    if (dirty) saveImportDraft({ savedAt: Date.now(), text, rows, at });
    else clearImportDraft();
  }, [dirty, text, rows, at]);

  const discardDraft = () => {
    clearImportDraft();
    setRestoredAt(null);
    setText("");
    setUnread([]);
    setRows(existingRows(medications));
    setAt(now);
    setError(null);
  };

  const atLater = at.date > now.date || (at.date === now.date && at.slotsDone > now.slotsDone);
  const built = useMemo(
    () =>
      new Map(
        rows.map((r) => {
          const med = r.medId ? byId.get(r.medId) : undefined;
          const expected = expectedStock(r, med, r.medId ? statuses.get(r.medId) : undefined, at);
          return [r.key, build(r, med, at, expected)];
        }),
      ),
    [rows, byId, statuses, at],
  );
  const changes = rows.filter((r) => built.get(r.key)?.item);
  const newCount = changes.filter((r) => r.medId === null).length;
  const medCount = (rs: Row[]) => new Set(rs.map((r) => r.medId ?? r.key)).size;
  const updatedCount = medCount(changes.filter((r) => r.medId !== null));
  const missingPerBox = rows.filter((r) => !r.perBox.trim()).length;
  const firstError = rows.map((r) => ({ r, e: built.get(r.key)?.error })).find((x) => x.e);

  const update = (key: string, patch: Partial<Row>) => {
    setError(null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const recognize = () => {
    const entries = parseImportText(text);
    if (entries.length === 0) return setUnread(["没有可识别的内容：每行写一种药"]);
    let next = existingRows(medications);
    const seen = new Map<string, number>();
    const skipped: string[] = [];
    for (const e of entries) {
      if (!e.name) {
        skipped.push(`第 ${e.line} 行「${e.raw}」：${e.warnings.join("；")}`);
        continue;
      }
      const match = matchEntry(e, medications);
      if (match.kind === "match") {
        const notes = [...e.warnings];
        const med = medications.find((m) => m.id === match.id)!;
        const found = rowFor(next, med, e.brand ?? "");
        next = found.rows;
        const i = found.index;
        const before = seen.get(next[i].key);
        if (before) notes.push(`和第 ${before} 行是同一种药的同一个厂家，按本行录入`);
        seen.set(next[i].key, e.line);
        if (next[i].pack === "new") notes.push(`“${e.brand}”是这种药的新厂家，录入时会加为它的一个厂家（余量和储备单独记）`);
        else if (!e.brand && med.packs.length > 1) notes.push(`没写厂家，按默认厂家“${med.packs[0].brand ?? "未写厂家"}”录入；不对的话在清单里写上厂家`);
        const read = newRow(e);
        // A regimen the line repeats unchanged is not a change.
        const current = regimenAt(medications.find((m) => m.id === match.id)!.regimens, at.date);
        if (e.regimen && current && sameDose(e.regimen, current)) read.doses = null;
        next[i] = fill(next[i], read, notes);
      } else {
        const notes = [...e.warnings];
        if (match.kind === "ambiguous") notes.push("有几种药都对得上，请选一种，或作为新药");
        else if (match.similar.length) notes.push("系统里有同名但规格不同的药，已作为新药；不对的话请改选");
        next.push(newRow(e, notes, match.kind === "ambiguous" ? match.ids : match.similar));
      }
    }
    setRows(next);
    setUnread(skipped);
    setError(null);
    toast.success(`识别了 ${entries.length - skipped.length} 行`);
  };

  /** A row read as new turns out to be an existing medication: fold it into that one (its manufacturer's row). */
  const assign = (rowKey: string, medId: number) =>
    setRows((rs) => {
      const from = rs.find((r) => r.key === rowKey);
      const med = medications.find((m) => m.id === medId);
      if (!from || !med) return rs;
      const found = rowFor(
        rs.filter((r) => r.key !== rowKey),
        med,
        from.brand,
      );
      const notes = from.notes.filter((n) => !n.includes("新药") && !n.includes("选一种"));
      return found.rows.map((r, i) => (i === found.index ? fill(r, from, notes) : r));
    });

  // A line per manufacturer, with its own stock and reserve.
  const template = () =>
    importTemplate(
      medications.flatMap((m) => {
        const s = statuses.get(m.id);
        const regimen = regimenAt(m.regimens, at.date);
        return m.packs.map((p) => ({
          ...m,
          brand: p.brand,
          packUnit: p.packUnit,
          perBox: p.perBox,
          stock: expectedStock(existingRow(m, p), m, s, at) ?? 0,
          reserve: p.reserve,
          regimen,
        }));
      }),
    );

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (atLater) return setError("清点时间不能晚于现在");
        if (firstError) return setError(`${firstError.r.name || "新药品"}：${firstError.e}`);
        const items = changes.map((r) => built.get(r.key)!.item!);
        if (items.length === 0) return setError("没有要录入的内容：在下面填写数量，或粘贴清单后点“识别”");
        const input: ImportFields = { at, rows: items };
        const parsed = importSchema.safeParse(input);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(
          () => importStock(input),
          () => {
            finished.current = true;
            clearImportDraft();
            toast.success(`已录入：${[updatedCount && `更新 ${updatedCount} 种`, newCount && `新增 ${newCount} 种`].filter(Boolean).join("，")}`);
            onDone();
          },
        );
      }}
    >
      {restoredAt !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">
          <HistoryIcon className="size-4 shrink-0" />
          <span className="flex-1">
            已恢复 {savedAtText(restoredAt)} 没有提交的内容，清点时间仍是 {fmtDate(at.date)} {COUNT_MOMENT_LABEL[at.slotsDone]}。核对后点下面的“一键录入”提交。
          </span>
          <Button type="button" size="xs" variant="ghost" onClick={discardDraft}>
            丢弃，重新开始
          </Button>
        </div>
      )}

      {/* 1. paste */}
      <section className="grid gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Label htmlFor={`${uid}-text`} className="text-sm font-medium">
            ① 粘贴清单 <span className="font-normal text-muted-foreground">（选填，每行一种药）</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {medications.length > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setText(template())}>
                <ListPlusIcon />
                填入当前清单
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!text.trim()}
              onClick={() =>
                navigator.clipboard.writeText(text).then(
                  () => toast.success("已复制"),
                  () => toast.error("复制失败，请手动选择文字复制"),
                )
              }
            >
              <ClipboardCopyIcon />
              复制
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={!text.trim()} onClick={recognize}>
              <ScanTextIcon />
              识别并填入下表
            </Button>
          </div>
        </div>
        <textarea
          id={`${uid}-text`}
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"他克莫司胶囊，1mg，每盒50颗，余 3盒12颗，储备 2盒，早1 晚1\n阿托伐他汀钙片（立普妥） 20mg 7片×2板 剩 20 片\n新药 5mg 每瓶100颗 余 1瓶30颗"}
          className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <p className="text-xs text-muted-foreground">
          能认出：药名、品牌、规格（10mg）、每盒颗数（每盒30颗、30片/盒、7片×2板）、盒装 / 瓶装、余量（余 3盒12颗、剩 86 颗）、储备（储备
          2盒）、规律（早1 中0 晚1、早晚各1片）。按药名、品牌或拼音对应到已有药品，对不上的作为新药。
        </p>
        {unread.length > 0 && (
          <ul className="grid gap-1 text-xs text-amber-700 dark:text-amber-400">
            {unread.map((u) => (
              <li key={u} className="flex items-start gap-1.5">
                <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
                {u}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. when */}
      <section className="grid gap-2">
        <span className="text-sm font-medium">② 清点时间</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52">
            <DatePicker label="清点日期" value={at.date} onChange={(date) => setAt((a) => ({ ...a, date }))} today={now.date} />
          </div>
          <div role="radiogroup" aria-label="清点时刻" className="inline-flex flex-wrap rounded-md border p-0.5 text-sm">
            {COUNT_MOMENT_LABEL.map((label, k) => {
              const later = at.date === now.date && k > now.slotsDone;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={at.slotsDone === k}
                  disabled={later}
                  onClick={() => setAt((a) => ({ ...a, slotsDone: k as Moment["slotsDone"] }))}
                  className={cn(
                    "rounded-[5px] px-2.5 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    at.slotsDone === k ? "bg-primary text-primary-foreground" : "text-muted-foreground enabled:hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <p className={cn("text-xs", atLater ? "text-destructive" : "text-muted-foreground")}>
          {atLater
            ? "清点时间不能晚于现在。"
            : `余量记为 ${fmtDate(at.date)} ${COUNT_MOMENT_LABEL[at.slotsDone]}实际数出来的颗数（盘点），之后从这个数往下推算；那天已经记的补药算在里面，之后再补的药另加。新药的服用规律从这天起生效。`}
        </p>
      </section>

      {/* 3. check */}
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium">③ 核对</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              共 {medCount(rows)} 种{rows.length > medCount(rows) ? `（${rows.length} 个厂家）` : ""} · 将更新 {updatedCount} 种 · 新增 {newCount} 种
              {missingPerBox > 0 && ` · ${missingPerBox} 种未写明每盒颗数`}
            </span>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, newRow()])}>
            <PlusIcon />
            新增药品
          </Button>
        </div>
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            还没有药品：粘贴清单后点“识别”，或点“新增药品”
          </p>
        )}
        <div className="grid gap-2">
          {rows.map((r) => (
            <RowEditor
              key={r.key}
              row={r}
              med={r.medId ? byId.get(r.medId) : undefined}
              built={built.get(r.key)!}
              at={at}
              expected={expectedStock(r, r.medId ? byId.get(r.medId) : undefined, r.medId ? statuses.get(r.medId) : undefined, at)}
              medications={medications}
              onChange={(patch) => update(r.key, patch)}
              onAssign={(id) => assign(r.key, id)}
              onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              onReset={() => {
                const med = r.medId ? byId.get(r.medId) : undefined;
                const pack = med?.packs.find((p) => p.id === r.pack);
                if (med && pack) update(r.key, existingRow(med, pack));
              }}
            />
          ))}
        </div>
      </section>

      <div className="sticky -bottom-4 -mx-4 -mb-4 grid gap-2 rounded-b-xl border-t bg-popover px-4 py-3">
        <FormError>{error}</FormError>
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground tabular-nums">
            {changes.length ? `将录入 ${medCount(changes)} 种药` : "还没有填写任何变动"}
          </span>
          <Button type="button" variant="ghost" onClick={onDone}>
            取消
          </Button>
          <SubmitButton pending={pending}>一键录入{changes.length ? `（${medCount(changes)}）` : ""}</SubmitButton>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------------------------ */

function AmountCell({
  id,
  label,
  value,
  onChange,
  unit,
  hint,
}: {
  id: string;
  label: string;
  value: Amount;
  onChange: (a: Amount) => void;
  unit: string;
  hint: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={`${id}-boxes`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1.5 text-sm">
        <Input
          id={`${id}-boxes`}
          aria-label={`${label}：${unit}数`}
          inputMode="numeric"
          placeholder="—"
          className="h-8 w-16 text-center tabular-nums"
          value={value.boxes}
          onChange={(e) => onChange({ ...value, boxes: digits(e.target.value) })}
        />
        <span className="text-muted-foreground">{unit} +</span>
        <Input
          aria-label={`${label}：散装颗数`}
          inputMode="decimal"
          placeholder="—"
          className="h-8 w-16 text-center tabular-nums"
          value={value.loose}
          onChange={(e) => onChange({ ...value, loose: digits(e.target.value) })}
        />
        <span className="text-muted-foreground">颗</span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">{hint}</div>
    </div>
  );
}

const diffText = (to: number, from: number) => {
  const d = Math.round((to - from) * 2) / 2;
  return d === 0 ? "与推算一致，不用记盘点" : d > 0 ? `比推算多 ${fmtQty(d)} 颗` : `比推算少 ${fmtQty(-d)} 颗`;
};

function RowEditor({
  row,
  med,
  built,
  expected,
  at,
  medications,
  onChange,
  onAssign,
  onRemove,
  onReset,
}: {
  row: Row;
  med: MedicationRecord | undefined;
  built: Built;
  /** The row's pack's stock by the records at the counted moment. */
  expected: number | null;
  at: Moment;
  medications: MedicationRecord[];
  onChange: (patch: Partial<Row>) => void;
  onAssign: (medId: number) => void;
  onRemove: () => void;
  onReset: () => void;
}) {
  const uid = useId();
  const target = med ? rowPack(row, med) : undefined;
  const perBox = Number(row.perBox) > 0 ? Number(row.perBox) : null;
  const pack = { perBox, packUnit: row.packUnit };
  const changed = !!built.item;
  const current = med ? regimenAt(med.regimens, at.date) : null;
  const choices = row.choices
    .map((id) => medications.find((m) => m.id === id))
    .filter((m): m is MedicationRecord => m !== undefined);

  const stockHint =
    built.stock !== null ? (
      <>
        = {fmtQty(built.stock)} 颗{expected !== null && ` · ${diffText(built.stock, expected)}`}
      </>
    ) : expected !== null ? (
      <>
        推算 {fmtQty(expected)} 颗{packNote(expected, pack) && `（${packNote(expected, pack)}）`} · 留空不变
      </>
    ) : (
      "留空则不记余量"
    );
  const had = target?.reserve ?? 0;
  const reserveHint =
    built.reserve !== null
      ? `= ${fmtQty(built.reserve)} 颗${med ? `（原 ${fmtQty(had)} 颗）` : ""}`
      : med
        ? `现有 ${fmtQty(had)} 颗 · 留空不变`
        : "留空则为 0";

  return (
    <div
      className={cn(
        "grid gap-3 rounded-lg border p-3",
        changed && "border-primary/40 bg-primary/[0.03]",
        built.error && "border-destructive/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {med ? (
          <>
            <span className="font-medium">{med.name}</span>
            <span className="text-xs text-muted-foreground">{med.dosage}</span>
            {(row.brand || med.packs.length > 1) && (
              <span className={cn("text-xs", med.packs.length > 1 || row.pack === "new" ? "font-medium" : "text-muted-foreground")}>
                {row.brand || "未写厂家"}
              </span>
            )}
            {row.pack === "new" ? (
              <Badge variant="outline">新增厂家</Badge>
            ) : (
              med.packs.length > 1 && med.packs[0].id === row.pack && <Badge variant="secondary">默认</Badge>
            )}
          </>
        ) : (
          <Badge>新增药品</Badge>
        )}
        {!perBox && (
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          >
            <TagIcon />
            未写明每{row.packUnit}颗数
          </Badge>
        )}
        {row.line !== null && <Badge variant="secondary">清单第 {row.line} 行</Badge>}
        <span className="ml-auto flex items-center gap-1">
          {!changed && !built.error && med && <span className="text-xs text-muted-foreground">不变</span>}
          {med && changed && row.pack !== "new" && (
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`撤销「${med.name}」的改动`} onClick={onReset}>
              <RotateCcwIcon />
            </Button>
          )}
          {(!med || row.pack === "new") && (
            <Button type="button" size="icon-sm" variant="ghost" aria-label="移除这一行" onClick={onRemove}>
              <XIcon />
            </Button>
          )}
        </span>
      </div>

      {!med && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="药品名称" placeholder="药品名称" value={row.name} onChange={(e) => onChange({ name: e.target.value })} />
          <Input aria-label="品牌（选填）" placeholder="品牌（选填）" value={row.brand} onChange={(e) => onChange({ brand: e.target.value })} />
          <Input aria-label="含量/规格" placeholder="含量/规格，如 10mg" value={row.dosage} onChange={(e) => onChange({ dosage: e.target.value })} />
          {(choices.length > 0 || row.line !== null) && medications.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:col-span-3">
              其实是已有的药？
              <select
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30"
                value=""
                onChange={(e) => e.target.value && onAssign(Number(e.target.value))}
              >
                <option value="">作为新药</option>
                {(choices.length ? choices : medications).map((m) => (
                  <option key={m.id} value={m.id}>
                    {[m.name, m.brand, m.dosage].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[auto_1fr_1fr]">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${uid}-per-box`} className="text-xs text-muted-foreground">
            每{row.packUnit}颗数
          </Label>
          <div className="flex items-center gap-1.5 text-sm">
            <div role="radiogroup" aria-label="包装" className="inline-flex rounded-md border p-0.5 text-xs">
              {PACK_UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={row.packUnit === u}
                  onClick={() => onChange({ packUnit: u })}
                  className={cn(
                    "rounded-[5px] px-1.5 py-0.5 transition-colors",
                    row.packUnit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
            <Input
              id={`${uid}-per-box`}
              inputMode="decimal"
              placeholder="未写明"
              className="h-8 w-20 text-center tabular-nums"
              value={row.perBox}
              onChange={(e) => onChange({ perBox: digits(e.target.value) })}
            />
            <span className="text-muted-foreground">颗</span>
          </div>
          {target && perBox !== target.perBox && (
            <div className="text-xs text-muted-foreground tabular-nums">
              原 {target.perBox ? `${fmtQty(target.perBox)} 颗/${target.packUnit}` : "未写明"}
            </div>
          )}
        </div>
        <AmountCell
          id={`${uid}-stock`}
          label="当前余量"
          value={row.stock}
          onChange={(stock) => onChange({ stock })}
          unit={row.packUnit}
          hint={stockHint}
        />
        <AmountCell
          id={`${uid}-reserve`}
          label="药物储备"
          value={row.reserve}
          onChange={(reserve) => onChange({ reserve })}
          unit={row.packUnit}
          hint={reserveHint}
        />
      </div>

      {row.doses || !med ? (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">服用规律{med ? "（改为）" : "（选填）"}</span>
          {(
            [
              ["morning", "早"],
              ["noon", "中"],
              ["evening", "晚"],
            ] as const
          ).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="text-muted-foreground">{label}</span>
              <Input
                aria-label={`${label}（颗/次）`}
                inputMode="decimal"
                placeholder="0"
                className="h-8 w-14 text-center tabular-nums"
                value={row.doses?.[k] ?? ""}
                onChange={(e) =>
                  onChange({ doses: { ...(row.doses ?? { morning: "", noon: "", evening: "" }), [k]: digits(e.target.value) } })
                }
              />
            </span>
          ))}
          <span className="text-xs text-muted-foreground">颗/次</span>
          {med && (
            <>
              <span className="text-xs text-muted-foreground">
                · 现为 {current ? formatRegimenShort(current) : "未设置"}，从 {fmtDate(at.date)} 起生效
              </span>
              <Button type="button" size="xs" variant="ghost" onClick={() => onChange({ doses: null })}>
                不改规律
              </Button>
            </>
          )}
        </div>
      ) : null}

      {row.notes.map((n) => (
        <p key={n} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          {n}
        </p>
      ))}
      {built.error && <p className="text-xs text-destructive">{built.error}</p>}
    </div>
  );
}
