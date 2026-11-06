"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Numeric field in 0.5 steps. The raw text is kept as typed (so "0." or "" are allowed
 * mid-edit); the parent parses it with `parseQuantity` on submit.
 */
export function QuantityInput({
  id,
  value,
  onChange,
  min = 0,
  step = 0.5,
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  step?: number;
  label?: string;
}) {
  const n = Number(value);
  const bump = (delta: number) => {
    const base = Number.isFinite(n) ? n : 0;
    const next = Math.max(min, Math.round((base + delta) * 2) / 2);
    onChange(String(next));
  };
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon" aria-label={`${label ?? ""}减少`} onClick={() => bump(-step)}>
        <MinusIcon />
      </Button>
      <Input
        id={id}
        inputMode="decimal"
        className="text-center tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
      />
      <Button type="button" variant="outline" size="icon" aria-label={`${label ?? ""}增加`} onClick={() => bump(step)}>
        <PlusIcon />
      </Button>
    </div>
  );
}

/** "" → 0 for doses; anything else must be a finite number. */
export const parseQuantity = (raw: string, emptyAs: number | null = null): number | null => {
  if (raw.trim() === "") return emptyAs;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
