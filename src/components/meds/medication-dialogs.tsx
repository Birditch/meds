"use client";

import { useState } from "react";
import { toast } from "sonner";
import { addSupply, createMedication, saveRegimen, updateMedication } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { ISODate } from "@/lib/meds/dates";
import { formatRegimen } from "@/lib/meds/format";
import { regimenAt } from "@/lib/meds/simulate";
import type { MedicationRecord } from "@/lib/meds/types";
import { createMedicationSchema, medicationSchema } from "@/lib/meds/validation";
import { DatePicker } from "./date-picker";
import { DoseFields, FormError, RegimenForm, SubmitButton, SupplyForm, parseDoses, useActionForm } from "./forms";
import { SupplyAmountInput, amountState, resolveAmount } from "./supply-amount";

function MedicationFieldsInputs({
  values,
  onChange,
}: {
  values: { name: string; brand: string; dosage: string };
  onChange: (v: { name: string; brand: string; dosage: string }) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
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
  const [fields, setFields] = useState({ name: "", brand: "", dosage: "" });
  const [startDate, setStartDate] = useState(today);
  const [amount, setAmount] = useState(() => amountState());
  const [doses, setDoses] = useState({ morning: "0", noon: "0", evening: "0" });
  const { pending, error, setError, submit } = useActionForm();

  const reset = () => {
    setFields({ name: "", brand: "", dosage: "" });
    setStartDate(today);
    setAmount(amountState());
    setDoses({ morning: "0", noon: "0", evening: "0" });
    setError(null);
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
            const qty = resolveAmount(amount);
            if ("error" in qty) return setError(qty.error);
            const d = parseDoses(doses);
            const hasRegimen = [d.morning, d.noon, d.evening].some((v) => v === null || v > 0);
            const input = {
              ...fields,
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
          <MedicationFieldsInputs values={fields} onChange={setFields} />
          <Separator />
          <div className="grid gap-4">
            <p className="text-sm font-medium">
              初始药量与规律 <span className="font-normal text-muted-foreground">（选填）</span>
            </p>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="init-date">开药 / 生效日期</Label>
                <DatePicker id="init-date" label="开药 / 生效日期" value={startDate} onChange={setStartDate} today={today} />
              </div>
              <SupplyAmountInput id="init-qty" label="初始药量" value={amount} onChange={setAmount} />
            </div>
            <DoseFields idPrefix="init" values={doses} onChange={setDoses} />
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
  const [fields, setFields] = useState({ name: medication.name, brand: medication.brand ?? "", dosage: medication.dosage });
  const { pending, error, setError, submit } = useActionForm();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = medicationSchema.safeParse(fields);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(() => updateMedication(medication.id, fields), onDone);
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
}: {
  medication: MedicationRecord | null;
  onOpenChange: (open: boolean) => void;
  today: ISODate;
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
