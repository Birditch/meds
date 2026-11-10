"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { applyCatalogTags, updateMedication } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CatalogMatch } from "@/lib/meds/drug-catalog/match";
import { proposeTags } from "@/lib/meds/drug-catalog/propose";
import type { MedicationRecord } from "@/lib/meds/types";
import { FormError, useActionForm } from "./forms";
import { TagChanges } from "./catalog-fields";

interface Answer {
  id: number;
  match: CatalogMatch;
}

const STATUS_TEXT: Record<CatalogMatch["status"], string> = { matched: "已匹配", ambiguous: "待确认", none: "没匹配到" };

function makersOf(match: CatalogMatch) {
  return [...new Set(match.makers.map((m) => (m.brand ? `${m.companyShort}（${m.brand}）` : m.companyShort)))].join("、");
}

/** Checks every medication against the catalog once, then shows what it would change. Only a click writes. */
function MatchList({ medications, onDone }: { medications: MedicationRecord[]; onDone: () => void }) {
  const [request] = useState(() => JSON.stringify({ items: medications.map((m) => ({ id: m.id, name: m.name, dosage: m.dosage, brands: m.packs.flatMap((p) => (p.brand ? [p.brand] : [])) })) }));
  const [answers, setAnswers] = useState<Map<number, CatalogMatch> | null>(null);
  const [failed, setFailed] = useState(false);
  const { pending, error, submit } = useActionForm();

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/drug-catalog", { method: "POST", headers: { "content-type": "application/json" }, body: request, signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { results: Answer[] };
        setAnswers(new Map(body.results.map((r) => [r.id, r.match])));
      } catch {
        if (!ctrl.signal.aborted) setFailed(true);
      }
    })();
    return () => ctrl.abort();
  }, [request]);

  if (failed) return <p className="text-sm text-destructive">药品库暂时打不开，请稍后再试。</p>;
  if (!answers) return <p className="text-sm text-muted-foreground">正在匹配 {medications.length} 种药…</p>;

  const rows = medications.map((m) => {
    const match = answers.get(m.id) ?? null;
    const proposal = match && match.status !== "none" ? proposeTags(m.tags, match.tags) : null;
    return { m, match, proposal, pendingCount: proposal ? proposal.additions.length + proposal.conflicts.length : 0 };
  });
  rows.sort((a, b) => Number(b.pendingCount > 0) - Number(a.pendingCount > 0));
  // Taking them all at once only adds: replacing something you set stays a choice per medication.
  const safe = rows.filter((r) => r.match?.status === "matched" && r.proposal && r.proposal.additions.length > 0);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {safe.length > 0 ? `${safe.length} 种药可以补充标签，“全部采用”只加不换；要换掉你已有的标签，请在那一行点采用。` : "没有可以直接补充的标签。"}
        </p>
        <Button
          size="sm"
          disabled={pending || safe.length === 0}
          onClick={() =>
            submit(
              () => applyCatalogTags(safe.map((r) => ({ id: r.m.id, tags: r.proposal!.safeNext }))),
              () => toast.success(`已给 ${safe.length} 种药补充标签`),
            )
          }
        >
          全部采用
        </Button>
      </div>
      <FormError>{error}</FormError>
      <ul className="grid gap-2">
        {rows.map(({ m, match, proposal, pendingCount }) => (
          <li key={m.id} className="grid gap-1.5 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <b>
                {m.name} {m.dosage}
              </b>
              <span className="text-xs text-muted-foreground">{m.packs.map((p) => p.brand).filter(Boolean).join("、")}</span>
              {match && (
                <Badge variant="outline" className="ml-auto font-normal">
                  {STATUS_TEXT[match.status]}
                </Badge>
              )}
            </div>
            {match?.group && (
              <p className="text-xs text-muted-foreground">
                药品库：{match.group.name} {match.group.strength}
                {makersOf(match) && ` · ${makersOf(match)}`}
              </p>
            )}
            {match?.status === "ambiguous" && (
              <p className="text-xs text-muted-foreground">
                规格或厂家对不上，只列出所有可能都相同的类型。药品库里有：{match.candidates.slice(0, 4).map((c) => `${c.name} ${c.strength}`).join("、")}
              </p>
            )}
            {match?.status === "none" && <p className="text-xs text-muted-foreground">药品库里没有这个名称，可以在“编辑药品信息”里手动标。</p>}
            {match?.suggestedName && match.suggestedName !== m.name && (
              <p className="flex flex-wrap items-center gap-2 text-xs">
                {match.nameBasis === "typo" ? `名称可能写错了，药品库里是「${match.suggestedName}」` : `药品库里的全名是「${match.suggestedName}」`}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    submit(
                      () => updateMedication(m.id, { name: match.suggestedName!, dosage: m.dosage, tags: m.tags }),
                      () => toast.success(`已改名为「${match.suggestedName}」`),
                    )
                  }
                >
                  改成这个
                </Button>
              </p>
            )}
            {proposal && pendingCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TagChanges additions={proposal.additions} conflicts={proposal.conflicts} />
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    submit(
                      () => applyCatalogTags([{ id: m.id, tags: proposal.next }]),
                      () => toast.success(`已更新「${m.name}」的标签`),
                    )
                  }
                >
                  采用
                </Button>
              </div>
            )}
            {proposal && pendingCount === 0 && !match?.suggestedName && <p className="text-xs text-muted-foreground">标签和药品库一致。</p>}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onDone}>
          关闭
        </Button>
      </div>
    </div>
  );
}

export function CatalogMatchDialog({ open, onOpenChange, medications }: { open: boolean; onOpenChange: (open: boolean) => void; medications: MedicationRecord[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>匹配药品库</DialogTitle>
          <DialogDescription>用名称、规格和厂家把现有的药和国家医保局的药品库对一遍。点采用才会修改。类型是自动判断的，请核对。</DialogDescription>
        </DialogHeader>
        {open && <MatchList medications={medications} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
