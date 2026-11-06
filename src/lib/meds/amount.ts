/**
 * A supply amount typed either as pills or as boxes × pills per box. Only the resulting
 * pill count is stored; the box form is an input convenience.
 */
export interface AmountState {
  mode: "pills" | "boxes";
  pills: string;
  boxes: string;
  perBox: string;
}

export const amountState = (pills = ""): AmountState => ({ mode: "pills", pills, boxes: "", perBox: "" });

export type ResolvedAmount = { value: number | null } | { error: string };

/** `value: null` means the field was left empty. */
export function resolveAmount(a: AmountState): ResolvedAmount {
  if (a.mode === "pills") {
    const raw = a.pills.trim();
    if (!raw) return { value: null };
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n } : { error: "请输入数量" };
  }
  const boxesRaw = a.boxes.trim();
  const perBoxRaw = a.perBox.trim();
  if (!boxesRaw && !perBoxRaw) return { value: null };
  const boxes = Number(boxesRaw);
  const perBox = Number(perBoxRaw);
  if (!boxesRaw || !Number.isInteger(boxes) || boxes <= 0) return { error: "盒数必须是正整数" };
  if (!perBoxRaw || !Number.isFinite(perBox) || perBox <= 0) return { error: "请填写每盒颗数" };
  if (!Number.isInteger(perBox * 2)) return { error: "每盒颗数只能是整数或 0.5 的倍数" };
  return { value: boxes * perBox };
}
