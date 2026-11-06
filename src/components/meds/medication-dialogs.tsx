"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { addSupply, createMedication, drawFromReserve, saveRegimen, setReserve, updateMedication } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { fmtDate, type ISODate } from "@/lib/meds/dates";
import { describeReserve, fmtPacks, fmtQty, formatRegimen, formatRegimenShort } from "@/lib/meds/format";
import { regimenAt, type DateRange } from "@/lib/meds/simulate";
import { PACK_UNITS, type MedicationRecord, type PackUnit } from "@/lib/meds/types";
import { createMedicationSchema, drawSchema, medicationSchema, reserveSchema } from "@/lib/meds/validation";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { DoseFields, FormError, RegimenForm, SubmitButton, SupplyForm, parseDoses, useActionForm } from "./forms";
import { SupplyAmountInput, amountInPacks, amountState, resolveAmount, type AmountState } from "./supply-amount";

type FieldValues = { name: string; brand: string; dosage: string; packUnit: PackUnit; perBox: string };

const emptyFields: FieldValues = { name: "", brand: "", dosage: "", packUnit: "盒", perBox: "" };

const toFields = (v: FieldValues) => ({
  name: v.name,
  brand: v.brand,
  dosage: v.dosage,
  packUnit: v.packUnit,
  perBox: v.perBox.trim() ? Number(v.perBox) : null,
});

function MedicationFieldsInputs({ values, onChange }: { values: FieldValues; onChange: (v: FieldValues) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="med-name">药品名称</Label>
        <Input id="med-name" placeholder="如：药品A" value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="med-brand">
          品牌 <span className="font-normal text-muted-foreground">（选填）</span>
        </Label>
        <Input id="med-brand" placeholder="如：辉瑞" value={values.brand} onChange={(e) => onChange({ ...values, brand: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="med-dosage">含量/规格</Label>
        <Input id="med-dosage" placeholder="如：10mg" value={values.dosage} onChange={(e) => onChange({ ...values, dosage: e.target.value })} required />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="med-per-box">
            每{values.packUnit}颗数 <span className="font-normal text-muted-foreground">（选填，按{values.packUnit}开药）</span>
          </Label>
          <div role="radiogroup" aria-label="包装" className="inline-flex rounded-md border p-0.5 text-xs">
            {PACK_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={values.packUnit === u}
                onClick={() => onChange({ ...values, packUnit: u })}
                className={cn(
                  "rounded-[5px] px-2 py-0.5 transition-colors",
                  values.packUnit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {u}装
              </button>
            ))}
          </div>
        </div>
        <Input
          id="med-per-box"
          inputMode="decimal"
          placeholder="如：28"
          className="tabular-nums"
          value={values.perBox}
          onChange={(e) => onChange({ ...values, perBox: e.target.value.replace(/[^\d.]/g, "") })}
        />
      </div>
    </div>
  );
}

export function CreateMedicationDialog({
  open,
  onOpenChange,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: ISODate;
}) {
  const [fields, setFields] = useState<FieldValues>(emptyFields);
  const [startDate, setStartDate] = useState(today);
  const [amount, setAmount] = useState(() => amountState());
  const [reserve, setReserveAmount] = useState(() => amountState());
  const [doses, setDoses] = useState({ morning: "0", noon: "0", evening: "0" });
  const { pending, error, setError, submit } = useActionForm();

  const reset = () => {
    setFields(emptyFields);
    setStartDate(today);
    setAmount(amountState());
    setReserveAmount(amountState());
    setDoses({ morning: "0", noon: "0", evening: "0" });
    setError(null);
  };
  const onFields = (v: FieldValues) => {
    // Typing the box size also fills it into the amount inputs that still have the old one.
    if (v.perBox !== fields.perBox) {
      const sync = (a: AmountState) => (a.perBox === fields.perBox ? { ...a, perBox: v.perBox } : a);
      setAmount(sync);
      setReserveAmount(sync);
    }
    setFields(v);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新增药品</DialogTitle>
          <DialogDescription>只需药品名称、品牌和含量；初始药量与服用规律可顺带填写，也可以之后再加。</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            const qty = resolveAmount(amount, fields.packUnit);
            if ("error" in qty) return setError(qty.error);
            const res = resolveAmount(reserve, fields.packUnit);
            if ("error" in res) return setError(res.error);
            const d = parseDoses(doses);
            const hasRegimen = [d.morning, d.noon, d.evening].some((v) => v === null || v > 0);
            const input = {
              ...toFields(fields),
              reserve: res.value ?? 0,
              initialSupply: qty.value !== null ? { date: startDate, quantity: qty.value } : null,
              initialRegimen: hasRegimen ? { effectiveFrom: startDate, ...(d as Record<keyof typeof d, number>) } : null,
            };
            const parsed = createMedicationSchema.safeParse(input);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
            submit(
              () => createMedication(input),
              () => {
                toast.success(`已添加「${parsed.data.name}」`);
                reset();
                onOpenChange(false);
              },
            );
          }}
        >
          <MedicationFieldsInputs values={fields} onChange={onFields} />
          <Separator />
          <div className="@container grid gap-4">
            <p className="text-sm font-medium">
              初始药量与规律 <span className="font-normal text-muted-foreground">（选填）</span>
            </p>
            <div className="grid items-start gap-4 @xl:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="init-date">开药 / 生效日期</Label>
                <DatePicker id="init-date" label="开药 / 生效日期" value={startDate} onChange={setStartDate} today={today} />
              </div>
              <SupplyAmountInput id="init-qty" label="初始药量" value={amount} onChange={setAmount} unit={fields.packUnit} />
            </div>
            <DoseFields idPrefix="init" values={doses} onChange={setDoses} />
          </div>
          <Separator />
          <div className="grid gap-2 sm:max-w-sm">
            <SupplyAmountInput
              id="init-reserve"
              label="药物储备（选填）"
              value={reserve}
              onChange={setReserveAmount}
              unit={fields.packUnit}
            />
            <p className="text-xs text-muted-foreground">家中额外备着、以防万一的药，不计入当前余量。</p>
          </div>
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <SubmitButton pending={pending}>添加</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditMedicationForm({ medication, onDone }: { medication: MedicationRecord; onDone: () => void }) {
  const [fields, setFields] = useState<FieldValues>({
    name: medication.name,
    brand: medication.brand ?? "",
    dosage: medication.dosage,
    packUnit: medication.packUnit,
    perBox: medication.perBox ? String(medication.perBox) : "",
  });
  const { pending, error, setError, submit } = useActionForm();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const input = toFields(fields);
        const parsed = medicationSchema.safeParse(input);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(() => updateMedication(medication.id, input), onDone);
      }}
    >
      <MedicationFieldsInputs values={fields} onChange={setFields} />
      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          取消
        </Button>
        <SubmitButton pending={pending}>保存</SubmitButton>
      </div>
    </form>
  );
}

const medLabel = (m: MedicationRecord) => [m.name, m.brand, m.dosage].filter(Boolean).join(" · ");

export function AddSupplyDialog({
  medication,
  onOpenChange,
  today,
  pauses,
  visits,
}: {
  medication: MedicationRecord | null;
  onOpenChange: (open: boolean) => void;
  today: ISODate;
  pauses: readonly DateRange[];
  /** Upcoming visit dates. */
  visits: readonly ISODate[];
}) {
  return (
    <Dialog open={!!medication} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>补药</DialogTitle>
          <DialogDescription>{medication && medLabel(medication)}</DialogDescription>
        </DialogHeader>
        {medication && (
          <SupplyForm
            key={medication.id}
            today={today}
            pack={medication}
            plan={{ medication, pauses, visits }}
            submitLabel="添加"
            onSubmit={(f) => addSupply(medication.id, f)}
            onDone={() => {
              toast.success("已添加补药记录");
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RegimenDialog({
  medication,
  onOpenChange,
  today,
}: {
  medication: MedicationRecord | null;
  onOpenChange: (open: boolean) => void;
  today: ISODate;
}) {
  const current = medication ? regimenAt(medication.regimens, today) : null;
  return (
    <Dialog open={!!medication} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>改规律</DialogTitle>
          <DialogDescription>
            {medication && medLabel(medication)}
            <br />
            当前：{formatRegimen(current)}
          </DialogDescription>
        </DialogHeader>
        {medication && (
          <RegimenForm
            key={medication.id}
            today={today}
            initial={current ? { morning: current.morning, noon: current.noon, evening: current.evening } : undefined}
            existing={medication.regimens}
            submitLabel="保存规律"
            onSubmit={(f) => saveRegimen(medication.id, f)}
            onDone={() => {
              toast.success("服用规律已保存");
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------ reserve ------------------------------------ */

export function ReserveDialog({
  medication,
  onOpenChange,
  today,
}: {
  medication: MedicationRecord | null;
  onOpenChange: (open: boolean) => void;
  today: ISODate;
}) {
  return (
    <Dialog open={!!medication} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>药物储备</DialogTitle>
          <DialogDescription>{medication && medLabel(medication)}</DialogDescription>
        </DialogHeader>
        {medication && <ReservePanel key={medication.id} medication={medication} today={today} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** Count the reserve, or take some of it into the current stock. */
export function ReservePanel({ medication, today, onDone }: { medication: MedicationRecord; today: ISODate; onDone: () => void }) {
  const [tab, setTab] = useState<"count" | "draw">("count");
  const current = regimenAt(medication.regimens, today);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        储备是家里除当前在吃的药以外，额外备着以防万一的药。它不计入当前余量、能吃到的日期和就诊计划，只估算按当前规律
        {current ? `（${formatRegimenShort(current)}）` : ""}能用多久。
      </p>
      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="text-muted-foreground">现有储备</span>
        <span className="text-right tabular-nums">
          <b>{fmtPacks(medication.reserve, medication.perBox, medication.packUnit)}</b>
          {medication.perBox && medication.reserve > 0 && <span className="text-muted-foreground">（{fmtQty(medication.reserve)} 颗）</span>}
          <span className="ml-1.5 text-muted-foreground">· {describeReserve(medication.reserve, current)}</span>
        </span>
      </div>
      <div role="tablist" aria-label="储备操作" className="inline-flex w-fit rounded-md border p-0.5 text-sm">
        {(
          [
            ["count", "盘点储备"],
            ["draw", "从储备取用"],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-[5px] px-3 py-1 transition-colors",
              tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === "count" ? (
        <ReserveCountForm medication={medication} today={today} onDone={onDone} />
      ) : (
        <ReserveDrawForm medication={medication} today={today} onDone={onDone} />
      )}
    </div>
  );
}

function FormButtons({ pending, label, onCancel }: { pending: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel}>
        取消
      </Button>
      <SubmitButton pending={pending}>{label}</SubmitButton>
    </div>
  );
}

function ReserveCountForm({ medication, today, onDone }: { medication: MedicationRecord; today: ISODate; onDone: () => void }) {
  const [amount, setAmount] = useState(() => amountInPacks(medication.reserve, medication.perBox));
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();
  const resolved = resolveAmount(amount, medication.packUnit);
  const preview = "value" in resolved ? describeReserve(resolved.value ?? 0, regimenAt(medication.regimens, today)) : null;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if ("error" in resolved) return setError(resolved.error);
        const parsed = reserveSchema.safeParse(resolved.value ?? 0);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(
          () => setReserve(medication.id, parsed.data),
          () => {
            toast.success("储备已更新");
            onDone();
          },
        );
      }}
    >
      <SupplyAmountInput id={`${uid}-reserve`} label="现在家里的储备" value={amount} onChange={setAmount} unit={medication.packUnit} />
      <p className="text-xs text-muted-foreground">
        按实际清点填写：整{medication.packUnit}按{medication.packUnit}数，拆开用过的那{medication.packUnit}把剩下的颗数填进“散装”。清空即为没有储备。
      </p>
      {preview && <p className="text-sm tabular-nums">保存后：{preview}</p>}
      <FormError>{error}</FormError>
      <FormButtons pending={pending} label="保存" onCancel={onDone} />
    </form>
  );
}

function ReserveDrawForm({ medication, today, onDone }: { medication: MedicationRecord; today: ISODate; onDone: () => void }) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(() => amountState("", medication.perBox));
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();
  const resolved = resolveAmount(amount, medication.packUnit);
  const value = "value" in resolved ? resolved.value : null;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if ("error" in resolved) return setError(resolved.error);
        const parsed = drawSchema.safeParse({ date, quantity: value });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        if (parsed.data.quantity > medication.reserve) return setError(`储备只有 ${fmtQty(medication.reserve)} 颗`);
        submit(
          () => drawFromReserve(medication.id, parsed.data),
          () => {
            toast.success(`已从储备取用 ${fmtQty(parsed.data.quantity)} 颗`);
            onDone();
          },
        );
      }}
    >
      <div className="grid items-start gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-date`}>取用日期</Label>
          <DatePicker id={`${uid}-date`} label="取用日期" value={date} onChange={setDate} today={today} />
        </div>
        <SupplyAmountInput id={`${uid}-qty`} label="取用数量" value={amount} onChange={setAmount} unit={medication.packUnit} />
      </div>
      <p className="text-xs text-muted-foreground">
        取出的药记为 {fmtDate(date)} 的一笔补药、计入当前余量，储备同时减少
        {value ? `，剩 ${fmtQty(Math.max(0, medication.reserve - value))} 颗` : ""}。
      </p>
      <FormError>{error}</FormError>
      <FormButtons pending={pending} label="取用" onCancel={onDone} />
    </form>
  );
}
