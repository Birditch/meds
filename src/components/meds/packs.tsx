"use client";

import { PencilIcon, PlusIcon, StarIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addPack, deletePack, setDefaultPack, updatePack } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtQty } from "@/lib/meds/format";
import type { ActionResult, MedicationRecord, PackRecord, PackUnit } from "@/lib/meds/types";
import { packSchema } from "@/lib/meds/validation";
import { FormError, SubmitButton, useActionForm } from "./forms";
import { ConfirmDelete } from "./history";
import { PackInputs } from "./medication-dialogs";

type Values = { brand: string; packUnit: PackUnit; perBox: string };

function PackForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
}: {
  initial: Values;
  submitLabel: string;
  onSubmit: (fields: { brand: string; packUnit: PackUnit; perBox: number | null }) => Promise<ActionResult>;
  onDone: () => void;
}) {
  const [values, setValues] = useState(initial);
  const { pending, error, setError, submit } = useActionForm();
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
        <PackInputs values={values} onChange={(v) => setValues((x) => ({ ...x, ...v }))} />
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
 * The manufacturers / brands this pill comes from. They share one stock; the default one's pack
 * size counts the boxes to get at a visit.
 */
export function PacksPanel({ medication }: { medication: MedicationRecord }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const packs = medication.packs;
  const bought = (id: number) => medication.supplies.filter((s) => s.packId === id).reduce((n, s) => n + s.quantity, 0);
  return (
    <section className="grid content-start gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          厂家 / 包装（同名同规格，共用一份余量；就诊按“默认”的每{medication.packUnit}颗数算{medication.packUnit}数）
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
              {packs.length > 1 && bought(p.id) > 0 && <span className="text-xs text-muted-foreground tabular-nums">补过 {fmtQty(bought(p.id))} 颗</span>}
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
                    description="只删掉这个厂家 / 包装；用它补过的药照样计入余量，只是不再标明厂家。"
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
