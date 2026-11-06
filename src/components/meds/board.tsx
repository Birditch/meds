"use client";

import { ArchiveIcon, ChartSplineIcon, ClipboardListIcon, PillIcon, PlusIcon, SearchIcon, SettingsIcon, TagIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/meds/dates";
import {
  describeReserve,
  describeShortfall,
  fmtQty,
  formatRegimen,
  intakeLabel,
  isTaking,
  packNote,
  type Intake,
  type MedicationStatus,
} from "@/lib/meds/format";
import { searchMedications } from "@/lib/meds/search";
import { drugKey } from "@/lib/meds/similar";
import { sortTags, tagLabel } from "@/lib/meds/tags";
import type { MedicationRecord } from "@/lib/meds/types";
import { cn } from "@/lib/utils";
import { daysFromToday } from "@/lib/meds/visits";
import { BulkImportDialog } from "./bulk-import";
import { DetailDialog } from "./detail-dialog";
import { useHasImportDraft } from "./import-draft";
import { AddSupplyDialog, CreateMedicationDialog, RegimenDialog, ReserveDialog } from "./medication-dialogs";
import { PageTitle } from "./page-title";
import { packLabel } from "./forms";
import { StatusBadge, toneText } from "./status-badge";
import { TONE_CLASS, TagBadges } from "./tags";
import { useMeds, type MedsData } from "./use-meds";

type Panel = { kind: "supply" | "regimen" | "reserve" | "detail"; id: number } | null;

/** 在吃 / 未在吃, kept in the URL (`?tab=inactive`) so it survives a reload and can be linked. */
type Tab = "active" | "inactive";
const TAB_LABEL: Record<Tab, string> = { active: "在吃", inactive: "未在吃" };

function tabHref(tab: Tab, search: string) {
  const params = new URLSearchParams(search);
  if (tab === "inactive") params.set("tab", "inactive");
  else params.delete("tab");
  const q = params.toString();
  return q ? `?${q}` : "/";
}

/** 药品: every medication's card, 在吃 first, with the dialogs that record supplies, regimens and counts. */
export function Board(data: MedsData) {
  const { medications } = data;
  const { clock, now, pauses, upcoming, statuses, intakes, taking, notTaking } = useMeds(data);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");
  const [onlyNoPerBox, setOnlyNoPerBox] = useState(false);
  const [onlyTag, setOnlyTag] = useState<string | null>(null);
  const hasImportDraft = useHasImportDraft();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "inactive" ? "inactive" : "active";
  // The history API is wired into the router: useSearchParams follows without a server round trip.
  const showTab = (t: Tab) => window.history.pushState(null, "", tabHref(t, window.location.search));

  const nextVisit = upcoming[0];
  const gaps = taking.filter((m) => statuses.get(m.id)?.plan.beforeFirst).length;
  const inTab = tab === "active" ? taking : notTaking;

  const noPerBox = inTab.filter((m) => !m.perBox).length;
  const filterNoPerBox = onlyNoPerBox && noPerBox > 0;
  // Every tag in use, with how many medications of this tab carry it.
  const tagCounts = sortTags(medications.flatMap((m) => m.tags)).map((t) => [t, inTab.filter((m) => m.tags.includes(t)).length] as const);
  const filterTag = onlyTag && medications.some((m) => m.tags.includes(onlyTag)) ? onlyTag : null;
  const filtering = filterNoPerBox || filterTag !== null || query.trim() !== "";
  const match = (list: MedicationRecord[]) =>
    groupByDrug(
      searchMedications(
        list.filter((m) => (!filterNoPerBox || !m.perBox) && (!filterTag || m.tags.includes(filterTag))),
        query,
      ),
      query.trim() === "",
    );
  const matches = { active: match(taking), inactive: match(notTaking) };
  const shown = matches[tab];
  const other: Tab = tab === "active" ? "inactive" : "active";

  const open = (kind: NonNullable<Panel>["kind"]) => (panel?.kind === kind ? medications.find((m) => m.id === panel.id) ?? null : null);
  const close = (o: boolean) => !o && setPanel(null);
  const detail = open("detail");

  return (
    <>
      <PageTitle
        title="药品"
        description={
          <span className="tabular-nums">
            今天 {fmtDate(clock.date)}（北京时间）· 共 {medications.length} 种药 ·{" "}
            <Link href="/visits" className="underline-offset-4 hover:text-foreground hover:underline">
              {nextVisit ? `下次就诊 ${fmtDate(nextVisit)}（${daysFromToday(nextVisit, clock.date)}）` : "还没安排下次就诊"}
            </Link>
            {gaps > 0 && (
              <Link href="/visits" className="ml-2 inline-flex items-center gap-1 text-amber-700 underline-offset-4 hover:underline dark:text-amber-400">
                <TriangleAlertIcon className="size-3.5" />
                {gaps} 种药等不到下次就诊
              </Link>
            )}
          </span>
        }
      >
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
        <Button variant="outline" onClick={() => setImporting(true)} title={hasImportDraft ? "有没提交的录入内容，打开即可继续" : undefined}>
          <ClipboardListIcon />
          一键录入
          {hasImportDraft && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              草稿
            </Badge>
          )}
        </Button>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon />
          新增药品
        </Button>
      </PageTitle>

      {medications.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div role="tablist" aria-label="按是否在吃分开显示" className="inline-flex rounded-lg border p-0.5 text-sm">
            {(["active", "inactive"] as const).map((t) => (
              <a
                key={t}
                role="tab"
                aria-selected={tab === t}
                href={tabHref(t, searchParams.toString())}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  showTab(t);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1 transition-colors",
                  tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABEL[t]}
                <span className={cn("text-xs tabular-nums", tab === t ? "opacity-80" : "")}>
                  {filtering ? matches[t].length : t === "active" ? taking.length : notTaking.length}
                </span>
              </a>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {tab === "active"
              ? "当前按规律在吃的药（含之后才开始吃的）。"
              : "已停药或没设服用规律的药：不消耗、不需要开药。改规律后会自动回到“在吃”。"}
          </p>
        </div>
      )}

      {tagCounts.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="按标签筛选">
          <span className="text-muted-foreground">标签</span>
          {tagCounts.map(([t, n]) => {
            const { short, label, tone } = tagLabel(t);
            const on = filterTag === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                title={label}
                onClick={() => setOnlyTag(on ? null : t)}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 transition-colors",
                  on ? TONE_CLASS[tone] : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  n === 0 && !on && "opacity-50",
                )}
              >
                {short}
                <span className="tabular-nums opacity-70">{n}</span>
                {on && <XIcon className="size-3" />}
              </button>
            );
          })}
        </div>
      )}

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
            {filtering
              ? `“${TAB_LABEL[tab]}”里${query.trim() ? `没有和“${query.trim()}”匹配的药品` : "没有符合筛选的药品"}${filterNoPerBox ? "（只看未写明每盒颗数的）" : ""}${filterTag ? `（只看“${tagLabel(filterTag).label}”）` : ""}`
              : tab === "active"
                ? "目前没有在吃的药。"
                : "没有未在吃的药。把一种药的服用规律改成早、中、晚都是 0（停药），它就会归到这里。"}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {matches[other].length > 0 && (
              <Button variant="outline" size="sm" onClick={() => showTab(other)}>
                {filtering ? `“${TAB_LABEL[other]}”里有 ${matches[other].length} 个匹配` : `查看${TAB_LABEL[other]}的 ${matches[other].length} 种药`}
              </Button>
            )}
            {filtering && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setOnlyNoPerBox(false);
                  setOnlyTag(null);
                }}
              >
                清除搜索和筛选
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((m) => (
            <MedicationCard
              key={m.id}
              medication={m}
              status={statuses.get(m.id)!}
              intake={intakes.get(m.id)!}
              onSupply={() => setPanel({ kind: "supply", id: m.id })}
              onRegimen={() => setPanel({ kind: "regimen", id: m.id })}
              onReserve={() => setPanel({ kind: "reserve", id: m.id })}
              onDetail={() => setPanel({ kind: "detail", id: m.id })}
            />
          ))}
        </div>
      )}

      <CreateMedicationDialog
        open={creating}
        onOpenChange={setCreating}
        today={clock.date}
        medications={medications}
        onSupply={(id) => setPanel({ kind: "supply", id })}
      />
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

/** Strengths of one drug next to each other, where the first of them is (when not ranked by a search). */
function groupByDrug(list: MedicationRecord[], group: boolean): MedicationRecord[] {
  if (!group) return list;
  const groups = new Map<string, MedicationRecord[]>();
  for (const m of list) {
    const k = drugKey(m.name);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.values()].flat();
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
  intake,
  onSupply,
  onRegimen,
  onReserve,
  onDetail,
}: {
  medication: MedicationRecord;
  status: MedicationStatus;
  intake: Intake;
  onSupply: () => void;
  onRegimen: () => void;
  onReserve: () => void;
  onDetail: () => void;
}) {
  const { conclusion, shortfall } = status;
  const next = status.plan.visits[0];
  const balanceNote = packNote(status.balanceNow, medication);
  const reserveNote = packNote(medication.reserve, medication);
  // The status box already says 已停药 / 未设规律: the badge adds when.
  const intakeNote =
    intake.kind === "starting" ? intakeLabel(intake) : intake.kind === "stopped" ? `${fmtDate(intake.since)} 起停药` : null;
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">
            {medication.name} <span className="font-normal text-muted-foreground">{medication.dosage}</span>
          </CardTitle>
          {intakeNote && (
            <Badge
              variant="outline"
              className={intake.kind === "starting" ? "border-sky-300 text-sky-800 dark:border-sky-800 dark:text-sky-300" : "text-muted-foreground"}
            >
              {intakeNote}
            </Badge>
          )}
          {!medication.perBox && (
            <Badge variant="outline" className={noPerBoxTag} title="没有每盒颗数：就诊时只能按颗算，无法换算成盒数">
              <TagIcon />
              未写明每{medication.packUnit}颗数
            </Badge>
          )}
        </div>
        <CardDescription className="grid gap-1.5">
          <span>
            {medication.packs.length > 1
              ? `${medication.packs.length} 个厂家：${medication.packs.map(packLabel).join("；")}`
              : [medication.brand, medication.perBox && `${fmtQty(medication.perBox)} 颗/${medication.packUnit}`].filter(Boolean).join(" · ") ||
                "未写厂家和每盒颗数"}
          </span>
          <TagBadges tags={medication.tags} />
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
        <Row label="药物储备">
          <span>{fmtQty(medication.reserve)} 颗</span>
          {reserveNote && <span className="text-xs text-muted-foreground">{reserveNote}</span>}
          {medication.reserve > 0 && (
            <span className="text-xs text-muted-foreground">{describeReserve(medication.reserve, status.current)}</span>
          )}
        </Row>
        {next && isTaking(intake) && (
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
      <CardFooter className="mt-auto grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={onSupply}>
          <PlusIcon />
          补药
        </Button>
        <Button size="sm" variant="outline" onClick={onReserve} title="加入储备、从储备取用或修正储备数">
          <ArchiveIcon />
          管理储备
        </Button>
        <Button size="sm" variant="outline" onClick={onRegimen}>
          <SettingsIcon />
          改规律
        </Button>
        <Button size="sm" variant="secondary" onClick={onDetail}>
          <ChartSplineIcon />
          详情 / 曲线
        </Button>
      </CardFooter>
    </Card>
  );
}
