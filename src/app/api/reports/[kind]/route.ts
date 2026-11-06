import { connection } from "next/server";
import { fmtDate, isValidISODate, wallClock } from "@/lib/meds/dates";
import { renderReservePdf, renderStockPdf, renderVisitPdf } from "@/lib/meds/pdf";
import { reserveReport, stockReport, visitReport, type ReportInput } from "@/lib/meds/reports";
import { listMedications, listStays, listVisits } from "@/lib/meds/repo";
import { momentAt } from "@/lib/meds/simulate";

/**
 * The printable lists as PDF, computed for now (Beijing time):
 *   /api/reports/visit[?date=YYYY-MM-DD]  复诊开药清单 (the next visit by default)
 *   /api/reports/stock                    药品现有清单
 *   /api/reports/reserve                  药品储备清单
 * Behind the same Access check as the rest of the app (proxy.ts).
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  await connection();
  const { kind } = await params;
  if (kind !== "visit" && kind !== "stock" && kind !== "reserve") return text(404, "没有这种清单");

  const date = new URL(request.url).searchParams.get("date");
  if (kind === "visit" && date !== null && !isValidISODate(date)) return text(400, "日期格式不对");

  const clock = wallClock();
  const now = momentAt(clock.date, clock.minutes);
  const [medications, visits, stays] = await Promise.all([listMedications(), listVisits(), listStays()]);
  const input: ReportInput = { medications, visits, stays, now };
  const hhmm = `${String(Math.floor(clock.minutes / 60)).padStart(2, "0")}:${String(clock.minutes % 60).padStart(2, "0")}`;
  const ctx = { input, generated: `${fmtDate(clock.date)} ${hhmm}（北京时间）` };
  const stamp = clock.date.replaceAll("-", ".");

  if (kind === "visit") {
    const report = visitReport(input, date ?? undefined);
    if (!report) return text(404, date ? "这一天没有待进行的复诊" : "还没有安排复诊");
    return pdf(await renderVisitPdf(report, ctx), `复诊开药清单-${report.date.replaceAll("-", ".")}.pdf`);
  }
  if (kind === "stock") return pdf(await renderStockPdf(stockReport(input), ctx), `药品现有清单-${stamp}.pdf`);
  return pdf(await renderReservePdf(reserveReport(input), ctx), `药品储备清单-${stamp}.pdf`);
}

function pdf(body: Buffer, filename: string) {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/pdf",
      // Opens in the browser's viewer; saving keeps the Chinese name.
      "content-disposition": `inline; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

const text = (status: number, message: string) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
