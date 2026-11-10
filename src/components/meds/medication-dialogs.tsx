"use client";

import { CopyIcon, CopyPlusIcon, PackagePlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { addPack, addReserve, addSupply, createMedication, drawFromReserve, saveRegimen, setReserve, transferToReserve, updateMedication } from "@/app/actions";
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
import { describeReserve, fmtPacks, fmtQty, formatRegimen, formatRegimenShort, intakeAt, isTaking, packShares, type MedicationStatus } from "@/lib/meds/format";
import { SIMILARITY_LABEL, findSimilar, type SimilarMatch } from "@/lib/meds/similar";
import { regimenAt, type DateRange } from "@/lib/meds/simulate";
import type { CatalogMatch } from "@/lib/meds/drug-catalog/match";
import { normalizeTags } from "@/lib/meds/tags";
import { PACK_UNITS, type MedicationRecord, type PackRecord, type PackUnit } from "@/lib/meds/types";
import { createMedicationSchema, medicationInfoSchema, packSchema, quantitySchema, reserveDrawSchema, reserveEntrySchema, reserveSchema } from "@/lib/meds/validation";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import {
  CatalogMakerInput,
  CatalogMatchNote,
  CatalogNameInput,
  CatalogPackChips,
  CatalogStrengthInput,
  CatalogTagSuggestion,
  keepDialogForSuggestions,
  useCatalogMatch,
} from "./catalog-fields";
import { DoseFields, FormError, PackPicker, RegimenForm, SourceInput, SubmitButton, SupplyForm, packLabel, parseDoses, useActionForm } from "./forms";
import { SupplyAmountInput, amountInPacks, amountState, resolveAmount, type AmountState } from "./supply-amount";
import { DialogStrengthTabs, type StrengthSwitch } from "./strength-tabs";
import { TagBadges, TagPicker } from "./tags";

type PackValues = { brand: string; packUnit: PackUnit; perBox: string };
type FieldValues = PackValues & { name: string; dosage: string };

const emptyFields: FieldValues = { name: "", brand: "", dosage: "", packUnit: "盒", perBox: "" };

const toPack = (v: PackValues) => ({ brand: v.brand, packUnit: v.packUnit, perBox: v.perBox.trim() ? Number(v.perBox) : null });

/** "氯硝西泮片 2mg" with its manufacturers. */
const medTitle = (m: Pick<MedicationRecord, "name" | "dosage">) => `${m.name} ${m.dosage}`;
const packsText = (m: MedicationRecord) => m.packs.map(packLabel).join("；");

function NameInputs({
  values,
  onChange,
  dosageRef,
  catalog,
}: {
  values: Pick<FieldValues, "name" | "dosage">;
  onChange: (v: Partial<FieldValues>) => void;
  dosageRef?: React.Ref<HTMLInputElement>;
  /** Suggest from the drug catalog while typing. */
  catalog?: { match: CatalogMatch | null; onPick: (drug: { name: string; strength: string }) => void };
}) {
  const uid = useId();
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-name`}>药品名称</Label>
        {catalog ? (
          <CatalogNameInput id={`${uid}-name`} value={values.name} onChange={(name) => onChange({ name })} onPick={catalog.onPick} />
        ) : (
          <Input
            id={`${uid}-name`}
            placeholder="通用名，如：氯硝西泮片"
            autoComplete="off"
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            required
          />
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-dosage`}>含量/规格</Label>
        {catalog ? (
          <CatalogStrengthInput id={`${uid}-dosage`} inputRef={dosageRef} value={values.dosage} onChange={(dosage) => onChange({ dosage })} strengths={catalog.match?.strengths ?? []} />
        ) : (
          <Input
            ref={dosageRef}
            id={`${uid}-dosage`}
            placeholder="如：2mg"
            value={values.dosage}
            onChange={(e) => onChange({ dosage: e.target.value })}
            required
          />
        )}
      </div>
    </>
  );
}

export function PackInputs({
  values,
  onChange,
  brandRequired,
  catalog,
  brandRef,
}: {
  values: PackValues;
  onChange: (v: Partial<PackValues>) => void;
  brandRequired?: boolean;
  /** Set (even to null) to suggest manufacturers and pack sizes from the drug catalog. */
  catalog?: CatalogMatch | null;
  brandRef?: React.Ref<HTMLInputElement>;
}) {
  const uid = useId();
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-brand`}>
          厂家 / 品牌 {!brandRequired && <span className="font-normal text-muted-foreground">（选填）</span>}
        </Label>
        {catalog !== undefined ? (
          <CatalogMakerInput
            id={`${uid}-brand`}
            inputRef={brandRef}
            match={catalog}
            required={brandRequired}
            value={values.brand}
            onChange={(brand) => onChange({ brand })}
            onPick={(brand, pack) => onChange({ brand, ...pack })}
          />
        ) : (
          <Input
            id={`${uid}-brand`}
            placeholder="如：江苏恩华"
            value={values.brand}
            onChange={(e) => onChange({ brand: e.target.value })}
            required={brandRequired}
          />
        )}
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
      {catalog !== undefined && <CatalogPackChips match={catalog} value={values} onPick={onChange} />}
    </>
  );
}

/** Existing medications the one being typed may be, each with what to do instead of a duplicate. */
function SimilarList({
  matches,
  template,
  onAddPack,
  onSupply,
  onTemplate,
}: {
  matches: SimilarMatch<MedicationRecord>[];
  /** The medication the form was filled from, if any. */
  template: MedicationRecord | null;
  onAddPack: (m: MedicationRecord) => void;
  onSupply: (m: MedicationRecord) => void;
  onTemplate: (m: MedicationRecord) => void;
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
              {kind === "same" && samePack ? "同一种药 · 同厂家" : SIMILARITY_LABEL[kind]}
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
              {template?.id !== m.id && (
                <Button type="button" size="xs" variant="ghost" title="照它填好名称、厂家、包装和标签，再改规格" onClick={() => onTemplate(m)}>
                  <CopyIcon />
                  作为模板
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
        <p className="text-xs text-muted-foreground">另一种规格（如 3mg / 6mg）余量分开算，照常新建即可（可以先点“作为模板”）；它和已有的规格放在同一张卡片里，按规格分标签页。</p>
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
  /** Tags chosen by hand; what the catalog establishes is added at render. */
  const [manualTags, setTags] = useState<string[]>([]);
  /** Catalog tags taken off for one particular match; a different drug starts over. */
  const [removedAuto, setRemovedAuto] = useState({ key: "", tags: [] as string[] });
  /** Adding a manufacturer to this medication instead of a new medication. */
  const [target, setTarget] = useState<MedicationRecord | null>(null);
  /** The existing medication the form was filled from (another strength of it, usually). */
  const [template, setTemplate] = useState<MedicationRecord | null>(null);
  const dosageRef = useRef<HTMLInputElement>(null);
  const brandRef = useRef<HTMLInputElement>(null);
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

  const match = useCatalogMatch(target?.name ?? fields.name, target?.dosage ?? fields.dosage, [fields.brand]);
  const autoTags = target ? [] : (match?.tags ?? []);
  const autoKey = `${match?.group?.id ?? ""}|${autoTags.join(",")}`;
  const removed = removedAuto.key === autoKey ? removedAuto.tags : [];
  // By hand comes last: it wins over the catalog among tags that exclude each other.
  const tags = normalizeTags([...autoTags.filter((t) => !removed.includes(t)), ...manualTags]);
  const onTags = (next: string[]) => {
    setRemovedAuto({ key: autoKey, tags: autoTags.filter((t) => !next.includes(t)) });
    setTags(next.filter((t) => !autoTags.includes(t)));
  };

  const reset = () => {
    setFields(emptyFields);
    setTags([]);
    setRemovedAuto({ key: "", tags: [] });
    setTarget(null);
    setTemplate(null);
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

  /** Fills the form from an existing medication: name, strength, its default pack and tags (not its stock or regimen). */
  const fromTemplate = (m: MedicationRecord) => {
    const perBox = m.perBox ? String(m.perBox) : "";
    setFields({ name: m.name, dosage: m.dosage, brand: m.brand ?? "", packUnit: m.packUnit, perBox });
    setTags(m.tags);
    // Like typing the box size: the amounts (optional, left as they are) get it too.
    setAmount((a) => ({ ...a, perBox }));
    setReserveAmount((a) => ({ ...a, perBox }));
    setTemplate(m);
    setError(null);
    // The strength is what usually changes: ready to type over.
    requestAnimationFrame(() => {
      dosageRef.current?.focus();
      dosageRef.current?.select();
    });
  };

  /** A drug picked from the catalog: name and strength are settled, the manufacturer is next. */
  const pickDrug = (drug: { name: string; strength: string }) => {
    onFields({ name: drug.name, dosage: drug.strength });
    setTemplate(null);
    setError(null);
    requestAnimationFrame(() => brandRef.current?.focus());
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
    // Still a new one although it looks like an existing medication: say so first. Filled from a
    // template, the list was seen already: only the very same medication still asks.
    if (matches.some((x) => x.kind === "same") || (matches.length > 0 && !template)) setConfirming(() => create);
    else create();
  };

  const same = matches.filter((x) => x.kind === "same");
  const initialAmount = resolveAmount(amount, fields.packUnit);
  const goesToReserve = "value" in initialAmount && !!initialAmount.value && !Object.values(doses).some((v) => Number(v) > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl" onEscapeKeyDown={keepDialogForSuggestions}>
        <DialogHeader>
          <DialogTitle>{target ? "添加厂家 / 包装" : "新增药品"}</DialogTitle>
          <DialogDescription>
            {target
              ? "同一种药（同名、同规格）换了厂家或品牌：加为它的一个厂家，和原来的放在同一张卡片、共用服用规律；余量和储备按厂家分开记，先吃默认厂家的。"
              : "一种药 = 一个名称 + 一个规格。输入名称时会自动匹配药品库，并查找已有的药避免重复；同一种药不同厂家请加为厂家，不同规格另建。"}
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
              <PackInputs values={fields} onChange={onFields} brandRequired catalog={match} />
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
            {template && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">
                <CopyIcon className="size-4 shrink-0" />
                <span className="flex-1">
                  已按「{medTitle(template)}」填好名称、规格、厂家、包装和标签；改成新的规格（含量）再添加。药量、规律和储备不会照抄。
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setTemplate(null);
                    setFields(emptyFields);
                    setTags([]);
                  }}
                >
                  清空
                </Button>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <NameInputs values={fields} onChange={onFields} dosageRef={dosageRef} catalog={{ match, onPick: pickDrug }} />
              <CatalogMatchNote match={match} nameDone={fields.dosage.trim() !== ""} onUseName={(name) => onFields({ name })} onPick={(c) => pickDrug({ name: c.name, strength: c.strength })} />
              <SimilarList matches={matches} template={template} onAddPack={startPack} onSupply={goSupply} onTemplate={fromTemplate} />
              <PackInputs values={fields} onChange={onFields} catalog={match} brandRef={brandRef} />
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium">
                标签 <span className="font-normal text-muted-foreground">（匹配到药品库会自动判断，可以删改；处方 / 非处方大多要自己选）</span>
              </span>
              <TagPicker value={tags} onChange={onTags} />
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
              {goesToReserve && <p className="text-xs text-muted-foreground">没填服用规律：这些药会记入储备，不计入当前余量。</p>}
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
  const match = useCatalogMatch(fields.name, fields.dosage, medication.packs.map((p) => p.brand ?? ""));
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
      <CatalogTagSuggestion tags={tags} match={match} onApply={setTags} onUseName={(name) => setFields((f) => ({ ...f, name }))} />
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

/** A row of mutually exclusive actions. */
function ModeTabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: readonly (readonly [T, string])[]; value: T; onChange: (tab: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex w-fit flex-wrap rounded-md border p-0.5 text-sm">
      {tabs.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "rounded-[5px] px-3 py-1 transition-colors",
            value === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const SUPPLY_TABS = [
  ["new", "新开的药"],
  ["draw", "从储备拉取"],
  ["restock", "补进储备"],
] as const;
type SupplyTab = (typeof SUPPLY_TABS)[number][0];

export function AddSupplyDialog({
  medication,
  onOpenChange,
  today,
  pauses,
  visits,
  ...switcher
}: StrengthSwitch & {
  medication: MedicationRecord | null;
  onOpenChange: (open: boolean) => void;
  today: ISODate;
  pauses: readonly DateRange[];
  /** Upcoming visit dates. */
  visits: readonly ISODate[];
}) {
  const taking = !medication || isTaking(intakeAt(medication.regimens, today));
  const done = () => onOpenChange(false);
  return (
    <Dialog open={!!medication} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{taking ? "补药" : "补进储备"}</DialogTitle>
          <DialogDescription>{medication && medLabel(medication)}</DialogDescription>
        </DialogHeader>
        <DialogStrengthTabs medication={medication} {...switcher} />
        {medication &&
          (taking ? (
            <SupplyPanel key={medication.id} medication={medication} today={today} pauses={pauses} visits={visits} onDone={done} />
          ) : (
            <div key={medication.id} className="grid gap-4">
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                这种药现在没在吃，补的药进储备，不计入当前余量。开始吃（改规律）时，可以再选要拿多少到当前。
              </p>
              <ReserveForms medication={medication} tab="restock" today={today} onDone={done} />
            </div>
          ))}
      </DialogContent>
    </Dialog>
  );
}

/** Refilling a medication being taken: newly prescribed pills, pills from the reserve, or pills for the reserve. */
function SupplyPanel({
  medication,
  today,
  pauses,
  visits,
  onDone,
}: {
  medication: MedicationRecord;
  today: ISODate;
  pauses: readonly DateRange[];
  visits: readonly ISODate[];
  onDone: () => void;
}) {
  const [tab, setTab] = useState<SupplyTab>("new");
  return (
    <div className="grid gap-4">
      <ModeTabs label="补药来源" tabs={SUPPLY_TABS} value={tab} onChange={setTab} />
      {tab === "new" ? (
        <SupplyForm
          today={today}
          packs={medication.packs}
          plan={{ medication, pauses, visits }}
          submitLabel="添加"
          onSubmit={(f) => addSupply(medication.id, f)}
          onDone={() => {
            toast.success("已添加补药记录");
            onDone();
          }}
          onCancel={onDone}
        />
      ) : tab === "draw" && medication.reserve <= 0 ? (
        <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">储备里没有这种药，可以先“补进储备”。</p>
      ) : (
        <ReserveForms medication={medication} tab={tab} today={today} onDone={onDone} />
      )}
    </div>
  );
}

export function RegimenDialog({
  medication,
  onOpenChange,
  today,
  ...switcher
}: StrengthSwitch & {
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
        <DialogStrengthTabs medication={medication} {...switcher} />
        {medication && (
          <RegimenForm
            key={medication.id}
            today={today}
            initial={current ? { morning: current.morning, noon: current.noon, evening: current.evening } : undefined}
            existing={medication.regimens}
            reservePacks={medication.packs}
            submitLabel="保存规律"
            onSubmit={(f, draws) => saveRegimen(medication.id, f, draws)}
            onDone={(draws) => {
              const pills = draws.reduce((n, d) => n + d.quantity, 0);
              toast.success(pills ? `服用规律已保存，已从储备拿 ${fmtQty(pills)} 颗计入当前` : "服用规律已保存");
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

type StockNow = Pick<MedicationStatus, "byPack" | "balanceNow">;

export function ReserveDialog({
  medication,
  status,
  onOpenChange,
  today,
  initialTab,
  ...switcher
}: StrengthSwitch & {
  medication: MedicationRecord | null;
  status: StockNow | null;
  onOpenChange: (open: boolean) => void;
  today: ISODate;
  initialTab?: ReserveTab;
}) {
  return (
    <Dialog open={!!medication} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>药物储备</DialogTitle>
          <DialogDescription>{medication && medLabel(medication)}</DialogDescription>
        </DialogHeader>
        <DialogStrengthTabs medication={medication} {...switcher} />
        {medication && status && (
          <ReservePanel key={medication.id} medication={medication} status={status} today={today} initialTab={initialTab} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

const RESERVE_TABS = [
  ["restock", "补进储备"],
  ["draw", "取用到当前"],
  ["count", "盘点储备"],
  ["transfer", "当前转入储备"],
] as const;
export type ReserveTab = (typeof RESERVE_TABS)[number][0];

/** "2 盒 14 颗（42 颗）", or "14 颗" when that says it all. */
const reserveText = (pills: number, p: Pick<PackRecord, "perBox" | "packUnit">) => {
  const packs = fmtPacks(pills, p.perBox, p.packUnit);
  return p.perBox && pills >= p.perBox ? `${packs}（${fmtQty(pills)} 颗）` : packs;
};

/** Each manufacturer's reserve, kept apart: refill it, take some into the current stock, count it, or put stock back. */
export function ReservePanel({
  medication,
  status,
  today,
  initialTab = "restock",
  onDone,
}: {
  medication: MedicationRecord;
  status: StockNow;
  today: ISODate;
  initialTab?: ReserveTab;
  onDone: () => void;
}) {
  const taking = isTaking(intakeAt(medication.regimens, today));
  const tabs = RESERVE_TABS.filter(([key]) => (key !== "draw" || taking) && (key !== "transfer" || status.balanceNow > 0));
  const [picked, setTab] = useState<ReserveTab>(initialTab);
  const tab = tabs.some(([key]) => key === picked) ? picked : "restock";
  const current = regimenAt(medication.regimens, today);
  const multi = medication.packs.length > 1;
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
            <b>{multi ? `${fmtQty(medication.reserve)} 颗` : reserveText(medication.reserve, medication.packs[0])}</b>
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
      <ModeTabs label="储备操作" tabs={tabs} value={tab} onChange={setTab} />
      <ReserveForms medication={medication} status={status} tab={tab} today={today} onDone={onDone} />
    </div>
  );
}

/** One reserve action, with the manufacturer to do it on when there are several. */
export function ReserveForms({
  medication,
  status,
  tab,
  today,
  onDone,
}: {
  medication: MedicationRecord;
  /** Needed for the "transfer" tab: what is in the current stock. */
  status?: StockNow;
  tab: ReserveTab;
  today: ISODate;
  onDone: () => void;
}) {
  const stockOf = (p: PackRecord) => (status ? (packShares(medication, status).find((s) => s.pack.id === p.id)?.stock ?? 0) : 0);
  const [packId, setPackId] = useState(
    () => medication.packs.find((p) => (tab === "draw" ? p.reserve > 0 : tab === "transfer" ? stockOf(p) > 0 : true))?.id ?? medication.packs[0]?.id ?? 0,
  );
  const pack = medication.packs.find((p) => p.id === packId) ?? medication.packs[0];
  const multi = medication.packs.length > 1;
  const props = { medication, pack, brand: multi ? (pack.brand ?? "未写厂家") : "", today, onDone };
  return (
    <div className="grid gap-4">
      {multi && (
        <PackPicker
          label="哪个厂家"
          packs={medication.packs}
          value={pack.id}
          onChange={(p) => setPackId(p.id)}
          note={(p) => (tab === "transfer" ? `当前 ${fmtQty(stockOf(p))} 颗` : `储备 ${fmtQty(p.reserve)} 颗`)}
        />
      )}
      {tab === "restock" ? (
        <ReserveRestockForm key={`restock-${pack.id}`} {...props} />
      ) : tab === "draw" ? (
        <ReserveDrawForm key={`draw-${pack.id}`} {...props} />
      ) : tab === "count" ? (
        <ReserveCountForm key={`count-${pack.id}`} {...props} />
      ) : (
        <ReserveTransferForm key={`transfer-${pack.id}`} {...props} stock={stockOf(pack)} />
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

function ReserveRestockForm(props: ReserveFormProps) {
  const { pack, brand, today, onDone } = props;
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
        const parsed = reserveEntrySchema.safeParse({ date, quantity: value });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(
          () => addReserve(pack.id, parsed.data),
          () => {
            toast.success(`已补进${brand}储备 ${fmtQty(parsed.data.quantity)} 颗`);
            onDone();
          },
        );
      }}
    >
      <div className="grid items-start gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-date`}>补药日期</Label>
          <DatePicker id={`${uid}-date`} label="补药日期" value={date} onChange={setDate} today={today} />
        </div>
        <SupplyAmountInput id={`${uid}-qty`} label={`补进${brand}储备的数量`} value={amount} onChange={setAmount} unit={pack.packUnit} />
      </div>
      <p className="text-xs text-muted-foreground">新开或买来后放起来的药，加在现有储备上，不计入当前余量；记录在详情的“储备记录”里。</p>
      {value ? <p className="text-sm tabular-nums">补进后：{reservePreview(props, pack.reserve + value)}</p> : null}
      <FormError>{error}</FormError>
      <FormButtons pending={pending} label="补进储备" onCancel={onDone} />
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

function ReserveDrawForm({ pack, brand, today, onDone }: ReserveFormProps) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(() => amountState("", pack.perBox));
  const [source, setSource] = useState("");
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
        const parsed = reserveDrawSchema.safeParse({ date, quantity: value, source });
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
        <SupplyAmountInput id={`${uid}-qty`} label={`取用数量（储备 ${fmtPacks(pack.reserve, pack.perBox, pack.packUnit)}）`} value={amount} onChange={setAmount} unit={pack.packUnit} />
        <SourceInput id={`${uid}-source`} value={source} onChange={setSource} />
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

/** The other way round: pills of the current stock go back into the reserve. */
function ReserveTransferForm({ stock, ...props }: ReserveFormProps & { stock: number }) {
  const { medication, pack, brand, today, onDone } = props;
  // Not being taken: all of it is what is usually meant.
  const [amount, setAmount] = useState(() =>
    isTaking(intakeAt(medication.regimens, today)) ? amountState("", pack.perBox) : amountInPacks(stock, pack.perBox),
  );
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
        if (parsed.data > stock) return setError(`${brand}当前余量只有 ${fmtQty(stock)} 颗`);
        submit(
          () => transferToReserve(pack.id, parsed.data),
          () => {
            toast.success(`已把 ${fmtQty(parsed.data)} 颗转入${brand}储备`);
            onDone();
          },
        );
      }}
    >
      <SupplyAmountInput id={`${uid}-qty`} label={`转入储备的数量（当前 ${fmtPacks(stock, pack.perBox, pack.packUnit)}）`} value={amount} onChange={setAmount} unit={pack.packUnit} />
      <p className="text-xs text-muted-foreground">从当前余量拿出来放进储备：当前余量从现在起减少（记一次盘点），储备增加。</p>
      {value ? (
        <p className="text-sm tabular-nums">
          转入后：当前 {fmtQty(Math.max(0, stock - value))} 颗；储备 {reservePreview(props, pack.reserve + value)}
        </p>
      ) : null}
      <FormError>{error}</FormError>
      <FormButtons pending={pending} label="转入储备" onCancel={onDone} />
    </form>
  );
}
