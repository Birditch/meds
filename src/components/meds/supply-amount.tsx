"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtQty } from "@/lib/meds/format";
import { resolveAmount, type AmountState } from "@/lib/meds/amount";
import { cn } from "@/lib/utils";
import { QuantityInput } from "./quantity-input";

export { amountInPacks, amountState, resolveAmount, type AmountState } from "@/lib/meds/amount";

const digits = (v: string) => v.replace(/[^\d.]/g, "");

export function SupplyAmountInput({
  id,
  label,
  value,
  onChange,
  unit = "盒",
}: {
  id: string;
  label: string;
  value: AmountState;
  onChange: (value: AmountState) => void;
  /** The medication's pack: 盒 or 瓶. */
  unit?: string;
}) {
  const resolved = resolveAmount(value, unit);
  const total = "value" in resolved ? resolved.value : null;

  const switchTo = (mode: AmountState["mode"]) => {
    if (mode === value.mode) return;
    // Going back to pills carries the computed total over.
    if (mode === "pills" && total !== null) onChange({ ...value, mode, pills: String(total) });
    else onChange({ ...value, mode });
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={value.mode === "pills" ? id : `${id}-boxes`}>{label}</Label>
        <div role="radiogroup" aria-label={`${label}录入方式`} className="inline-flex rounded-md border p-0.5 text-xs">
          {(
            [
              ["pills", "按颗"],
              ["boxes", `按${unit}`],
            ] as const
          ).map(([mode, text]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={value.mode === mode}
              onClick={() => switchTo(mode)}
              className={cn(
                "rounded-[5px] px-2 py-0.5 transition-colors",
                value.mode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {value.mode === "pills" ? (
        <QuantityInput id={id} label={label} value={value.pills} onChange={(pills) => onChange({ ...value, pills })} step={1} />
      ) : (
        <div className="flex items-center gap-1.5 text-sm">
          <Input
            id={`${id}-boxes`}
            aria-label={`${unit}数`}
            inputMode="numeric"
            placeholder={`${unit}数`}
            className="text-center tabular-nums"
            value={value.boxes}
            onChange={(e) => onChange({ ...value, boxes: e.target.value.replace(/\D/g, "") })}
          />
          <span className="shrink-0 text-muted-foreground">{unit} ×</span>
          <Input
            id={`${id}-per-box`}
            aria-label={`每${unit}颗数`}
            inputMode="decimal"
            placeholder={`每${unit}`}
            className="text-center tabular-nums"
            value={value.perBox}
            onChange={(e) => onChange({ ...value, perBox: digits(e.target.value) })}
          />
          <span className="shrink-0 text-muted-foreground">颗/{unit}</span>
        </div>
      )}
      {value.mode === "boxes" && (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="shrink-0 text-muted-foreground">另有散装</span>
          <Input
            id={`${id}-loose`}
            aria-label={`散装颗数（已拆开的那${unit}剩下的）`}
            inputMode="decimal"
            placeholder="0"
            className="w-20 text-center tabular-nums"
            value={value.loose}
            onChange={(e) => onChange({ ...value, loose: digits(e.target.value) })}
          />
          <span className="text-muted-foreground">颗</span>
          <span className="text-xs text-muted-foreground">（已拆开、用过一部分的那{unit}剩下的）</span>
        </div>
      )}
      {value.mode === "boxes" && (
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {total !== null ? `共 ${fmtQty(total)} 颗` : `填写${unit}数和每${unit}颗数`}
        </p>
      )}
    </div>
  );
}
