"use client";

import { Loader2Icon } from "lucide-react";
import { useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatRegimenShort, fmtQty, packNote } from "@/lib/meds/format";
import { addDays, fmtDate, fmtDay, weekdayCN, type ISODate } from "@/lib/meds/dates";
import { balanceAt, regimenAt, simulate, supplyToLast, type DateRange } from "@/lib/meds/simulate";
import { clinicDayOnOrBefore, usualNextVisit } from "@/lib/meds/visits";
import type { ActionResult, MedicationRecord, RegimenRecord } from "@/lib/meds/types";
import { regimenSchema, supplySchema, type RegimenFields, type SupplyFields } from "@/lib/meds/validation";
import { DatePicker } from "./date-picker";
import { QuantityInput, parseQuantity } from "./quantity-input";
import { SupplyAmountInput, amountState, resolveAmount } from "./supply-amount";

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2Icon className="animate-spin" />}
      {children}
    </Button>
  );
}

/** Runs a server action from a form: client-side validation, pending state, error text. */
export function useActionForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submit = (call: () => Promise<ActionResult>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      const r = await call();
      if (r.ok) onDone?.();
      else setError(r.error);
    });
  };
  return { pending, error, setError, submit };
}

/* ------------------------------------ supply ------------------------------------ */

/** What a new supply needs to work out "enough to last until …". */
export interface SupplyPlanContext {
  medication: MedicationRecord;
  /** Hospital stays: nothing is taken on those days. */
  pauses: readonly DateRange[];
  /** Upcoming visit dates; the default end is the day before the next one. */
  visits: readonly ISODate[];
}

/**
 * Evenings a supply on `from` would usually last to: the day before the next visit (else the
 * usual one 4 weeks on) and the Wednesday on or before it, since visits are on Thursdays.
 */
function untilChoices(from: ISODate, visits: readonly ISODate[]): { label: string; date: ISODate }[] {
  const next = visits.find((v) => v > from);
  const dayBefore = addDays(next ?? usualNextVisit(from).fourWeeks, -1);
  const wednesday = addDays(clinicDayOnOrBefore(addDays(dayBefore, 1)), -1);
  const choices = [{ label: next ? "下次就诊前一天" : "4 周后就诊前一天", date: dayBefore }];
  if (wednesday !== dayBefore && wednesday >= from) choices.push({ label: "就诊前的周三", date: wednesday });
  return choices;
}

export function SupplyForm({
  today,
  initial,
  pack,
  plan,
  submitLabel = "保存",
  onSubmit,
  onDone,
  onCancel,
}: {
  today: ISODate;
  initial?: SupplyFields;
  /** The medication's pack: a new entry starts in packs when the size is known. */
  pack?: Pick<MedicationRecord, "perBox" | "packUnit">;
  /** For a new supply: also offer "enough to last until a date", worked out from the regimen. */
  plan?: SupplyPlanContext;
  submitLabel?: string;
  onSubmit: (fields: SupplyFields) => Promise<ActionResult>;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [date, setDate] = useState(initial?.date ?? today);
  const [amount, setAmount] = useState(() => amountState(initial ? String(initial.quantity) : "", pack?.perBox ?? null));
  const [byDate, setByDate] = useState(false);
  const [until, setUntil] = useState<ISODate | null>(null);
  const [openedAt] = useState(() => Date.now());
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();
  const med = plan?.medication;
  const pauses = plan?.pauses;
  const choices = useMemo(() => untilChoices(date, plan?.visits ?? []), [date, plan?.visits]);
  const end = until ?? choices[0].date;

  const needed = useMemo(() => {
    if (!med || !byDate) return null;
    const options = { pauses, counts: med.counts };
    const quantity = supplyToLast(med.supplies, med.regimens, { date, recordedAt: openedAt }, end, options);
    const have = balanceAt(simulate(med.supplies, med.regimens, { ...options, until: end, maxYears: 0 }), { date, slotsDone: 0 });
    return { quantity, have };
  }, [med, pauses, byDate, date, end, openedAt]);

  const unit = pack?.packUnit ?? "盒";
  const regimen = plan ? regimenAt(plan.medication.regimens, date) : null;
  const dateBody = needed && (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">吃到</span>
        <div className="w-52">
          <DatePicker label="吃到哪天晚上" value={end} onChange={setUntil} today={today} />
        </div>
        <span className="text-muted-foreground">晚上吃完</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <Button
            key={c.date}
            type="button"
            size="xs"
            variant={c.date === end ? "secondary" : "outline"}
            onClick={() => setUntil(c.date)}
          >
            {c.label}：{fmtDay(c.date)} {weekdayCN(c.date)}
          </Button>
        ))}
      </div>
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm tabular-nums" aria-live="polite">
        {end < date ? (
          <span className="text-destructive">吃到的日期不能早于开药日期</span>
        ) : needed.quantity === null ? (
          <span className="text-amber-700 dark:text-amber-400">这段时间里有盘点，盘点后的余量以盘点为准；请把开药日期改到最后一次盘点当天或之后。</span>
        ) : needed.quantity === 0 ? (
          <span className="text-muted-foreground">
            {needed.have > 0 ? `现有 ${fmtQty(needed.have)} 颗已经够吃到 ${fmtDate(end)} 晚上，不用补。` : "这段时间没有要吃的药（没有服用规律，或在住院）。"}
          </span>
        ) : (
          <>
            需补 <b>{fmtQty(needed.quantity)} 颗</b>
            {pack && packNote(needed.quantity, pack) && <span className="text-muted-foreground">（{packNote(needed.quantity, pack)}）</span>}
            <span className="block text-xs text-muted-foreground">
              按{regimen ? `当前规律（${formatRegimenShort(regimen)}）` : "服用规律"}，从 {fmtDate(date)} 早上吃到 {fmtDate(end)} 晚上刚好吃完
              {needed.have > 0 ? `；已算上现有的 ${fmtQty(needed.have)} 颗` : ""}
              {pauses?.some((p) => p.start <= end && p.end >= date) ? "；住院的日子不算" : ""}。
            </span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        let quantity: number | null;
        if (byDate && needed) {
          if (end < date) return setError("吃到的日期不能早于开药日期");
          if (needed.quantity === null) return setError("这段时间里有盘点，无法按日期计算");
          if (needed.quantity === 0) return setError(`不用补：已经够吃到 ${fmtDate(end)} 晚上`);
          quantity = needed.quantity;
        } else {
          const resolved = resolveAmount(amount, unit);
          if ("error" in resolved) return setError(resolved.error);
          quantity = resolved.value;
        }
        const parsed = supplySchema.safeParse({ date, quantity });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(() => onSubmit(parsed.data), onDone);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-date`}>开药日期</Label>
        <DatePicker id={`${uid}-date`} label="开药日期" value={date} onChange={setDate} today={today} />
      </div>
      <SupplyAmountInput
        id={`${uid}-qty`}
        label="数量"
        value={amount}
        onChange={setAmount}
        unit={unit}
        byDate={plan ? { active: byDate, onChange: setByDate, children: dateBody } : undefined}
      />
      <p className="text-xs text-muted-foreground">当天添加的药量在当天早上服药前即计入余量。</p>
      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        )}
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

/* ----------------------------------- regimen ------------------------------------ */

export function DoseFields({
  values,
  onChange,
  idPrefix,
}: {
  values: { morning: string; noon: string; evening: string };
  onChange: (values: { morning: string; noon: string; evening: string }) => void;
  idPrefix: string;
}) {
  const slots = [
    ["morning", "早"],
    ["noon", "中"],
    ["evening", "晚"],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {slots.map(([key, label]) => (
        <div key={key} className="grid gap-2">
          <Label htmlFor={`${idPrefix}-${key}`}>{label}（颗/次）</Label>
          <QuantityInput
            id={`${idPrefix}-${key}`}
            label={label}
            value={values[key]}
            onChange={(v) => onChange({ ...values, [key]: v })}
          />
        </div>
      ))}
    </div>
  );
}

export function parseDoses(values: { morning: string; noon: string; evening: string }) {
  return {
    morning: parseQuantity(values.morning, 0),
    noon: parseQuantity(values.noon, 0),
    evening: parseQuantity(values.evening, 0),
  };
}

const doseText = (n: number | undefined) => (n === undefined ? "0" : fmtQty(n));

export function RegimenForm({
  today,
  initial,
  existing,
  editingId,
  submitLabel = "保存",
  onSubmit,
  onDone,
  onCancel,
}: {
  today: ISODate;
  initial?: Partial<RegimenFields>;
  /** All regimens of this medication, to warn about overwriting a day. */
  existing: RegimenRecord[];
  editingId?: number;
  submitLabel?: string;
  onSubmit: (fields: RegimenFields) => Promise<ActionResult>;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom ?? today);
  const [doses, setDoses] = useState({
    morning: doseText(initial?.morning),
    noon: doseText(initial?.noon),
    evening: doseText(initial?.evening),
  });
  const { pending, error, setError, submit } = useActionForm();
  const clash = existing.find((r) => r.effectiveFrom === effectiveFrom && r.id !== editingId);
  const idPrefix = useId();

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = regimenSchema.safeParse({ effectiveFrom, ...parseDoses(doses) });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(() => onSubmit(parsed.data), onDone);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-date`}>生效日期</Label>
        <DatePicker id={`${idPrefix}-date`} label="生效日期" value={effectiveFrom} onChange={setEffectiveFrom} today={today} />
      </div>
      <DoseFields idPrefix={idPrefix} values={doses} onChange={setDoses} />
      <p className="text-xs text-muted-foreground">
        从 {fmtDate(effectiveFrom)} 当天起按新规律扣减，此前的日期仍按当时生效的规律计算。
        {clash && (
          <span className="mt-1 block text-amber-700 dark:text-amber-400">
            {fmtDate(effectiveFrom)} 已有规律（{formatRegimenShort(clash)}），保存后将覆盖该天的规律。
          </span>
        )}
      </p>
      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        )}
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
