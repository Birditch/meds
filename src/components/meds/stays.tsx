"use client";

import { BedIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { addStay, deleteStay, updateStay } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { addDays, diffDays, fmtDate, type ISODate } from "@/lib/meds/dates";
import type { ActionResult, StayRecord } from "@/lib/meds/types";
import { staySchema, type StayFields } from "@/lib/meds/validation";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { FormError, SubmitButton, useActionForm } from "./forms";
import { ConfirmDelete } from "./history";

function StayForm({
  today,
  initial,
  submitLabel,
  onSubmit,
  onDone,
  onCancel,
}: {
  today: ISODate;
  initial: StayFields;
  submitLabel: string;
  onSubmit: (fields: StayFields) => Promise<ActionResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = staySchema.safeParse({ startDate, endDate });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(() => onSubmit(parsed.data), onDone);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-start`}>入院日期</Label>
          <DatePicker
            id={`${uid}-start`}
            label="入院日期"
            value={startDate}
            onChange={(d) => {
              setStartDate(d);
              if (endDate < d) setEndDate(d);
            }}
            today={today}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-end`}>出院日期（预计也可以）</Label>
          <DatePicker id={`${uid}-end`} label="出院日期" value={endDate} onChange={setEndDate} today={today} />
        </div>
      </div>
      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

export function HospitalStays({ stays, today, className }: { stays: StayRecord[]; today: ISODate; className?: string }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const rows = [...stays].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BedIcon className="size-4 text-muted-foreground" />
          住院
        </CardTitle>
        <CardDescription>住院期间（入院、出院当天都算）不消耗家里的药，能吃到的日期和就诊计划都会顺延。</CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant={adding ? "secondary" : "outline"}
            onClick={() => {
              setAdding((v) => !v);
              setEditing(null);
            }}
          >
            <PlusIcon />
            添加
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {adding && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <StayForm
              today={today}
              initial={{ startDate: today, endDate: addDays(today, 6) }}
              submitLabel="添加"
              onSubmit={addStay}
              onDone={() => {
                setAdding(false);
                toast.success("已添加住院记录");
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
        {rows.length === 0 && !adding && <p className="text-sm text-muted-foreground">没有住院记录。</p>}
        {rows.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {rows.map((s) =>
              editing === s.id ? (
                <li key={s.id} className="bg-muted/30 p-3">
                  <StayForm
                    today={today}
                    initial={s}
                    submitLabel="保存"
                    onSubmit={(f) => updateStay(s.id, f)}
                    onDone={() => setEditing(null)}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="tabular-nums">
                    {fmtDate(s.startDate)} – {fmtDate(s.endDate)}
                  </span>
                  <span className="text-xs text-muted-foreground">{diffDays(s.endDate, s.startDate) + 1} 天</span>
                  {s.startDate <= today && today <= s.endDate ? (
                    <Badge>住院中</Badge>
                  ) : s.startDate > today ? (
                    <Badge variant="outline">计划</Badge>
                  ) : (
                    <Badge variant="secondary">已出院</Badge>
                  )}
                  <div className="ml-auto flex">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="编辑住院记录"
                      className="text-muted-foreground"
                      onClick={() => {
                        setEditing(s.id);
                        setAdding(false);
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <ConfirmDelete
                      title="删除这条住院记录？"
                      description={`${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}。删除后这几天会按正常规律扣减家里的药。`}
                      onConfirm={() => deleteStay(s.id)}
                    />
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
