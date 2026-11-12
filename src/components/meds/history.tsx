"use client";

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addSupply, deleteCount, deleteRegimen, deleteReserveLog, deleteSupply, saveRegimen, updateRegimen, updateSupply } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addDays, fmtDate, type ISODate } from "@/lib/meds/dates";
import { COUNT_MOMENT_LABEL, RESERVE_USE_REASON, fmtQty, formatRegimen, intakeAt, isTaking, packNote } from "@/lib/meds/format";
import { SLOT_NAME, regimenAt, type DateRange } from "@/lib/meds/simulate";
import type { ActionResult, CountRecord, MedicationRecord, MissedDoseRecord, ReserveLogKind, ReserveLogRecord, SupplyRecord } from "@/lib/meds/types";
import { RegimenForm, SupplyForm } from "./forms";
import { ModeTabs, ReserveForms } from "./medication-dialogs";

export function ConfirmDelete({
  title,
  description,
  onConfirm,
  label = "删除",
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<ActionResult>;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} className="text-muted-foreground hover:text-destructive">
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await onConfirm();
                if (r.ok) setOpen(false);
                else toast.error(r.error);
              });
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SectionHeader({ title, hint, onAdd, adding }: { title: string; hint: string; onAdd?: () => void; adding: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {onAdd && (
        <Button size="sm" variant={adding ? "secondary" : "outline"} onClick={onAdd}>
          <PlusIcon />
          新增
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------- supply logs ---------------------------------- */

type StockEntry = { kind: "supply"; r: SupplyRecord } | { kind: "count"; r: CountRecord };

export function SupplyHistory({
  medication,
  today,
  pauses,
  visits,
}: {
  medication: MedicationRecord;
  today: ISODate;
  pauses: readonly DateRange[];
  /** Upcoming visit dates. */
  visits: readonly ISODate[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  // Newest first; on the same day, the later entry first (a count, then what was supplied after it).
  const rows: StockEntry[] = [
    ...medication.supplies.map((r) => ({ kind: "supply" as const, r })),
    ...medication.counts.map((r) => ({ kind: "count" as const, r })),
  ].sort((a, b) => (a.r.date === b.r.date ? b.r.recordedAt - a.r.recordedAt || b.r.id - a.r.id : a.r.date < b.r.date ? 1 : -1));
  const total = medication.supplies.reduce((sum, r) => sum + r.quantity, 0);
  const counts = medication.counts.length;
  // Not being taken: new pills go to the reserve (its own list below).
  const taking = isTaking(intakeAt(medication.regimens, today));

  return (
    <section className="grid content-start gap-3">
      <SectionHeader
        title={counts ? "补药与盘点记录" : "开药 / 补药记录"}
        hint={`补药 ${medication.supplies.length} 次，累计 ${fmtQty(total)} 颗${counts ? ` · 盘点 ${counts} 次` : ""}${taking ? "" : " · 没在吃的药，新补的进储备"}`}
        adding={adding}
        onAdd={
          taking
            ? () => {
                setAdding((v) => !v);
                setEditing(null);
              }
            : undefined
        }
      />
      {adding && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <SupplyForm
            today={today}
            packs={medication.packs}
            plan={{ medication, pauses, visits }}
            submitLabel="添加"
            onSubmit={(f) => addSupply(medication.id, f)}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {rows.length === 0 && !adding && <p className="py-6 text-center text-sm text-muted-foreground">还没有补药记录</p>}
      <ul className="divide-y rounded-lg border">
        {rows.map(({ kind, r }) =>
          kind === "count" ? (
            <CountRow key={`count-${r.id}`} count={r} medication={medication} />
          ) : editing === r.id ? (
            <li key={r.id} className="bg-muted/30 p-3">
              <SupplyForm
                today={today}
                packs={medication.packs}
                initial={{ date: r.date, quantity: r.quantity, packId: r.packId }}
                onSubmit={(f) => updateSupply(r.id, f)}
                onDone={() => setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="tabular-nums">{fmtDate(r.date)}</span>
              {r.date > today && <Badge variant="outline">计划</Badge>}
              {r.fromReserve && <Badge variant="secondary">来自储备</Badge>}
              {medication.packs.length > 1 && r.packId !== null && (
                <span className="truncate text-xs text-muted-foreground">{medication.packs.find((p) => p.id === r.packId)?.brand ?? "未写厂家"}</span>
              )}
              <span className="ml-auto font-medium tabular-nums">+{fmtQty(r.quantity)} 颗</span>
              <div className="flex">
                {r.fromReserve ? (
                  <span className="size-8" aria-hidden />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="编辑"
                    className="text-muted-foreground"
                    onClick={() => {
                      setEditing(r.id);
                      setAdding(false);
                    }}
                  >
                    <PencilIcon />
                  </Button>
                )}
                <ConfirmDelete
                  title="删除这条补药记录？"
                  description={`${fmtDate(r.date)} +${fmtQty(r.quantity)} 颗。删除后余量曲线和耗尽时间会重新计算${r.fromReserve ? "，这些药退回储备" : ""}。`}
                  onConfirm={() => deleteSupply(r.id)}
                />
              </div>
              {r.source && <p className="w-full text-xs break-words text-muted-foreground">来源：{r.source}</p>}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function CountRow({ count, medication }: { count: CountRecord; medication: MedicationRecord }) {
  const pack = medication.packs.length > 1 && count.packId ? medication.packs.find((p) => p.id === count.packId) : undefined;
  const note = packNote(count.quantity, pack ?? medication);
  const whose = medication.packs.length > 1 ? (pack ? (pack.brand ?? "未写厂家") : "全部厂家") : null;
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className="tabular-nums">{fmtDate(count.date)}</span>
      <Badge variant="secondary">盘点</Badge>
      <span className="text-xs text-muted-foreground">
        {COUNT_MOMENT_LABEL[count.slotsDone]}
        {whose && ` · ${whose}`}
      </span>
      <span className="ml-auto grid justify-items-end tabular-nums">
        <span className="font-medium">剩 {fmtQty(count.quantity)} 颗</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
      <div className="flex">
        <span className="size-8" aria-hidden />
        <ConfirmDelete
          title="删除这条盘点？"
          description={`${fmtDate(count.date)} ${COUNT_MOMENT_LABEL[count.slotsDone]}剩 ${fmtQty(count.quantity)} 颗。删除后这天起的余量改回按补药记录和服用规律推算。`}
          onConfirm={() => deleteCount(count.id)}
        />
      </div>
    </li>
  );
}

/* --------------------------------- reserve history -------------------------------- */

const RESERVE_LOG_LABEL: Record<ReserveLogKind, string> = {
  restock: "补进储备",
  draw: "取用到当前",
  count: "盘点",
  transfer: "从当前转入",
  use: "消耗",
  missed: "漏服放入",
};

/** What undoing an entry will do. */
function undoEffect({ kind, delta, regular, timeOfDay }: ReserveLogRecord): string {
  const pills = fmtQty(Math.abs(delta));
  switch (kind) {
    case "restock":
      return `储备减少 ${pills} 颗。`;
    case "draw":
      return `${pills} 颗退回储备，对应的那笔补药记录一起删除，余量重新计算。`;
    case "count":
      return `储备${delta > 0 ? "减少" : "增加"} ${pills} 颗，回到这次盘点之前的数。`;
    case "transfer":
      return `${pills} 颗从储备退回当前余量。`;
    case "use":
      return regular && timeOfDay ? `${pills} 颗退回储备，${SLOT_NAME[timeOfDay]}这一顿重新从当前余量扣。` : `${pills} 颗退回储备。`;
    case "missed":
      return `储备减少 ${pills} 颗，对应的漏服记录一起删除：那一顿按已经吃了算。`;
  }
}

const HISTORY_TABS = [
  ["restock", "补进储备"],
  ["use", "消耗储备"],
] as const;

/** "近 30 天服用 3 次，共 4 颗" (已服用 through today), or null when none. */
function takenLately(logs: readonly ReserveLogRecord[], today: ISODate): string | null {
  const from = addDays(today, -29);
  const taken = logs.filter((l) => l.reason === "taken" && l.date >= from && l.date <= today);
  if (!taken.length) return null;
  return `近 30 天服用 ${taken.length} 次，共 ${fmtQty(taken.reduce((n, l) => n - l.delta, 0))} 颗`;
}

/** Every recorded change to the reserve, newest first, each one undoable. */
export function ReserveHistory({ medication, today }: { medication: MedicationRecord; today: ISODate }) {
  const [adding, setAdding] = useState(false);
  const [addTab, setAddTab] = useState<"restock" | "use">("restock");
  // Nothing to use up when the reserve is empty.
  const tab = medication.reserve > 0 ? addTab : "restock";
  const rows = [...medication.reserveLogs].sort((a, b) => (a.date === b.date ? b.recordedAt - a.recordedAt || b.id - a.id : a.date < b.date ? 1 : -1));
  return (
    <section className="grid content-start gap-3">
      <SectionHeader
        title="储备记录"
        hint={[`现有储备 ${fmtQty(medication.reserve)} 颗`, takenLately(medication.reserveLogs, today)].filter(Boolean).join(" · ")}
        adding={adding}
        onAdd={() => setAdding((v) => !v)}
      />
      {adding && (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
          {medication.reserve > 0 && <ModeTabs label="储备记录类型" tabs={HISTORY_TABS} value={tab} onChange={setAddTab} />}
          <ReserveForms key={tab} medication={medication} tab={tab} today={today} onDone={() => setAdding(false)} />
        </div>
      )}
      {rows.length === 0 && !adding && (
        <p className="py-6 text-center text-sm text-muted-foreground">还没有储备记录{medication.reserve > 0 ? "（现有的储备是早先录入的，没有明细）" : ""}</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => {
            const change = `${r.delta > 0 ? "+" : "−"}${fmtQty(Math.abs(r.delta))} 颗`;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="tabular-nums">{fmtDate(r.date)}</span>
                <Badge variant="secondary">{RESERVE_LOG_LABEL[r.kind]}</Badge>
                {r.reason && <Badge variant="outline">{RESERVE_USE_REASON[r.reason].label}</Badge>}
                {r.timeOfDay && (
                  <span className="text-xs text-muted-foreground">
                    {SLOT_NAME[r.timeOfDay]}
                    {r.regular && "（按规律的这一顿）"}
                  </span>
                )}
                {medication.packs.length > 1 && (
                  <span className="truncate text-xs text-muted-foreground">{medication.packs.find((p) => p.id === r.packId)?.brand ?? "未写厂家"}</span>
                )}
                <span className="ml-auto font-medium tabular-nums">{change}</span>
                <ConfirmDelete
                  title={`撤销这条“${RESERVE_LOG_LABEL[r.kind]}”？`}
                  description={`${fmtDate(r.date)} ${change}。${undoEffect(r)}`}
                  label="撤销"
                  onConfirm={() => deleteReserveLog(r.id)}
                />
                {r.source && <p className="w-full text-xs break-words text-muted-foreground">来源：{r.source}</p>}
                {r.note && <p className="w-full text-xs break-words text-muted-foreground">备注：{r.note}</p>}
                {r.missedDoseId !== null && <MissedNote miss={medication.misses.find((x) => x.id === r.missedDoseId)} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MissedNote({ miss }: { miss: MissedDoseRecord | undefined }) {
  if (!miss) return null;
  return (
    <p className="w-full text-xs text-muted-foreground">
      {fmtDate(miss.date)} {SLOT_NAME[miss.slot]}没吃的药
    </p>
  );
}

/* -------------------------------- regimen timeline ------------------------------- */

export function RegimenTimeline({ medication, today }: { medication: MedicationRecord; today: ISODate }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const asc = [...medication.regimens].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const current = regimenAt(medication.regimens, today);
  const rows = asc
    .map((r, i) => ({ ...r, until: i + 1 < asc.length ? addDays(asc[i + 1].effectiveFrom, -1) : null }))
    .reverse();

  return (
    <section className="grid content-start gap-3">
      <SectionHeader
        title="服用规律时间轴"
        hint="每条规律只从生效日起计算，不影响之前的日期"
        adding={adding}
        onAdd={() => {
          setAdding((v) => !v);
          setEditing(null);
        }}
      />
      {adding && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <RegimenForm
            today={today}
            initial={current ? { morning: current.morning, noon: current.noon, evening: current.evening } : undefined}
            existing={medication.regimens}
            reservePacks={medication.packs}
            submitLabel="添加"
            onSubmit={(f, draws) => saveRegimen(medication.id, f, draws)}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {rows.length === 0 && !adding && <p className="py-6 text-center text-sm text-muted-foreground">还没有设置服用规律</p>}
      <ol className="grid gap-2">
        {rows.map((r) => {
          const state = r.effectiveFrom > today ? "future" : r.id === current?.id ? "current" : "past";
          return (
            <li
              key={r.id}
              className={`relative rounded-lg border p-3 ${state === "current" ? "border-primary/40 bg-primary/5" : ""}`}
            >
              {editing === r.id ? (
                <RegimenForm
                  today={today}
                  initial={r}
                  existing={medication.regimens}
                  editingId={r.id}
                  reservePacks={medication.packs}
                  onSubmit={(f, draws) => updateRegimen(r.id, f, draws)}
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex items-start gap-3">
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm tabular-nums">
                        {fmtDate(r.effectiveFrom)} 起{r.until ? ` ~ ${fmtDate(r.until)}` : ""}
                      </span>
                      {state === "current" && <Badge>当前生效</Badge>}
                      {state === "future" && <Badge variant="outline">未来生效</Badge>}
                      {state === "past" && <Badge variant="secondary">历史阶段</Badge>}
                    </div>
                    <span className="text-sm font-medium tabular-nums">{formatRegimen(r)}</span>
                  </div>
                  <div className="ml-auto flex">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="编辑"
                      className="text-muted-foreground"
                      onClick={() => {
                        setEditing(r.id);
                        setAdding(false);
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <ConfirmDelete
                      title="删除这条服用规律？"
                      description={`${fmtDate(r.effectiveFrom)} 起：${formatRegimen(r)}。删除后这段时间将沿用上一条规律（若没有则视为不服药）。`}
                      onConfirm={() => deleteRegimen(r.id)}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
