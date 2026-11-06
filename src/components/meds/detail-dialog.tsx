"use client";

import { PencilIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteMedication } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { describeShortfall, fmtQty, formatRegimen, type MedicationStatus } from "@/lib/meds/format";
import type { Moment } from "@/lib/meds/simulate";
import type { MedicationRecord } from "@/lib/meds/types";
import { ConfirmDelete, RegimenTimeline, SupplyHistory } from "./history";
import { EditMedicationForm } from "./medication-dialogs";
import { StatusBadge, toneText } from "./status-badge";
import { StockChart } from "./stock-chart";

const momentLabel = ["今日服药前", "早上服药后", "中午服药后", "晚上服药后"] as const;

function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
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
  onOpenChange,
}: {
  medication: MedicationRecord | null;
  status: MedicationStatus | null;
  now: Moment;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Dialog
      open={!!medication}
      onOpenChange={(o) => {
        if (!o) setEditing(false);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-6xl">
        {medication && status && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-2 pr-8">
                <div className="grid gap-1">
                  <DialogTitle className="text-xl">{medication.name}</DialogTitle>
                  <DialogDescription>
                    {[medication.brand, medication.dosage].filter(Boolean).join(" · ")}
                  </DialogDescription>
                </div>
                <div className="ml-auto flex">
                  <Button variant="ghost" size="icon-sm" aria-label="编辑药品信息" onClick={() => setEditing((v) => !v)}>
                    <PencilIcon />
                  </Button>
                  <ConfirmDelete
                    title={`删除「${medication.name}」？`}
                    description="药品及其全部补药记录、服用规律都会被删除，无法恢复。"
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
            </DialogHeader>

            {editing && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <EditMedicationForm key={medication.id} medication={medication} onDone={() => setEditing(false)} />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="当前剩余" sub={`${now.date} · ${momentLabel[now.slotsDone]}`}>
                {fmtQty(status.balanceNow)} 颗
              </Stat>
              <Stat label="当前规律" sub={status.current ? `${status.current.effectiveFrom} 起生效` : undefined}>
                <span className="text-sm">{formatRegimen(status.current)}</span>
              </Stat>
              <div className="grid content-start gap-1 rounded-lg border p-3 sm:col-span-2">
                <span className="text-xs text-muted-foreground">最终预计耗尽</span>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge conclusion={status.conclusion} />
                  {status.conclusion.detail && (
                    <span className={`text-xs ${toneText[status.conclusion.tone]}`}>{status.conclusion.detail}</span>
                  )}
                </div>
                <div className="text-sm font-medium">{status.conclusion.headline}</div>
              </div>
            </div>

            {status.shortfall && (
              <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <TriangleAlertIcon className="size-4 shrink-0" />
                中途断药：{describeShortfall(status.shortfall)}
              </p>
            )}

            {status.sim.days.length > 0 ? (
              <StockChart sim={status.sim} now={now} balanceNow={status.balanceNow} />
            ) : (
              <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                添加补药记录和服用规律后，这里会画出余量曲线
              </p>
            )}

            <Separator />

            <div className="grid gap-6 md:grid-cols-2">
              <SupplyHistory medication={medication} today={now.date} />
              <RegimenTimeline medication={medication} today={now.date} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
