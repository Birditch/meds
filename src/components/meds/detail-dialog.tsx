"use client";

import { PencilIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteMedication } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { addDays, fmtDate, weekdayCN, type ISODate } from "@/lib/meds/dates";
import {
  COUNT_MOMENT_LABEL,
  describeReserve,
  describeShortfall,
  fmtQty,
  formatRegimen,
  hasRecords,
  packNote,
  packShares,
  type MedicationStatus,
} from "@/lib/meds/format";
import type { DateRange, Moment } from "@/lib/meds/simulate";
import type { MedicationRecord } from "@/lib/meds/types";
import { visitOrdinal } from "@/lib/meds/visits";
import { ConfirmDelete, RegimenTimeline, ReserveHistory, SupplyHistory } from "./history";
import { MissedDoseHistory } from "./missed-doses";
import { keepDialogForSuggestions } from "./catalog-fields";
import { EditMedicationForm, ReservePanel } from "./medication-dialogs";
import { PackAmounts, PacksPanel } from "./packs";
import { StatusBadge, toneText } from "./status-badge";
import { StockChart } from "./stock-chart";
import { DialogStrengthTabs, type StrengthSwitch } from "./strength-tabs";
import { TagBadges } from "./tags";


function Stat({ label, children, sub }: { label: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-base font-semibold tabular-nums">{children}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function DetailDialog({
  medication,
  status,
  now,
  visits,
  stays,
  onOpenChange,
  onPick,
  ...switcher
}: StrengthSwitch & {
  medication: MedicationRecord | null;
  status: MedicationStatus | null;
  now: Moment;
  /** Upcoming visit dates. */
  visits: readonly ISODate[];
  stays: readonly DateRange[];
  onOpenChange: (open: boolean) => void;
}) {
  const [panel, setPanel] = useState<"edit" | "reserve" | null>(null);
  const toggle = (p: "edit" | "reserve") => setPanel((v) => (v === p ? null : p));
  const lastCount = medication?.counts.filter((c) => c.date <= now.date).at(-1) ?? null;
  const multi = (medication?.packs.length ?? 0) > 1;
  const shares = medication && status ? packShares(medication, status) : [];

  return (
    <Dialog
      open={!!medication}
      onOpenChange={(o) => {
        if (!o) setPanel(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-6xl" onEscapeKeyDown={keepDialogForSuggestions}>
        {medication && status && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-2 pr-8">
                <div className="grid gap-1">
                  <DialogTitle className="text-xl">
                    {medication.name} <span className="font-normal text-muted-foreground">{medication.dosage}</span>
                  </DialogTitle>
                  <DialogDescription asChild>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{medication.packs.map((p) => p.brand ?? "未写厂家").join(" / ")}</span>
                      <TagBadges tags={medication.tags} />
                      {medication.tags.length === 0 && (
                        <button type="button" className="text-xs underline-offset-4 hover:underline" onClick={() => toggle("edit")}>
                          加标签
                        </button>
                      )}
                    </div>
                  </DialogDescription>
                </div>
                <div className="ml-auto flex">
                  <Button variant="ghost" size="icon-sm" aria-label="编辑药品信息" onClick={() => toggle("edit")}>
                    <PencilIcon />
                  </Button>
                  <ConfirmDelete
                    title={`删除「${medication.name}」？`}
                    description="药品及其全部补药记录、服用规律、储备都会被删除，无法恢复。"
                    label="删除药品"
                    onConfirm={async () => {
                      const r = await deleteMedication(medication.id);
                      if (r.ok) {
                        toast.success(`已删除「${medication.name}」`);
                        onOpenChange(false);
                      }
                      return r;
                    }}
                  />
                </div>
              </div>
              <DialogStrengthTabs
                medication={medication}
                {...switcher}
                onPick={
                  onPick &&
                  ((id) => {
                    setPanel(null);
                    onPick(id);
                  })
                }
              />
            </DialogHeader>

            {panel === "edit" && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <EditMedicationForm key={medication.id} medication={medication} onDone={() => setPanel(null)} />
              </div>
            )}

            <div className={`grid gap-3 sm:grid-cols-2 ${hasRecords(status) ? "lg:grid-cols-5" : "lg:grid-cols-3"}`}>
              <Stat
                label="当前剩余"
                sub={
                  <>
                    {multi ? (
                      <PackAmounts shares={shares} of="stock" className="grid" />
                    ) : (
                      packNote(status.balanceNow, medication) && <div>{packNote(status.balanceNow, medication)}</div>
                    )}
                    {fmtDate(now.date)} · {COUNT_MOMENT_LABEL[now.slotsDone]}
                    {lastCount && (
                      <div>
                        按 {fmtDate(lastCount.date)} {COUNT_MOMENT_LABEL[lastCount.slotsDone]}盘点
                        {multi && lastCount.packId ? `（${medication.packs.find((p) => p.id === lastCount.packId)?.brand ?? "未写厂家"}）` : ""}的{" "}
                        {fmtQty(lastCount.quantity)} 颗推算
                      </div>
                    )}
                  </>
                }
              >
                {fmtQty(status.balanceNow)} 颗
              </Stat>
              <Stat label="当前规律" sub={status.current ? `${fmtDate(status.current.effectiveFrom)} 起生效` : undefined}>
                <span className="text-sm">{formatRegimen(status.current)}</span>
              </Stat>
              <div className="grid content-start gap-1 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">药物储备（不计入余量）</span>
                  <Button size="xs" variant={panel === "reserve" ? "secondary" : "ghost"} onClick={() => toggle("reserve")}>
                    管理
                  </Button>
                </div>
                <div className="text-base font-semibold tabular-nums">{fmtQty(medication.reserve)} 颗</div>
                <div className="text-xs text-muted-foreground">
                  {multi ? (
                    <PackAmounts shares={shares} of="reserve" className="grid" />
                  ) : (
                    packNote(medication.reserve, medication) && <div>{packNote(medication.reserve, medication)}</div>
                  )}
                  {describeReserve(medication.reserve, status.current)}
                </div>
              </div>
              {hasRecords(status) && (
                <div className="grid content-start gap-1 rounded-lg border p-3 sm:col-span-2">
                  <span className="text-xs text-muted-foreground">能吃到（最后一个早中晚都吃满的日子）</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge conclusion={status.conclusion} />
                    {status.conclusion.detail && (
                      <span className={`text-xs ${toneText[status.conclusion.tone]}`}>{status.conclusion.detail}</span>
                    )}
                  </div>
                  <div className="text-sm font-medium">{status.conclusion.headline}</div>
                  {status.conclusion.extraNote && (
                    <div className="text-xs text-muted-foreground">{status.conclusion.extraNote}</div>
                  )}
                </div>
              )}
            </div>

            {panel === "reserve" && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <ReservePanel key={medication.id} medication={medication} status={status} today={now.date} onDone={() => setPanel(null)} />
              </div>
            )}

            <PacksPanel key={medication.id} medication={medication} status={status} />

            {status.shortfall && (
              <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <TriangleAlertIcon className="size-4 shrink-0" />
                中途断药：{describeShortfall(status.shortfall)}
              </p>
            )}

            {status.plan.visits.length > 0 && (
              <div className="grid gap-1.5 rounded-lg border p-3 text-sm">
                <span className="text-xs text-muted-foreground">就诊开药（不动用储备）</span>
                {status.plan.beforeFirst && (
                  <p className="text-amber-800 dark:text-amber-300">
                    等不到下次就诊：{fmtDate(status.plan.beforeFirst.from.date)} 起断药，就诊前还缺{" "}
                    {fmtQty(status.plan.beforeFirst.shortfall)} 颗；
                    {status.plan.beforeFirst.latestVisit
                      ? `要不动用储备，最晚 ${fmtDate(status.plan.beforeFirst.latestVisit)} 就诊。`
                      : "断药前已没有周四可以就诊，需要提前加诊。"}
                  </p>
                )}
                <ul className="grid gap-1">
                  {status.plan.visits.map((v, i) => (
                    <li key={v.date} className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
                      <span className="w-12 text-muted-foreground">{visitOrdinal(i)}</span>
                      <span>{fmtDate(v.date)}</span>
                      <span className="text-muted-foreground">
                        {v.date === now.date ? "现在" : `${weekdayCN(addDays(v.date, -1))}晚`}剩 {fmtQty(v.stockBefore)} 颗
                        {packNote(v.stockBefore, medication) && `（${packNote(v.stockBefore, medication)}）`}
                      </span>
                      <span className="ml-auto">
                        {v.need === 0 ? (
                          <span className="text-muted-foreground">无需开药</span>
                        ) : (
                          <>
                            需开 <b>{v.packs !== null ? `${v.packs} ${medication.packUnit}` : `${fmtQty(v.need)} 颗`}</b>
                            {v.packs !== null && <span className="text-muted-foreground">（缺 {fmtQty(v.need)} 颗）</span>}
                          </>
                        )}
                        <span className="text-muted-foreground">
                          {" "}
                          · 吃到 {fmtDate(v.coverUntil)} 晚{v.estimated ? "（估算）" : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {status.sim.days.length > 0 ? (
              <StockChart sim={status.sim} now={now} balanceNow={status.balanceNow} visits={visits} stays={stays} />
            ) : (
              <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                添加补药记录和服用规律后，这里会画出余量曲线
              </p>
            )}

            <Separator />

            <div className="grid gap-6 md:grid-cols-2">
              <div className="grid content-start gap-6">
                <SupplyHistory medication={medication} today={now.date} pauses={stays} visits={visits} />
                <ReserveHistory medication={medication} today={now.date} />
              </div>
              <div className="grid content-start gap-6">
                <RegimenTimeline medication={medication} today={now.date} />
                <MissedDoseHistory medication={medication} status={status} now={now} />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
