"use client";

import { useMemo } from "react";
import { useClock, type Clock } from "@/hooks/use-clock";
import { intakeAt, isTaking, statusOf } from "@/lib/meds/format";
import type { MedicationRecord, StayRecord, VisitRecord } from "@/lib/meds/types";
import { scheduleVisits } from "@/lib/meds/visits";

export interface MedsData {
  medications: MedicationRecord[];
  visits: VisitRecord[];
  stays: StayRecord[];
  serverClock: Clock;
}

/** What every page works from: the ticking clock, the visit schedule and each medication's status. */
export function useMeds({ medications, visits, stays, serverClock }: MedsData) {
  const clock = useClock(serverClock);
  const { date, slotsDone } = clock.moment;
  const now = useMemo(() => ({ date, slotsDone }), [date, slotsDone]);
  const schedule = useMemo(() => scheduleVisits(visits, date), [visits, date]);
  const pauses = useMemo(() => stays.map((s) => ({ start: s.startDate, end: s.endDate })), [stays]);
  const upcoming = useMemo(() => schedule.map((s) => s.date), [schedule]);
  const statuses = useMemo(
    () =>
      new Map(
        medications.map((m) => [m.id, statusOf(m, now, schedule, pauses)]),
      ),
    [medications, now, schedule, pauses],
  );
  const intakes = useMemo(() => new Map(medications.map((m) => [m.id, intakeAt(m.regimens, date)])), [medications, date]);
  const taking = useMemo(() => medications.filter((m) => isTaking(intakes.get(m.id)!)), [medications, intakes]);
  const notTaking = useMemo(() => medications.filter((m) => !isTaking(intakes.get(m.id)!)), [medications, intakes]);
  return { clock, now, schedule, pauses, upcoming, statuses, intakes, taking, notTaking };
}
