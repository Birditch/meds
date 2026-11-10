"use client";

import { PencilIcon, PlusIcon, StarIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addPack, deletePack, setDefaultPack, updatePack } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtPacks, fmtQty, packShares, type MedicationStatus, type PackShare } from "@/lib/meds/format";
import type { ActionResult, MedicationRecord, PackRecord, PackUnit } from "@/lib/meds/types";
import { packSchema } from "@/lib/meds/validation";
import { useCatalogMatch } from "./catalog-fields";
import { FormError, SubmitButton, useActionForm } from "./forms";
import { ConfirmDelete } from "./history";
import { PackInputs } from "./medication-dialogs";

type Values = { brand: string; packUnit: PackUnit; perBox: string };

/** "28 颗（2 盒）" */
export const pillsAndPacks = (pills: number, p: Pick<PackRecord, "perBox" | "packUnit">) =>
  p.perBox && pills >= p.perBox ? `${fmtQty(pills)} 颗（${fmtPacks(pills, p.perBox, p.packUnit)}）` : `${fmtQty(pills)} 颗`;

/** One line per manufacturer: "湖南洞庭 28 颗（2 盒）". */
export function PackAmounts({ shares, of, className }: { shares: readonly PackShare[]; of: "stock" | "reserve"; className?: string }) {
  return (
    <span className={className ?? "grid justify-items-end text-xs text-muted-foreground tabular-nums"}>
      {shares.map(({ pack, ...amounts }) => (
        <span key={pack.id}>
          {pack.brand ?? "未写厂家"} {pillsAndPacks(amounts[of], pack)}
        </span>
      ))}
    </span>
  );
}

function PackForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
  catalogFor,
}: {
  initial: Values;
  submitLabel: string;
  onSubmit: (fields: { brand: string; packUnit: PackUnit; perBox: number | null }) => Promise<ActionResult>;
  onDone: () => void;
  /** Adding a manufacturer: suggest who makes this drug. */
  catalogFor?: Pick<MedicationRecord, "name" | "dosage">;
}) {
  const [values, setValues] = useState(initial);
  const { pending, error, setError, submit } = useActionForm();
  const match = useCatalogMatch(catalogFor?.name ?? "", catalogFor?.dosage ?? "", [values.brand]);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { brand: values.brand, packUnit: values.packUnit, perBox: values.perBox.trim() ? Number(values.perBox) : null };
        const parsed = packSchema.safeParse(input);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        submit(() => onSubmit(input), onDone);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <PackInputs values={values} onChange={(v) => setValues((x) => ({ ...x, ...v }))} {...(catalogFor ? { catalog: match } : {})} />
      </div>
      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          取消
        </Button>
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

const valuesOf = (p?: PackRecord): Values => ({ brand: p?.brand ?? "", packUnit: p?.packUnit ?? "盒", perBox: p?.perBox ? String(p.perBox) : "" });

/**
 * The manufacturers / brands this pill comes from, each with its own stock and reserve. The
 * default one's pills are taken first and its pack size counts the boxes to get at a visit.
 */
export function PacksPanel({ medication, status }: { medication: MedicationRecord; status: Pick<MedicationStatus, "byPack" | "balanceNow"> }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const packs = medication.packs;
  const shares = packShares(medication, status);
  return (
    <section className="grid content-start gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          厂家 / 包装（同名同规格，每个厂家的余量和储备分开记；先吃“默认”的，就诊按它的每{medication.packUnit}颗数算{medication.packUnit}数）
        </span>
        <Button
          size="xs"
          variant={adding ? "secondary" : "ghost"}
          onClick={() => {
            setAdding((v) => !v);
            setEditing(null);
          }}
        >
          <PlusIcon />
          添加厂家
        </Button>
      </div>
      {adding && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <PackForm
            initial={{ ...valuesOf(), packUnit: medication.packUnit }}
            submitLabel="添加"
            catalogFor={medication}
            onSubmit={(f) => addPack(medication.id, f)}
            onDone={() => setAdding(false)}
          />
        </div>
      )}
      <ul className="divide-y rounded-lg border">
        {packs.map((p, i) =>
          editing === p.id ? (
            <li key={p.id} className="bg-muted/30 p-3">
              <PackForm initial={valuesOf(p)} submitLabel="保存" onSubmit={(f) => updatePack(p.id, f)} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="font-medium">{p.brand ?? "未写厂家"}</span>
              <span className="text-muted-foreground tabular-nums">{p.perBox ? `${fmtQty(p.perBox)} 颗/${p.packUnit}` : `${p.packUnit}装，未写每${p.packUnit}颗数`}</span>
              {i === 0 && packs.length > 1 && <Badge variant="secondary">默认</Badge>}
              {packs.length > 1 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  余 {pillsAndPacks(shares[i].stock, p)} · 储备 {pillsAndPacks(shares[i].reserve, p)}
                </span>
              )}
              <div className="ml-auto flex items-center">
                {i > 0 && p.id > 0 && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await setDefaultPack(p.id);
                        if (!r.ok) toast.error(r.error);
                      })
                    }
                  >
                    <StarIcon />
                    设为默认
                  </Button>
                )}
                {p.id > 0 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="编辑"
                    className="text-muted-foreground"
                    onClick={() => {
                      setEditing(p.id);
                      setAdding(false);
                    }}
                  >
                    <PencilIcon />
                  </Button>
                )}
                {packs.length > 1 && (
                  <ConfirmDelete
                    title={`删除厂家「${p.brand ?? "未写厂家"}」？`}
                    description={`它的余量和储备并入${i === 0 ? "下一个" : "默认"}厂家（用它补过的药不再标明厂家），只对它做的盘点会删掉。`}
                    onConfirm={() => deletePack(p.id)}
                  />
                )}
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
