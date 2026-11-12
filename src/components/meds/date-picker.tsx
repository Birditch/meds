"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { zhCN } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDate, type ISODate } from "@/lib/meds/dates";

const toLocalDate = (iso: ISODate) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toISO = (d: Date): ISODate =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DatePicker({
  id,
  label,
  value,
  onChange,
  today,
  max,
}: {
  id?: string;
  /** Accessible name; the visible text is the date itself. */
  label: string;
  value: ISODate;
  onChange: (value: ISODate) => void;
  today: ISODate;
  /** The last day that can be picked, when later ones make no sense. */
  max?: ISODate;
}) {
  const [open, setOpen] = useState(false);
  const selected = toLocalDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} aria-label={`${label}：${fmtDate(value)}`} type="button" variant="outline" className="w-full justify-start font-normal tabular-nums">
          <CalendarIcon className="text-muted-foreground" />
          {fmtDate(value)}
          {value === today && <span className="text-muted-foreground">（今天）</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={zhCN}
          selected={selected}
          defaultMonth={selected}
          today={toLocalDate(today)}
          disabled={max ? { after: toLocalDate(max) } : undefined}
          captionLayout="dropdown"
          startMonth={new Date(2000, 0)}
          endMonth={new Date(2100, 11)}
          onSelect={(d) => {
            if (d) onChange(toISO(d));
            setOpen(false);
          }}
        />
        <div className="border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              onChange(today);
              setOpen(false);
            }}
          >
            回到今天
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
