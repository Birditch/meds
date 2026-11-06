"use client";

import { ChartSplineIcon, ClipboardListIcon, PillIcon, PlusIcon, SearchIcon, SettingsIcon, TagIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useClock, type Clock } from "@/hooks/use-clock";
import { fmtDate } from "@/lib/meds/dates";
import {
  describeReserve,
  describeShortfall,
  fmtQty,
  formatRegimen,
  medicationStatus,
  packNote,
  type MedicationStatus,
} from "@/lib/meds/format";
import { searchMedications } from "@/lib/meds/search";
import type { MedicationRecord, StayRecord, VisitRecord } from "@/lib/meds/types";
import { cn } from "@/lib/utils";
import { scheduleVisits } from "@/lib/meds/visits";
import { BulkImportDialog } from "./bulk-import";
import { DetailDialog } from "./detail-dialog";
import { ExportMenu } from "./export-menu";
import { AddSupplyDialog, CreateMedicationDialog, RegimenDialog, ReserveDialog } from "./medication-dialogs";
import { StatusBadge, toneText } from "./status-badge";
import { HospitalStays } from "./stays";
import { VisitPlan } from "./visit-plan";

type Panel = { kind: "supply" | "regimen" | "reserve" | "detail"; id: number } | null;

export function Board({
  medications,
  visits,
  stays,
  serverClock,
}: {
  medications: MedicationRecord[];
  visits: VisitRecord[];
  stays: StayRecord[];
  serverClock: Clock;
}) {
  const clock = useClock(serverClock);
  const { date, slotsDone } = clock.moment;
  const now = useMemo(() => ({ date, slotsDone }), [date, slotsDone]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");
  const [onlyNoPerBox, setOnlyNoPerBox] = useState(false);

  const schedule = useMemo(() => scheduleVisits(visits, date), [visits, date]);
  const pauses = useMemo(() => stays.map((s) => ({ start: s.startDate, end: s.endDate })), [stays]);
  const upcoming = useMemo(() => schedule.map((s) => s.date), [schedule]);
  const statuses = useMemo(
    () =>
      new Map(
        medications.map((m) => [m.id, medicationStatus(m.supplies, m.regimens, now, schedule, { pauses, perBox: m.perBox, counts: m.counts })]),
      ),
    [medications, now, schedule, pauses],
  );
  const noPerBox = medications.filter((m) => !m.perBox).length;
  const filterNoPerBox = onlyNoPerBox && noPerBox > 0;
  const shown = useMemo(
    () => searchMedications(filterNoPerBox ? medications.filter((m) => !m.perBox) : medications, query),
    [medications, query, filterNoPerBox],
  );

  const open = (kind: NonNullable<Panel>["kind"]) => (panel?.kind === kind ? medications.find((m) => m.id === panel.id) ?? null : null);
  const close = (o: boolean) => !o && setPanel(null);
  const detail = open("detail");

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          今天 {fmtDate(clock.date)}（北京时间）· 共 {medications.length} 种药
        </p>
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          {medications.length > 0 && (
            <div className="relative flex-1 sm:w-72 sm:flex-none">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="搜索药品"
                placeholder="搜索药品：名称、品牌、规格或拼音"
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <Button variant="outline" onClick={() => setImporting(true)}>
            <ClipboardListIcon />
            一键录入
          </Button>
          {medications.length > 0 && <ExportMenu nextVisit={upcoming[0] ?? null} />}
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            新增药品
          </Button>
        </div>
      </div>

      {noPerBox > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            aria-pressed={filterNoPerBox}
            onClick={() => setOnlyNoPerBox((v) => !v)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 transition-colors",
              filterNoPerBox ? noPerBoxTag : "hover:bg-muted",
            )}
          >
            <TagIcon className="size-3" />
            未写明每盒颗数 {noPerBox} 种
            {filterNoPerBox && <XIcon className="size-3" />}
          </button>
          <span>这些药没法换算成盒数，就诊时只能按颗开；可在“一键录入”里补上。</span>
        </div>
      )}

      {medications.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <PillIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">还没有药品。添加第一种药，开始推算余量和吃完时间。</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>
              <ClipboardListIcon />
              一键录入清单
            </Button>
            <Button variant="outline" onClick={() => setCreating(true)}>
              <PlusIcon />
              新增药品
            </Button>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {query.trim() ? `没有和“${query.trim()}”匹配的药品` : "没有符合筛选的药品"}
            {filterNoPerBox && "（只看未写明每盒颗数的）"}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("");
              setOnlyNoPerBox(false);
            }}
          >
            清除搜索和筛选
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((m) => (
            <MedicationCard
              key={m.id}
              medication={m}
              status={statuses.get(m.id)!}
              onSupply={() => setPanel({ kind: "supply", id: m.id })}
              onRegimen={() => setPanel({ kind: "regimen", id: m.id })}
              onReserve={() => setPanel({ kind: "reserve", id: m.id })}
              onDetail={() => setPanel({ kind: "detail", id: m.id })}
            />
          ))}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <VisitPlan visits={visits} medications={medications} statuses={statuses} today={date} className="lg:col-span-2" />
        <HospitalStays stays={stays} today={date} />
      </div>

      <CreateMedicationDialog open={creating} onOpenChange={setCreating} today={clock.date} />
      <BulkImportDialog open={importing} onOpenChange={setImporting} medications={medications} statuses={statuses} now={now} />
      <AddSupplyDialog medication={open("supply")} onOpenChange={close} today={clock.date} pauses={pauses} visits={upcoming} />
      <RegimenDialog medication={open("regimen")} onOpenChange={close} today={clock.date} />
      <ReserveDialog medication={open("reserve")} onOpenChange={close} today={clock.date} />
      <DetailDialog
        medication={detail}
        status={detail ? statuses.get(detail.id) ?? null : null}
        now={now}
        visits={upcoming}
        stays={pauses}
        onOpenChange={close}
      />
    </>
  );
}

const noPerBoxTag =
  "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="grid justify-items-end text-right tabular-nums">{children}</div>
    </div>
  );
}

function MedicationCard({
  medication,
  status,
  onSupply,
  onRegimen,
  onReserve,
  onDetail,
}: {
  medication: MedicationRecord;
  status: MedicationStatus;
  onSupply: () => void;
  onRegimen: () => void;
  onReserve: () => void;
  onDetail: () => void;
}) {
  const { conclusion, shortfall } = status;
  const next = status.plan.visits[0];
  const balanceNote = packNote(status.balanceNow, medication);
  const reserveNote = packNote(medication.reserve, medication);
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">{medication.name}</CardTitle>
          {!medication.perBox && (
            <Badge variant="outline" className={noPerBoxTag} title="没有每盒颗数：就诊时只能按颗算，无法换算成盒数">
              <TagIcon />
              未写明每{medication.packUnit}颗数
            </Badge>
          )}
        </div>
        <CardDescription>
          {[medication.brand, medication.dosage, medication.perBox && `${fmtQty(medication.perBox)} 颗/${medication.packUnit}`]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <Row label="当前规律">{formatRegimen(status.current)}</Row>
        <Row label="今日当前剩余">
          <span className="text-xl font-semibold">{fmtQty(status.balanceNow)} 颗</span>
          {balanceNote && <span className="text-xs text-muted-foreground">{balanceNote}</span>}
        </Row>
        <div className="grid gap-1.5 rounded-lg bg-muted/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">能吃到</span>
            <StatusBadge conclusion={conclusion} />
          </div>
          {conclusion.detail && <p className={`text-right text-xs ${toneText[conclusion.tone]}`}>{conclusion.detail}</p>}
          {conclusion.extraNote && <p className="text-right text-xs text-muted-foreground">{conclusion.extraNote}</p>}
        </div>
        <Row
          label={
            <span className="inline-flex items-center gap-1">
              药物储备
              <Button size="xs" variant="ghost" className="h-5 px-1.5 text-muted-foreground" onClick={onReserve}>
                管理
              </Button>
            </span>
          }
        >
          <span>{fmtQty(medication.reserve)} 颗</span>
          {reserveNote && <span className="text-xs text-muted-foreground">{reserveNote}</span>}
          {medication.reserve > 0 && (
            <span className="text-xs text-muted-foreground">{describeReserve(medication.reserve, status.current)}</span>
          )}
        </Row>
        {next && (
          <Row label={`下次就诊 ${fmtDate(next.date)}`}>
            {next.need === 0 ? (
              <span className="text-muted-foreground">无需开药</span>
            ) : (
              <>
                <b>需开 {next.packs !== null ? `${next.packs} ${medication.packUnit}` : `${fmtQty(next.need)} 颗`}</b>
                {next.packs !== null && <span className="text-xs text-muted-foreground">缺 {fmtQty(next.need)} 颗</span>}
              </>
            )}
          </Row>
        )}
        {status.plan.beforeFirst && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
            等不到下次就诊：就诊前还缺 {fmtQty(status.plan.beforeFirst.shortfall)} 颗
            {status.plan.beforeFirst.latestVisit ? `，最晚 ${fmtDate(status.plan.beforeFirst.latestVisit)} 就诊` : "，需提前加诊"}
          </p>
        )}
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
