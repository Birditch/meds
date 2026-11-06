"use client";

import { Loader2Icon } from "lucide-react";
import { useId, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatRegimenShort, fmtQty } from "@/lib/meds/format";
import type { ISODate } from "@/lib/meds/dates";
import type { ActionResult, RegimenRecord } from "@/lib/meds/types";
import { regimenSchema, supplySchema, type RegimenFields, type SupplyFields } from "@/lib/meds/validation";
import { DatePicker } from "./date-picker";
import { QuantityInput, parseQuantity } from "./quantity-input";

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

export function SupplyForm({
  today,
  initial,
  submitLabel = "保存",
  onSubmit,
  onDone,
  onCancel,
}: {
  today: ISODate;
  initial?: SupplyFields;
  submitLabel?: string;
  onSubmit: (fields: SupplyFields) => Promise<ActionResult>;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [date, setDate] = useState(initial?.date ?? today);
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : "");
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = supplySchema.safeParse({ date, quantity: parseQuantity(quantity) });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(() => onSubmit(parsed.data), onDone);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-date`}>开药日期</Label>
          <DatePicker id={`${uid}-date`} label="开药日期" value={date} onChange={setDate} today={today} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-qty`}>数量（颗）</Label>
          <QuantityInput id={`${uid}-qty`} label="数量" value={quantity} onChange={setQuantity} step={1} />
        </div>
      </div>
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
        从 {effectiveFrom} 当天起按新规律扣减，此前的日期仍按当时生效的规律计算。
        {clash && (
          <span className="mt-1 block text-amber-700 dark:text-amber-400">
            {effectiveFrom} 已有规律（{formatRegimenShort(clash)}），保存后将覆盖该天的规律。
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
