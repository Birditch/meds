"use client";

import { useMemo } from "react";
import { fmtDate } from "@/lib/meds/dates";
import { visitReport, type VisitReport } from "@/lib/meds/reports";
import { CLINIC_DAY } from "@/lib/meds/visits";
import { PageTitle } from "./page-title";
import { HospitalStays } from "./stays";
import { useMeds, type MedsData } from "./use-meds";
import { VisitPlan } from "./visit-plan";

/** 就诊 · 住院: the visit plan (what to get at each visit) and the hospital stays it skips. */
export function VisitsBoard(data: MedsData) {
  const { clock, now, schedule, statuses, taking, notTaking } = useMeds(data);
  // How the hospital stays shape each upcoming visit, as the printed list explains it.
  const stayReports = useMemo(() => {
    if (!data.stays.length) return new Map<string, VisitReport>();
    const input = { medications: data.medications, visits: data.visits, stays: data.stays, now };
    return new Map(schedule.flatMap((v) => {
      const r = visitReport(input, v.date);
      return r ? [[v.date, r] as const] : [];
    }));
  }, [data.medications, data.visits, data.stays, now, schedule]);
  return (
    <>
      <PageTitle
        title="就诊 · 住院"
        description={
          <span className="tabular-nums">
            今天 {fmtDate(clock.date)}（北京时间）· 每次{CLINIC_DAY}复诊要开多少药；住院的日子不消耗家里的药
          </span>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <VisitPlan
          visits={data.visits}
          medications={taking}
          notTaking={notTaking.length}
          statuses={statuses}
          stayReports={stayReports}
          today={now.date}
          className="lg:col-span-2"
        />
        <HospitalStays stays={data.stays} today={now.date} />
      </div>
    </>
  );
}
