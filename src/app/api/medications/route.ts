import { connection } from "next/server";
import { isValidISODate, wallClock } from "@/lib/meds/dates";
import { finalDose, momentAt } from "@/lib/meds/simulate";
import { medicationStatus } from "@/lib/meds/format";
import { listMedications } from "@/lib/meds/repo";

/**
 * JSON export of all data plus the server-side projection — computed by the same pure
 * simulation the browser runs. Defaults to now in Beijing time;
 * `?today=YYYY-MM-DD&minutes=N` (minute of the day) evaluates another moment.
 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const clock = wallClock();
  const today = url.searchParams.get("today") ?? clock.date;
  const minutes = Number(url.searchParams.get("minutes") ?? clock.minutes);
  if (!isValidISODate(today) || !Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) {
    return Response.json({ error: "bad today/minutes" }, { status: 400 });
  }
  const now = momentAt(today, minutes);

  const medications = (await listMedications()).map((m) => {
    const s = medicationStatus(m.supplies, m.regimens, now);
    return {
      ...m,
      projection: {
        currentRegimen: s.current,
        balanceNow: s.balanceNow,
        outcome: s.sim.outcome,
        finalDose: finalDose(s.sim.outcome),
        conclusion: s.conclusion,
        shortfall: s.shortfall,
      },
    };
  });
  return Response.json({ now, medications }, { headers: { "cache-control": "no-store" } });
}
