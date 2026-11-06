"use client";

import { CalendarClockIcon, FileDownIcon, PencilIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { addVisit, deleteVisit, updateVisit } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, diffDays, fmtDate, weekdayCN, type ISODate } from "@/lib/meds/dates";
import { fmtQty, packNote, type MedicationStatus } from "@/lib/meds/format";
import { SLOT_LABEL } from "@/lib/meds/simulate";
import type { ActionResult, MedicationRecord, VisitRecord } from "@/lib/meds/types";
import {
  CLINIC_DAY,
  MONTH_START_DAYS,
  daysFromToday,
  isClinicDay,
  isMonthStart,
  spanText,
  suggestNextVisit,
  visitOrdinal,
  type VisitNeed,
} from "@/lib/meds/visits";
import { otherPacksText } from "@/lib/meds/reports";
import { isSpecialRx } from "@/lib/meds/tags";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { FormError, SubmitButton, useActionForm } from "./forms";
import { ConfirmDelete } from "./history";
import { reportHref } from "./reports-board";
import { TagBadges } from "./tags";

const dayLabel = fmtDate;

function VisitDateForm({
  today,
  initial,
  suggestions = [],
  submitLabel,
  onSubmit,
  onDone,
  onCancel,
}: {
  today: ISODate;
  initial: ISODate;
  suggestions?: { label: string; date: ISODate }[];
  submitLabel: string;
  onSubmit: (date: ISODate) => Promise<ActionResult>;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [date, setDate] = useState(initial);
  const { pending, error, submit } = useActionForm();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => onSubmit(date), onDone);
      }}
    >
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <Button
              key={s.date}
              type="button"
              size="xs"
              variant={s.date === date ? "secondary" : "outline"}
              className="tabular-nums"
              onClick={() => setDate(s.date)}
            >
              {s.label}：{dayLabel(s.date)}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-52">
          <DatePicker label="就诊日期" value={date} onChange={setDate} today={today} />
        </div>
        <MonthStartBadge date={date} />
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              取消
            </Button>
          )}
          <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        </div>
      </div>
      <FormError>{error}</FormError>
    </form>
  );
}

function MonthStartBadge({ date }: { date: ISODate }) {
  const ok = isMonthStart(date);
  return (
    <>
      {!isClinicDay(date) && (
        <Badge
          variant="outline"
          title={`平时${CLINIC_DAY}就诊`}
          className="border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300"
        >
          非{CLINIC_DAY}
        </Badge>
      )}
      <Badge
      variant="outline"
      title={`月初（每月 1–${MONTH_START_DAYS} 日）医院才有进口药`}
      className={cn(
        ok
          ? "border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300"
          : "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300",
      )}
    >
        {ok ? "月初" : `非月初（1–${MONTH_START_DAYS} 日才有进口药）`}
      </Badge>
    </>
  );
}

function NeedCell({ need, medication }: { need: VisitNeed; medication: MedicationRecord }) {
  if (need.need === 0) return <span className="text-muted-foreground">无需开药</span>;
  // The boxes are the default manufacturer's; the others' packs may hold another count.
  const others = otherPacksText(need, medication);
  if (need.packs !== null) {
    return (
      <span className="grid justify-items-end">
        <b>
          {need.packs} {medication.packUnit}
        </b>
        <span className="text-xs text-balance text-muted-foreground">
          缺 {fmtQty(need.need)} 颗 · 开 {fmtQty(need.prescribed)} 颗
          {need.prescribed > need.need ? `，多 ${fmtQty(need.prescribed - need.need)} 颗留到下次` : ""}
        </span>
        {others && <span className="text-xs text-balance text-muted-foreground">{others}</span>}
      </span>
    );
  }
  return (
    <span className="grid justify-items-end">
      <b>{fmtQty(need.need)} 颗</b>
      <span className="text-xs text-muted-foreground">未设每{medication.packUnit}颗数</span>
    </span>
  );
}

export function VisitPlan({
  visits,
  medications,
  notTaking = 0,
  statuses,
  today,
  className,
}: {
  visits: VisitRecord[];
  /** The medications being taken; the others need nothing. */
  medications: MedicationRecord[];
  /** How many medications are left out as not being taken. */
  notTaking?: number;
  statuses: Map<number, MedicationStatus>;
  today: ISODate;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const upcoming = visits.filter((v) => v.date >= today);
  const past = visits.filter((v) => v.date < today);
  const suggestions = suggestNextVisit(visits.at(-1)?.date ?? null, today);
  const suggested = suggestions.preferred;

  const warnings = medications.flatMap((m) => {
    const gap = statuses.get(m.id)?.plan.beforeFirst;
    return gap ? [{ m, gap }] : [];
  });

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClockIcon className="size-4 text-muted-foreground" />
          就诊计划
        </CardTitle>
        <CardDescription>
          {CLINIC_DAY}就诊：按前一天（周三）晚上吃完后的余量，算出这次要开多少，才能不动用储备吃到下次就诊前一天的晚上。最后一次之后按“4
          周后的{CLINIC_DAY}”估算（吃到那天前一晚），添加下一次就诊可按实际间隔算。
        </CardDescription>
        <CardAction>
          <Button size="sm" variant={adding ? "secondary" : "outline"} onClick={() => setAdding((v) => !v)}>
            <PlusIcon />
            添加就诊
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {adding && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <VisitDateForm
              key={suggested}
              today={today}
              initial={suggested}
              suggestions={suggestions.options}
              submitLabel="添加"
              onSubmit={addVisit}
              onDone={() => {
                setAdding(false);
                toast.success("已添加就诊时间");
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}

        {upcoming.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            还没有安排就诊。添加下次（以及下下次……）就诊日期，这里会列出每次要开几盒。
          </p>
        )}

        {warnings.length > 0 && (
          <ul className="grid gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {warnings.map(({ m, gap }) => (
              <li key={m.id} className="flex items-start gap-2">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  <b>{m.name}</b>：等不到下次就诊，{fmtDate(gap.from.date)} {SLOT_LABEL[gap.from.slot]}起断药，就诊前还缺{" "}
                  <b className="tabular-nums">{fmtQty(gap.shortfall)}</b> 颗。
                  {m.reserve >= gap.shortfall
                    ? `储备（${fmtQty(m.reserve)} 颗）够补，但会动用储备；`
                    : `储备${m.reserve > 0 ? `只有 ${fmtQty(m.reserve)} 颗` : "没有"}，补不上；`}
                  {gap.latestVisit
                    ? `要不断药也不动用储备，最晚 ${dayLabel(gap.latestVisit)} 就诊。`
                    : `断药前已没有${CLINIC_DAY}可以就诊，需要提前加诊。`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {upcoming.map((v, i) => {
          const rows = medications.map((m) => ({ m, need: statuses.get(m.id)?.plan.visits[i] }));
          const sample = rows.find((r) => r.need)?.need;
          const prev = visits[visits.indexOf(v) - 1]?.date;
          return (
            <section key={v.id} className="grid gap-2 rounded-lg border p-3">
              {editing === v.id ? (
                <VisitDateForm
                  today={today}
                  initial={v.date}
                  submitLabel="保存"
                  onSubmit={(date) => updateVisit(v.id, date)}
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant={i === 0 ? "default" : "secondary"}>{visitOrdinal(i)}</Badge>
                    <span className="font-medium tabular-nums">{dayLabel(v.date)}</span>
                    <span className="text-sm text-muted-foreground">{daysFromToday(v.date, today)}</span>
                    <MonthStartBadge date={v.date} />
                    <div className="ml-auto flex">
                      {medications.length > 0 && (
                        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                          <a href={reportHref("visit", v.date)} target="_blank" rel="noopener" title="导出这次复诊的开药清单（PDF）">
                            <FileDownIcon />
                            开药清单
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="修改就诊日期"
                        className="text-muted-foreground"
                        onClick={() => setEditing(v.id)}
                      >
                        <PencilIcon />
                      </Button>
                      <ConfirmDelete
                        title="删除这次就诊？"
                        description={`${dayLabel(v.date)} 的就诊安排将被删除，其余就诊的药量会重新计算。`}
                        onConfirm={() => deleteVisit(v.id)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {prev && `距上次 ${spanText(diffDays(v.date, prev))} · `}
                    {v.date === today ? "按现在的余量" : `按 ${fmtDate(addDays(v.date, -1))} 晚上吃完后的余量`}
                    {sample &&
                      `，这次开的药要吃到 ${fmtDate(sample.coverUntil)} 晚上（${spanText(diffDays(sample.coverUntil, v.date) + 1)}）`}
                    {sample?.estimated && `；下次按 4 周后的${CLINIC_DAY}估算，添加下一次就诊可按实际间隔算`}
                  </p>
                </div>
              )}

              {medications.length === 0 ? (
                <p className="text-sm text-muted-foreground">{notTaking > 0 ? "目前没有在吃的药，不需要开药。" : "还没有药品。"}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-1 pr-3 font-normal">药品</th>
                        <th className="py-1 pr-3 text-right font-normal">
                          {v.date === today ? "现在剩余" : `${weekdayCN(addDays(v.date, -1))}晚剩余`}
                        </th>
                        <th className="py-1 text-right font-normal">{weekdayCN(v.date)}需开</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map(({ m, need }) => (
                        <tr key={m.id}>
                          <td className="py-1.5 pr-3 align-top">
                            {m.name}
                            <span className="block text-xs text-muted-foreground sm:ml-1.5 sm:inline">
                              {[m.dosage, m.packs.map((p) => p.brand).filter(Boolean).join(" / ")].filter(Boolean).join(" · ")}
                            </span>
                            <TagBadges tags={m.tags.filter((t) => isSpecialRx([t]) || t === "imported")} className="ml-1.5 align-middle" />
                          </td>
                          <td className="py-1.5 pr-3 text-right align-top tabular-nums">
                            {need ? (
                              <span className="grid justify-items-end">
                                <span>{fmtQty(need.stockBefore)} 颗</span>
                                {packNote(need.stockBefore, m) && (
                                  <span className="text-xs text-muted-foreground">{packNote(need.stockBefore, m)}</span>
                                )}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-1.5 text-right align-top tabular-nums">
                            {need ? <NeedCell need={need} medication={m} /> : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}

        {upcoming.length > 0 && notTaking > 0 && (
          <p className="text-xs text-muted-foreground">
            另有{" "}
            <Link href="/?tab=inactive" className="underline underline-offset-4 hover:text-foreground">
              {notTaking} 种未在吃的药
            </Link>
            （已停药或没设规律）不需要开药，没有列出。
          </p>
        )}

        {upcoming.length > 0 && medications.some((m) => m.perBox) && (
          <p className="text-xs text-muted-foreground">
            按整盒 / 整瓶开药时，多出的颗数留到下一次，下一次相应少开；前一晚剩余也已算上这些。储备始终不计入。
          </p>
        )}

        {past.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>已过的就诊：</span>
            {past.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 tabular-nums">
                {fmtDate(v.date)}
                <button
                  type="button"
                  aria-label={`删除 ${fmtDate(v.date)} 的就诊`}
                  className="rounded hover:text-destructive"
                  onClick={async () => {
                    const r = await deleteVisit(v.id);
                    if (!r.ok) toast.error(r.error);
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
