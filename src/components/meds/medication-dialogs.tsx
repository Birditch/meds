"use client";

import { CopyPlusIcon, PackagePlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { addPack, addReserve, addSupply, createMedication, drawFromReserve, saveRegimen, setReserve, updateMedication } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { fmtDate, type ISODate } from "@/lib/meds/dates";
import { describeReserve, fmtPacks, fmtQty, formatRegimen, formatRegimenShort } from "@/lib/meds/format";
import { SIMILARITY_LABEL, findSimilar, type SimilarMatch } from "@/lib/meds/similar";
import { regimenAt, type DateRange } from "@/lib/meds/simulate";
import { PACK_UNITS, type MedicationRecord, type PackRecord, type PackUnit } from "@/lib/meds/types";
import { createMedicationSchema, drawSchema, medicationInfoSchema, packSchema, quantitySchema, reserveSchema } from "@/lib/meds/validation";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { DoseFields, FormError, PackPicker, RegimenForm, SubmitButton, SupplyForm, packLabel, parseDoses, useActionForm } from "./forms";
import { SupplyAmountInput, amountInPacks, amountState, resolveAmount, type AmountState } from "./supply-amount";
import { TagBadges, TagPicker } from "./tags";

type PackValues = { brand: string; packUnit: PackUnit; perBox: string };
type FieldValues = PackValues & { name: string; dosage: string };

const emptyFields: FieldValues = { name: "", brand: "", dosage: "", packUnit: "盒", perBox: "" };

const toPack = (v: PackValues) => ({ brand: v.brand, packUnit: v.packUnit, perBox: v.perBox.trim() ? Number(v.perBox) : null });

/** "氯硝西泮片 2mg" with its manufacturers. */
const medTitle = (m: Pick<MedicationRecord, "name" | "dosage">) => `${m.name} ${m.dosage}`;
const packsText = (m: MedicationRecord) => m.packs.map(packLabel).join("；");

function NameInputs({ values, onChange }: { values: Pick<FieldValues, "name" | "dosage">; onChange: (v: Partial<FieldValues>) => void }) {
  const uid = useId();
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-name`}>药品名称</Label>
        <Input
          id={`${uid}-name`}
          placeholder="通用名，如：氯硝西泮片"
          autoComplete="off"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-dosage`}>含量/规格</Label>
        <Input id={`${uid}-dosage`} placeholder="如：2mg" value={values.dosage} onChange={(e) => onChange({ dosage: e.target.value })} required />
      </div>
    </>
  );
}

export function PackInputs({ values, onChange, brandRequired }: { values: PackValues; onChange: (v: Partial<PackValues>) => void; brandRequired?: boolean }) {
  const uid = useId();
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-brand`}>
          厂家 / 品牌 {!brandRequired && <span className="font-normal text-muted-foreground">（选填）</span>}
        </Label>
        <Input
          id={`${uid}-brand`}
          placeholder="如：江苏恩华"
          value={values.brand}
          onChange={(e) => onChange({ brand: e.target.value })}
          required={brandRequired}
        />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${uid}-per-box`}>
            每{values.packUnit}颗数 <span className="font-normal text-muted-foreground">（选填，按{values.packUnit}开药）</span>
          </Label>
          <div role="radiogroup" aria-label="包装" className="inline-flex rounded-md border p-0.5 text-xs">
            {PACK_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={values.packUnit === u}
                onClick={() => onChange({ packUnit: u })}
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
          id={`${uid}-per-box`}
          inputMode="decimal"
          placeholder="如：20"
          className="tabular-nums"
          value={values.perBox}
          onChange={(e) => onChange({ perBox: e.target.value.replace(/[^\d.]/g, "") })}
        />
      </div>
    </>
  );
}

/** Existing medications the one being typed may be, each with what to do instead of a duplicate. */
function SimilarList({
  matches,
  onAddPack,
  onSupply,
}: {
  matches: SimilarMatch<MedicationRecord>[];
  onAddPack: (m: MedicationRecord) => void;
  onSupply: (m: MedicationRecord) => void;
}) {
  if (!matches.length) return null;
  const strong = matches.some((x) => x.kind === "same");
  return (
    <div
      className={cn(
        "grid gap-2 rounded-lg border p-3 text-sm sm:col-span-2",
        strong ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/40" : "bg-muted/30",
      )}
      aria-live="polite"
    >
      <p className={cn("flex items-center gap-1.5 font-medium", strong && "text-amber-900 dark:text-amber-300")}>
        <TriangleAlertIcon className="size-4 shrink-0" />
        {strong ? "这种药已经有了：同一种药换了厂家，请加为它的厂家（同一张卡片，余量和储备按厂家分开记）" : `已有 ${matches.length} 种相近的药，确认不是重复再新建`}
      </p>
      <ul className="grid gap-1.5">
        {matches.map(({ medication: m, kind, samePack }) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline" className={cn("font-normal", kind === "same" && "border-amber-400 text-amber-900 dark:text-amber-300")}>
              {samePack ? "同一种药 · 同厂家" : SIMILARITY_LABEL[kind]}
            </Badge>
            <span className="font-medium">{medTitle(m)}</span>
            <span className="min-w-0 text-xs text-muted-foreground">{packsText(m)}</span>
            <TagBadges tags={m.tags} />
            <span className="ml-auto flex gap-1">
              {(kind === "same" || kind === "drug") && !samePack && (
                <Button type="button" size="xs" variant={kind === "same" ? "default" : "outline"} onClick={() => onAddPack(m)}>
                  <PackagePlusIcon />
                  加为厂家
                </Button>
              )}
              <Button type="button" size="xs" variant="ghost" onClick={() => onSupply(m)}>
                去补药
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {matches.some((x) => x.kind === "strength") && (
        <p className="text-xs text-muted-foreground">另一种规格（如 3mg / 6mg）是另一种药、余量分开算，照常新建即可；同名的药在列表里会排在一起。</p>
      )}
    </div>
  );
}

export function CreateMedicationDialog({
  open,
  onOpenChange,
  today,
  medications,
  onSupply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: ISODate;
  /** Every medication, to catch duplicates while typing. */
  medications: MedicationRecord[];
  /** Open the supply dialog of an existing medication instead. */
  onSupply: (id: number) => void;
}) {
  const [fields, setFields] = useState<FieldValues>(emptyFields);
  const [tags, setTags] = useState<string[]>([]);
  /** Adding a manufacturer to this medication instead of a new medication. */
  const [target, setTarget] = useState<MedicationRecord | null>(null);
  const [confirming, setConfirming] = useState<null | (() => void)>(null);
  const [startDate, setStartDate] = useState(today);
  const [amount, setAmount] = useState(() => amountState());
  const [reserve, setReserveAmount] = useState(() => amountState());
  const [doses, setDoses] = useState({ morning: "0", noon: "0", evening: "0" });
  const { pending, error, setError, submit } = useActionForm();
  const matches = useMemo(
    () => findSimilar({ name: fields.name, dosage: fields.dosage, brand: fields.brand }, medications).slice(0, 6),
    [fields.name, fields.dosage, fields.brand, medications],
  );

  const reset = () => {
    setFields(emptyFields);
    setTags([]);
    setTarget(null);
    setConfirming(null);
    setStartDate(today);
    setAmount(amountState());
    setReserveAmount(amountState());
    setDoses({ morning: "0", noon: "0", evening: "0" });
    setError(null);
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };
  const onFields = (patch: Partial<FieldValues>) => {
    const v = { ...fields, ...patch };
    // Typing the box size also fills it into the amount inputs that still have the old one.
    if (v.perBox !== fields.perBox) {
      const sync = (a: AmountState) => (a.perBox === fields.perBox ? { ...a, perBox: v.perBox } : a);
      setAmount(sync);
      setReserveAmount(sync);
    }
    setFields(v);
  };
  const goSupply = (m: MedicationRecord) => {
    close();
    onSupply(m.id);
  };
  const startPack = (m: MedicationRecord) => {
    setConfirming(null);
    setError(null);
    setTarget(m);
    // A brand that is already one of its packs is not a new manufacturer.
    if (m.packs.some((p) => (p.brand ?? "") === fields.brand.trim())) setFields((f) => ({ ...f, brand: "" }));
  };

  const savePack = (m: MedicationRecord) => {
    const input = toPack(fields);
    const parsed = packSchema.safeParse(input);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
    if (!parsed.data.brand) return setError("请填写厂家 / 品牌");
    submit(
      () => addPack(m.id, input),
      () => {
        toast.success(`已给「${medTitle(m)}」添加厂家「${parsed.data.brand}」`, {
          action: { label: "去补药", onClick: () => onSupply(m.id) },
        });
        close();
      },
    );
  };

  const saveNew = () => {
    const qty = resolveAmount(amount, fields.packUnit);
    if ("error" in qty) return setError(qty.error);
    const res = resolveAmount(reserve, fields.packUnit);
    if ("error" in res) return setError(res.error);
    const d = parseDoses(doses);
    const hasRegimen = [d.morning, d.noon, d.evening].some((v) => v === null || v > 0);
    const input = {
      name: fields.name,
      dosage: fields.dosage,
      ...toPack(fields),
      tags,
      reserve: res.value ?? 0,
      initialSupply: qty.value !== null ? { date: startDate, quantity: qty.value } : null,
      initialRegimen: hasRegimen ? { effectiveFrom: startDate, ...(d as Record<keyof typeof d, number>) } : null,
    };
    const parsed = createMedicationSchema.safeParse(input);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
    const create = () =>
      submit(
        () => createMedication(input),
        () => {
          toast.success(`已添加「${parsed.data.name}」`);
          close();
        },
      );
    // Still a new one although it looks like an existing medication: say so first.
    if (matches.length) setConfirming(() => create);
    else create();
  };

  const same = matches.filter((x) => x.kind === "same");

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target ? "添加厂家 / 包装" : "新增药品"}</DialogTitle>
          <DialogDescription>
            {target
              ? "同一种药（同名、同规格）换了厂家或品牌：加为它的一个厂家，和原来的放在同一张卡片、共用服用规律；余量和储备按厂家分开记，先吃默认厂家的。"
              : "一种药 = 一个名称 + 一个规格。输入名称时会自动查找已有的药，避免重复；同一种药不同厂家请加为厂家，不同规格另建。"}
          </DialogDescription>
        </DialogHeader>
        {target ? (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              savePack(target);
            }}
          >
            <div className="grid gap-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <b>{medTitle(target)}</b>
                <TagBadges tags={target.tags} />
              </span>
              <span className="text-xs text-muted-foreground">已有：{packsText(target)}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <PackInputs values={fields} onChange={onFields} brandRequired />
            </div>
            <FormError>{error}</FormError>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => setTarget(null)}>
                <CopyPlusIcon />
                改为新建一种药
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                取消
              </Button>
              <SubmitButton pending={pending}>添加厂家</SubmitButton>
            </div>
          </form>
        ) : (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              saveNew();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <NameInputs values={fields} onChange={onFields} />
              <SimilarList matches={matches} onAddPack={startPack} onSupply={goSupply} />
              <PackInputs values={fields} onChange={onFields} />
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium">
                标签 <span className="font-normal text-muted-foreground">（选填：精一 / 精二 / 麻醉、处方 / 非处方、医保等）</span>
              </span>
              <TagPicker value={tags} onChange={setTags} />
            </div>
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
              <SupplyAmountInput id="init-reserve" label="药物储备（选填）" value={reserve} onChange={setReserveAmount} unit={fields.packUnit} />
              <p className="text-xs text-muted-foreground">家中额外备着、以防万一的药，不计入当前余量。</p>
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                取消
              </Button>
              <SubmitButton pending={pending}>添加</SubmitButton>
            </div>
          </form>
        )}
        <AlertDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{same.length ? "这种药已经有了，还要新建吗？" : "已有相近的药，确定新建？"}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="grid gap-2">
                  <p>
                    {same.length
                      ? `「${medTitle(same[0].medication)}」已经在列表里。新建会多出一份独立的余量和规律，两边要分别补药、盘点；同一种药换了厂家，应加为它的厂家。`
                      : "下面这些药和要新建的很像。如果是同一种药，请返回改为补药或加为厂家；确认不是再新建。"}
                  </p>
                  <ul className="grid gap-1 text-foreground">
                    {matches.map(({ medication: m, kind }) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-normal">
                          {SIMILARITY_LABEL[kind]}
                        </Badge>
                        {medTitle(m)}
                        <span className="text-xs text-muted-foreground">{packsText(m)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>返回修改</AlertDialogCancel>
              {same.length > 0 && !same[0].samePack && (
                <Button variant="outline" onClick={() => startPack(same[0].medication)}>
                  加为它的厂家
                </Button>
              )}
              <AlertDialogAction
                variant={same.length ? "destructive" : "default"}
                onClick={() => {
                  const go = confirming;
                  setConfirming(null);
                  go?.();
                }}
              >
                仍然新建
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** Name, strength and tags; the packs (manufacturers) are edited in their own list. */
export function EditMedicationForm({ medication, onDone }: { medication: MedicationRecord; onDone: () => void }) {
  const [fields, setFields] = useState({ name: medication.name, dosage: medication.dosage });
  const [tags, setTags] = useState(medication.tags);
  const { pending, error, setError, submit } = useActionForm();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { ...fields, tags };
        const parsed = medicationInfoSchema.safeParse(input);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(() => updateMedication(medication.id, input), onDone);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NameInputs values={fields} onChange={(v) => setFields((f) => ({ ...f, ...v }))} />
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">标签</span>
        <TagPicker value={tags} onChange={setTags} />
      </div>
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

const medLabel = (m: MedicationRecord) => [m.name, m.dosage, m.packs.map((p) => p.brand).filter(Boolean).join(" / ")].filter(Boolean).join(" · ");

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
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>补药</DialogTitle>
          <DialogDescription>{medication && medLabel(medication)}</DialogDescription>
        </DialogHeader>
        {medication && (
          <SupplyForm
            key={medication.id}
            today={today}
            packs={medication.packs}
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
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-lg">
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
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>药物储备</DialogTitle>
          <DialogDescription>{medication && medLabel(medication)}</DialogDescription>
        </DialogHeader>
        {medication && <ReservePanel key={medication.id} medication={medication} today={today} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

type ReserveTab = "add" | "draw" | "count";
const RESERVE_TABS: [ReserveTab, string][] = [
  ["add", "加入储备"],
  ["draw", "从储备取用"],
  ["count", "盘点储备"],
];

/** "2 盒 14 颗（42 颗）", or "14 颗" when that says it all. */
const reserveText = (pills: number, p: Pick<PackRecord, "perBox" | "packUnit">) => {
  const packs = fmtPacks(pills, p.perBox, p.packUnit);
  return p.perBox && pills >= p.perBox ? `${packs}（${fmtQty(pills)} 颗）` : packs;
};

/** Each manufacturer's reserve, kept apart: put more aside, take some into the current stock, or count it. */
export function ReservePanel({ medication, today, onDone }: { medication: MedicationRecord; today: ISODate; onDone: () => void }) {
  const [tab, setTab] = useState<ReserveTab>("add");
  const [packId, setPackId] = useState(medication.packs[0]?.id ?? 0);
  const pack = medication.packs.find((p) => p.id === packId) ?? medication.packs[0];
  const current = regimenAt(medication.regimens, today);
  const multi = medication.packs.length > 1;
  const brand = multi ? (pack.brand ?? "未写厂家") : "";
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        储备是家里除当前在吃的药以外，额外备着以防万一的药。它不计入当前余量、能吃到的日期和就诊计划，只估算按当前规律
        {current ? `（${formatRegimenShort(current)}）` : ""}能用多久。{multi && "每个厂家的储备分开记。"}
      </p>
      <div className="grid gap-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{multi ? "储备合计" : "现有储备"}</span>
          <span className="text-right tabular-nums">
            <b>{multi ? `${fmtQty(medication.reserve)} 颗` : reserveText(medication.reserve, pack)}</b>
            <span className="ml-1.5 text-muted-foreground">· {describeReserve(medication.reserve, current)}</span>
          </span>
        </div>
        {multi &&
          medication.packs.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{p.brand ?? "未写厂家"}</span>
              <span className="tabular-nums">{reserveText(p.reserve, p)}</span>
            </div>
          ))}
      </div>
      {multi && (
        <PackPicker
          label="哪个厂家"
          packs={medication.packs}
          value={pack.id}
          onChange={(p) => setPackId(p.id)}
          note={(p) => `储备 ${fmtQty(p.reserve)} 颗`}
        />
      )}
      <div role="tablist" aria-label="储备操作" className="inline-flex w-fit rounded-md border p-0.5 text-sm">
        {RESERVE_TABS.map(([key, text]) => (
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
      {tab === "add" ? (
        <ReserveAddForm key={`add-${pack.id}`} medication={medication} pack={pack} brand={brand} today={today} onDone={onDone} />
      ) : tab === "draw" ? (
        <ReserveDrawForm key={`draw-${pack.id}`} pack={pack} brand={brand} today={today} onDone={onDone} />
      ) : (
        <ReserveCountForm key={`count-${pack.id}`} medication={medication} pack={pack} brand={brand} today={today} onDone={onDone} />
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

interface ReserveFormProps {
  medication: MedicationRecord;
  pack: PackRecord;
  /** The pack's brand when the medication has several, else "". */
  brand: string;
  today: ISODate;
  onDone: () => void;
}

/** "保存后：江苏恩华 174 颗，合计 202 颗 · 可用 101 天" */
function reservePreview({ medication, pack, brand, today }: Omit<ReserveFormProps, "onDone">, next: number) {
  const total = medication.reserve - pack.reserve + next;
  const lasts = describeReserve(total, regimenAt(medication.regimens, today));
  return brand ? `${brand} ${fmtQty(next)} 颗，合计 ${fmtQty(total)} 颗 · ${lasts}` : `${reserveText(next, pack)} · ${lasts}`;
}

function ReserveAddForm(props: ReserveFormProps) {
  const { pack, brand, onDone } = props;
  const [amount, setAmount] = useState(() => amountState("", pack.perBox));
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();
  const resolved = resolveAmount(amount, pack.packUnit);
  const value = "value" in resolved ? resolved.value : null;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if ("error" in resolved) return setError(resolved.error);
        const parsed = quantitySchema.safeParse(value);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(
          () => addReserve(pack.id, parsed.data),
          () => {
            toast.success(`已加入${brand}储备 ${fmtQty(parsed.data)} 颗`);
            onDone();
          },
        );
      }}
    >
      <SupplyAmountInput id={`${uid}-qty`} label={`加入${brand}储备的数量`} value={amount} onChange={setAmount} unit={pack.packUnit} />
      <p className="text-xs text-muted-foreground">新买来或另外放起来的药，加在现有储备上；不计入当前余量。</p>
      {value ? <p className="text-sm tabular-nums">加入后：{reservePreview(props, pack.reserve + value)}</p> : null}
      <FormError>{error}</FormError>
      <FormButtons pending={pending} label="加入" onCancel={onDone} />
    </form>
  );
}

function ReserveCountForm(props: ReserveFormProps) {
  const { pack, brand, onDone } = props;
  const [amount, setAmount] = useState(() => amountInPacks(pack.reserve, pack.perBox));
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();
  const resolved = resolveAmount(amount, pack.packUnit);
  const preview = "value" in resolved ? reservePreview(props, resolved.value ?? 0) : null;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if ("error" in resolved) return setError(resolved.error);
        const parsed = reserveSchema.safeParse(resolved.value ?? 0);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(
          () => setReserve(pack.id, parsed.data),
          () => {
            toast.success("储备已更新");
            onDone();
          },
        );
      }}
    >
      <SupplyAmountInput id={`${uid}-reserve`} label={`现在家里${brand}的储备`} value={amount} onChange={setAmount} unit={pack.packUnit} />
      <p className="text-xs text-muted-foreground">
        按实际清点填写，替换原来的数：整{pack.packUnit}按{pack.packUnit}数，拆开用过的那{pack.packUnit}把剩下的颗数填进“散装”。清空即为没有储备。
      </p>
      {preview && <p className="text-sm tabular-nums">保存后：{preview}</p>}
      <FormError>{error}</FormError>
      <FormButtons pending={pending} label="保存" onCancel={onDone} />
    </form>
  );
}

function ReserveDrawForm({ pack, brand, today, onDone }: Omit<ReserveFormProps, "medication">) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(() => amountState("", pack.perBox));
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();
  const resolved = resolveAmount(amount, pack.packUnit);
  const value = "value" in resolved ? resolved.value : null;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if ("error" in resolved) return setError(resolved.error);
        const parsed = drawSchema.safeParse({ date, quantity: value });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        if (parsed.data.quantity > pack.reserve) return setError(`${brand}储备只有 ${fmtQty(pack.reserve)} 颗`);
        submit(
          () => drawFromReserve(pack.id, parsed.data),
          () => {
            toast.success(`已从${brand}储备取用 ${fmtQty(parsed.data.quantity)} 颗`);
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
        <SupplyAmountInput id={`${uid}-qty`} label="取用数量" value={amount} onChange={setAmount} unit={pack.packUnit} />
      </div>
      <p className="text-xs text-muted-foreground">
        取出的药记为 {fmtDate(date)} 的一笔{brand}补药、计入当前余量，{brand}储备同时减少
        {value ? `，剩 ${fmtQty(Math.max(0, pack.reserve - value))} 颗` : ""}。
      </p>
      <FormError>{error}</FormError>
      <FormButtons pending={pending} label="取用" onCancel={onDone} />
    </form>
  );
}
