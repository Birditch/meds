"use client";

import { ChartSplineIcon, PillIcon, PlusIcon, SettingsIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useClock, type Clock } from "@/hooks/use-clock";
import { describeShortfall, fmtQty, formatRegimen, medicationStatus, type MedicationStatus } from "@/lib/meds/format";
import type { MedicationRecord } from "@/lib/meds/types";
import { DetailDialog } from "./detail-dialog";
import { AddSupplyDialog, CreateMedicationDialog, RegimenDialog } from "./medication-dialogs";
import { StatusBadge, toneText } from "./status-badge";

type Panel = { kind: "supply" | "regimen" | "detail"; id: number } | null;

export function Board({ medications, serverClock }: { medications: MedicationRecord[]; serverClock: Clock }) {
  const clock = useClock(serverClock);
  const { date, slotsDone } = clock.moment;
  const now = useMemo(() => ({ date, slotsDone }), [date, slotsDone]);
  const [creating, setCreating] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);

  const statuses = useMemo(
    () => new Map(medications.map((m) => [m.id, medicationStatus(m.supplies, m.regimens, now)])),
    [medications, now],
  );

  const open = (kind: NonNullable<Panel>["kind"]) => (panel?.kind === kind ? medications.find((m) => m.id === panel.id) ?? null : null);
  const close = (o: boolean) => !o && setPanel(null);
  const detail = open("detail");

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          今天 {clock.date} · 共 {medications.length} 种药
        </p>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon />
          新增药品
        </Button>
      </div>

      {medications.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <PillIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">还没有药品。添加第一种药，开始推算余量和吃完时间。</p>
          <Button variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon />
            新增药品
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {medications.map((m) => (
            <MedicationCard
              key={m.id}
              medication={m}
              status={statuses.get(m.id)!}
              onSupply={() => setPanel({ kind: "supply", id: m.id })}
              onRegimen={() => setPanel({ kind: "regimen", id: m.id })}
              onDetail={() => setPanel({ kind: "detail", id: m.id })}
            />
          ))}
        </div>
      )}

      <CreateMedicationDialog open={creating} onOpenChange={setCreating} today={clock.date} />
      <AddSupplyDialog medication={open("supply")} onOpenChange={close} today={clock.date} />
      <RegimenDialog medication={open("regimen")} onOpenChange={close} today={clock.date} />
      <DetailDialog
        medication={detail}
        status={detail ? statuses.get(detail.id) ?? null : null}
        now={now}
        onOpenChange={close}
      />
    </>
  );
}

function MedicationCard({
  medication,
  status,
  onSupply,
  onRegimen,
  onDetail,
}: {
  medication: MedicationRecord;
  status: MedicationStatus;
  onSupply: () => void;
  onRegimen: () => void;
  onDetail: () => void;
}) {
  const { conclusion, shortfall } = status;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-lg">{medication.name}</CardTitle>
        <CardDescription>{[medication.brand, medication.dosage].filter(Boolean).join(" · ")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">当前规律</span>
          <span className="text-right tabular-nums">{formatRegimen(status.current)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">今日当前剩余</span>
          <span className="text-xl font-semibold tabular-nums">{fmtQty(status.balanceNow)} 颗</span>
        </div>
        <div className="grid gap-1.5 rounded-lg bg-muted/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">预计吃完</span>
            <StatusBadge conclusion={conclusion} />
          </div>
          {conclusion.detail && <p className={`text-right text-xs ${toneText[conclusion.tone]}`}>{conclusion.detail}</p>}
          {conclusion.partialNote && <p className="text-right text-xs text-muted-foreground">{conclusion.partialNote}</p>}
        </div>
        {shortfall && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
            {describeShortfall(shortfall)}
          </p>
        )}
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onSupply}>
          <PlusIcon />
          补药
        </Button>
        <Button size="sm" variant="outline" onClick={onRegimen}>
          <SettingsIcon />
          改规律
        </Button>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={onDetail}>
          <ChartSplineIcon />
          详情 / 曲线
        </Button>
      </CardFooter>
    </Card>
  );
}
