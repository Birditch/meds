"use client";

import type { Tone } from "@/lib/meds/format";
import type { MedicationRecord } from "@/lib/meds/types";
import { cn } from "@/lib/utils";

const DOT: Partial<Record<Tone, string>> = { warn: "bg-amber-500", danger: "bg-red-500" };

/**
 * The strengths of one drug (帕利哌酮缓释片 3mg / 6mg), a tab each. Each is its own medication
 * with its own stock; `tone` puts a dot on a strength that needs attention, so it shows from
 * another tab too.
 */
export function StrengthTabs({
  strengths,
  value,
  onChange,
  tone,
  className,
}: {
  strengths: readonly MedicationRecord[];
  value: number;
  onChange: (id: number) => void;
  tone?: (m: MedicationRecord) => Tone | null;
  className?: string;
}) {
  if (strengths.length < 2) return null;
  return (
    <div role="tablist" aria-label="规格" className={cn("inline-flex w-fit flex-wrap rounded-md border p-0.5 text-sm", className)}>
      {strengths.map((m) => {
        const dot = tone ? DOT[tone(m) ?? "muted"] : undefined;
        const on = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={on}
            title={`${m.name} ${m.dosage}`}
            onClick={() => onChange(m.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-0.5 tabular-nums transition-colors",
              on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.dosage}
            {dot && <span aria-label="需要注意" className={cn("size-1.5 rounded-full", dot)} />}
          </button>
        );
      })}
    </div>
  );
}

/** What a dialog takes to switch to another strength of its medication's drug. */
export interface StrengthSwitch {
  strengths?: readonly MedicationRecord[];
  onPick?: (id: number) => void;
  tone?: (m: MedicationRecord) => Tone | null;
}

/** The strength tabs at the top of a dialog (nothing for a drug with one strength). */
export function DialogStrengthTabs({ medication, strengths = [], onPick, tone }: StrengthSwitch & { medication: MedicationRecord | null }) {
  if (!medication || !onPick || strengths.length < 2) return null;
  return <StrengthTabs strengths={strengths} value={medication.id} onChange={onPick} tone={tone} />;
}
