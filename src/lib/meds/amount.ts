/**
 * A supply amount typed either as pills or as packs (boxes / bottles) × pills per pack, plus
 * loose pills (what is left of an opened pack). Only the resulting pill count is stored; the box form is an
 * input convenience.
 */
export interface AmountState {
  mode: "pills" | "boxes";
  pills: string;
  boxes: string;
  perBox: string;
  loose: string;
}

export const amountState = (pills = "", perBox: number | null = null): AmountState => ({
  mode: perBox && !pills ? "boxes" : "pills",
  pills,
  boxes: "",
  perBox: perBox ? String(perBox) : "",
  loose: "",
});

/** An existing count shown as whole packs plus loose pills, when the pack size is known. */
export function amountInPacks(pills: number, perBox: number | null): AmountState {
  if (!perBox || pills <= 0) return amountState(pills > 0 ? String(pills) : "", perBox);
  const packs = Math.floor((pills + 1e-9) / perBox);
  const loose = Math.round((pills - packs * perBox) * 2) / 2;
  return { mode: "boxes", pills: "", boxes: packs ? String(packs) : "", perBox: String(perBox), loose: loose ? String(loose) : "" };
}

export type ResolvedAmount = { value: number | null } | { error: string };

const halfStep = (n: number) => Number.isFinite(n) && n >= 0 && Number.isInteger(n * 2);

/** `value: null` means the field was left empty. */
export function resolveAmount(a: AmountState, unit: string = "盒"): ResolvedAmount {
  if (a.mode === "pills") {
    const raw = a.pills.trim();
    if (!raw) return { value: null };
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n } : { error: "请输入数量" };
  }
  const boxesRaw = a.boxes.trim();
  const perBoxRaw = a.perBox.trim();
  const looseRaw = a.loose.trim();
  if (!boxesRaw && !looseRaw) return perBoxRaw ? { error: `请填写${unit}数` } : { value: null };
  const boxes = boxesRaw ? Number(boxesRaw) : 0;
  const loose = looseRaw ? Number(looseRaw) : 0;
  if (!Number.isInteger(boxes) || boxes < 0) return { error: `${unit}数必须是整数` };
  if (!halfStep(loose)) return { error: "散装颗数只能是整数或 0.5 的倍数" };
  if (boxes === 0) return { value: loose };
  const perBox = Number(perBoxRaw);
  if (!perBoxRaw || !Number.isFinite(perBox) || perBox <= 0) return { error: `请填写每${unit}颗数` };
  if (!halfStep(perBox)) return { error: `每${unit}颗数只能是整数或 0.5 的倍数` };
  return { value: boxes * perBox + loose };
}
