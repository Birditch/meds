"use client";

import { fmtDate } from "@/lib/meds/dates";
import { CLINIC_DAY } from "@/lib/meds/visits";
import { PageTitle } from "./page-title";
import { HospitalStays } from "./stays";
import { useMeds, type MedsData } from "./use-meds";
import { VisitPlan } from "./visit-plan";

/** 就诊 · 住院: the visit plan (what to get at each visit) and the hospital stays it skips. */
export function VisitsBoard(data: MedsData) {
  const { clock, now, statuses, taking, notTaking } = useMeds(data);
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
          today={now.date}
          className="lg:col-span-2"
        />
        <HospitalStays stays={data.stays} today={now.date} />
      </div>
    </>
  );
}
