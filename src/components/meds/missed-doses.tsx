"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { deleteMissedDose, recordMissedDose } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { fmtDate, type ISODate } from "@/lib/meds/dates";
import { MISSED_DOSE_KEPT_LABEL, doseClaims, fmtQty, type MedicationStatus } from "@/lib/meds/format";
import { SLOTS, SLOT_NAME, packBalancesAt, regimenAt, type Moment, type Slot } from "@/lib/meds/simulate";
import { MISSED_DOSE_KEPT, type MedicationRecord, type MissedDoseKept, type MissedDoseRecord } from "@/lib/meds/types";
import { missedDoseSchema } from "@/lib/meds/validation";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { FormError, PackPicker, SubmitButton, useActionForm } from "./forms";
import { ConfirmDelete, SectionHeader } from "./history";
import { QuantityInput, parseQuantity } from "./quantity-input";
import { DialogStrengthTabs, type StrengthSwitch } from "./strength-tabs";

type Status = Pick<MedicationStatus, "sim">;

/** The slots of `date` with pills to take from home, and how many: none on a day in hospital. */
function scheduledOn(medication: MedicationRecord, status: Status, date: ISODate): { slot: Slot; dose: number }[] {
  if (status.sim.days.find((d) => d.date === date)?.paused) return [];
  const r = regimenAt(medication.regimens, date);
  return r ? SLOTS.filter((s) => r[s] > 0).map((slot) => ({ slot, dose: r[slot] })) : [];
}

/** Today: the latest dose already behind us; another day: its first. Skips doses already fully recorded. */
function defaultSlot(medication: MedicationRecord, status: Status, date: ISODate, now: Moment): Slot | null {
  const open = scheduledOn(medication, status, date).filter((o) => doseClaims(medication, date, o.slot).open > 0);
  const past = date === now.date ? open.filter((o) => SLOTS.indexOf(o.slot) < now.slotsDone) : [];
  return (past.at(-1) ?? open[0])?.slot ?? null;
}

/** 漏服: which dose of which day was not taken, how much of it, and where its pills went. */
export function MissedDoseForm({
  medication,
  status,
  now,
  onDone,
}: {
  medication: MedicationRecord;
  status: Status;
  now: Moment;
  onDone: () => void;
}) {
  const today = now.date;
  // What is still open of that dose: not missed yet, nor taken from the reserve in its place.
  const doseOf = (date: ISODate, slot: Slot | null) =>
    slot && scheduledOn(medication, status, date).some((o) => o.slot === slot) ? doseClaims(medication, date, slot).open : 0;
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<Slot | null>(() => defaultSlot(medication, status, today, now));
  const [qty, setQty] = useState(() => fmtQty(doseOf(today, slot)));
  const [kept, setKept] = useState<MissedDoseKept>("stock");
  const multi = medication.packs.length > 1;
  // The pack that slot's pills come out of: the first one with any left then.
  const sourcePack = (d: ISODate, s: Slot | null) => {
    if (!multi || !s) return medication.packs[0]?.id ?? null;
    const left = packBalancesAt(status.sim, { date: d, slotsDone: SLOTS.indexOf(s) as Moment["slotsDone"] });
    return medication.packs[Math.max(0, left.findIndex((n) => n > 0))]?.id ?? null;
  };
  const [packId, setPackId] = useState<number | null>(() => sourcePack(today, slot));
  const { pending, error, setError, submit } = useActionForm();
  const uid = useId();

  const pickSlot = (d: ISODate, s: Slot | null) => {
    setSlot(s);
    setQty(fmtQty(doseOf(d, s)));
    setPackId(sourcePack(d, s));
  };
  const slots = scheduledOn(medication, status, date);
  const dose = doseOf(date, slot);
  const paused = status.sim.days.find((d) => d.date === date)?.paused;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (date > today) return setError("漏服日期不能晚于今天");
        if (!slot) return setError("请选择哪一顿没吃");
        const parsed = missedDoseSchema.safeParse({ date, slot, quantity: parseQuantity(qty), kept, packId: kept === "reserve" ? packId : null });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "输入无效");
        if (parsed.data.quantity > dose) return setError(`这一顿还没记的只有 ${fmtQty(dose)} 颗`);
        if (kept === "reserve") {
          const taken = status.sim.days.find((d) => d.date === date)?.slots[SLOTS.indexOf(slot)].taken ?? 0;
          if (taken < parsed.data.quantity) return setError(`按记录这一顿当前余量只够扣 ${fmtQty(taken)} 颗，放不进储备`);
        }
        submit(
          () => recordMissedDose(medication.id, parsed.data),
          () => {
            toast.success(`已记录 ${fmtDate(date)} ${SLOT_NAME[slot]}漏服 ${fmtQty(parsed.data.quantity)} 颗（${MISSED_DOSE_KEPT_LABEL[kept].label}）`);
            onDone();
          },
        );
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-date`}>哪天</Label>
        <DatePicker
          id={`${uid}-date`}
          label="漏服日期"
          value={date}
          onChange={(d) => {
            setDate(d);
            pickSlot(d, defaultSlot(medication, status, d, now));
          }}
          today={today}
          max={today}
        />
      </div>

      <div className="grid gap-2">
        <span id={`${uid}-slot`} className="text-sm leading-none font-medium">
          哪一顿没吃
        </span>
        {slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{paused ? "这天在住院，不吃家里的药。" : "按规律这天不用吃这种药。"}</p>
        ) : (
          <div role="radiogroup" aria-labelledby={`${uid}-slot`} className="flex flex-wrap gap-1.5">
            {slots.map((o) => {
              const claims = doseClaims(medication, date, o.slot);
              const done = claims.open <= 0;
              return (
                <Button
                  key={o.slot}
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={slot === o.slot}
                  disabled={done}
                  variant={slot === o.slot ? "default" : "outline"}
                  onClick={() => pickSlot(date, o.slot)}
                >
                  {SLOT_NAME[o.slot]} {fmtQty(o.dose)} 颗{done ? (claims.fromReserve ? "（吃的储备）" : "（已记）") : claims.scheduled > claims.open && `（还剩 ${fmtQty(claims.open)} 颗没记）`}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {slot && dose > 0 && (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-qty`}>没吃的颗数</Label>
            <div className="w-44">
              <QuantityInput id={`${uid}-qty`} label="没吃的颗数" value={qty} onChange={setQty} />
            </div>
            {dose > 0.5 && <p className="text-xs text-muted-foreground">这一顿没记的 {fmtQty(dose)} 颗都没吃就填 {fmtQty(dose)}；吃了一部分就填没吃的那些。</p>}
          </div>

          <div className="grid gap-2">
            <span id={`${uid}-kept`} className="text-sm leading-none font-medium">
              没吃的药放到
            </span>
            <div role="radiogroup" aria-labelledby={`${uid}-kept`} className="grid gap-1.5">
              {MISSED_DOSE_KEPT.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={kept === key}
                  onClick={() => setKept(key)}
                  className={cn(
                    "grid gap-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    kept === key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                  )}
                >
                  <span className="font-medium">{MISSED_DOSE_KEPT_LABEL[key].label}</span>
                  <span className="text-xs text-muted-foreground">{MISSED_DOSE_KEPT_LABEL[key].hint}</span>
                </button>
              ))}
            </div>
          </div>

          {kept === "reserve" && multi && (
            <PackPicker packs={medication.packs} value={packId} onChange={(p) => setPackId(p.id)} label="放进哪个厂家的储备" />
          )}
        </>
      )}

      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          取消
        </Button>
        {slots.length > 0 && <SubmitButton pending={pending}>记录漏服</SubmitButton>}
      </div>
    </form>
  );
}

export function MissedDoseDialog({
  medication,
  status,
  now,
  onOpenChange,
  ...switcher
}: StrengthSwitch & {
  medication: MedicationRecord | null;
  status: Status | null;
  now: Moment;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!medication} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>记录漏服</DialogTitle>
          <DialogDescription>{medication && [medication.name, medication.dosage].join(" · ")}</DialogDescription>
        </DialogHeader>
        <DialogStrengthTabs medication={medication} {...switcher} />
        {medication && status && <MissedDoseForm key={medication.id} medication={medication} status={status} now={now} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** What undoing a missed dose does. */
function undoEffect(m: MissedDoseRecord): string {
  const pills = fmtQty(m.quantity);
  switch (m.kept) {
    case "stock":
      return `那一顿按已经吃了算，当前余量少 ${pills} 颗。`;
    case "reserve":
      return `那一顿按已经吃了算，放进储备的 ${pills} 颗从储备里扣掉。`;
    case "none":
      return "那一顿按已经吃了算，余量不变。";
  }
}

/** Every dose not taken, newest first, each one undoable. */
export function MissedDoseHistory({ medication, status, now }: { medication: MedicationRecord; status: Status; now: Moment }) {
  const [adding, setAdding] = useState(false);
  const rows = [...medication.misses].sort((a, b) => (a.date === b.date ? SLOTS.indexOf(b.slot) - SLOTS.indexOf(a.slot) : a.date < b.date ? 1 : -1));
  const brand = (id: number | null) => medication.packs.find((p) => p.id === id)?.brand ?? "未写厂家";
  return (
    <section className="grid content-start gap-3">
      <SectionHeader
        title="漏服记录"
        hint={rows.length ? `共 ${rows.length} 次` : "没吃的那一顿，和药的去向"}
        adding={adding}
        onAdd={medication.regimens.length ? () => setAdding((v) => !v) : undefined}
      />
      {adding && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <MissedDoseForm medication={medication} status={status} now={now} onDone={() => setAdding(false)} />
        </div>
      )}
      {rows.length === 0 && !adding && <p className="py-6 text-center text-sm text-muted-foreground">还没有漏服记录</p>}
      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="tabular-nums">{fmtDate(m.date)}</span>
              <span>{SLOT_NAME[m.slot]}</span>
              <Badge variant="outline">{MISSED_DOSE_KEPT_LABEL[m.kept].label}</Badge>
              {m.kept === "reserve" && medication.packs.length > 1 && <span className="truncate text-xs text-muted-foreground">{brand(m.packId)}</span>}
              <span className="ml-auto font-medium tabular-nums">{fmtQty(m.quantity)} 颗</span>
              <ConfirmDelete
                title="撤销这条漏服？"
                description={`${fmtDate(m.date)} ${SLOT_NAME[m.slot]} ${fmtQty(m.quantity)} 颗。${undoEffect(m)}`}
                label="撤销"
                onConfirm={() => deleteMissedDose(m.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
