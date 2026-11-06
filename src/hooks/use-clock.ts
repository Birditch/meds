"use client";

import { useSyncExternalStore } from "react";
import { wallClock, type ISODate } from "@/lib/meds/dates";
import { momentAt, type Moment } from "@/lib/meds/simulate";

export interface Clock {
  date: ISODate;
  minutes: number;
}

const encode = (c: Clock) => `${c.date}|${c.minutes}`;
const decode = (key: string): Clock => {
  const [date, minutes] = key.split("|");
  return { date, minutes: Number(minutes) };
};

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 30_000);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * Today's date and minute in Beijing time (APP_TIME_ZONE), ticking. The server render uses
 * `serverClock`; after hydration the browser recomputes it from its own clock, in the same zone.
 */
export function useClock(serverClock: Clock): Clock & { moment: Moment } {
  const key = useSyncExternalStore(
    subscribe,
    () => encode(wallClock()),
    () => encode(serverClock),
  );
  const clock = decode(key);
  return { ...clock, moment: momentAt(clock.date, clock.minutes) };
}
