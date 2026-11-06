"use client";

import { ArchiveIcon, CalendarClockIcon, FileDownIcon, PackageIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDate, type ISODate } from "@/lib/meds/dates";
import { cn } from "@/lib/utils";

/** The PDF lists (src/app/api/reports/[kind]/route.ts). */
export const reportHref = (kind: "visit" | "stock" | "reserve", date?: ISODate) =>
  `/api/reports/${kind}${date ? `?date=${date}` : ""}`;

function ReportLink({
  href,
  icon: Icon,
  title,
  note,
}: {
  href: string | null;
  icon: LucideIcon;
  title: string;
  note: string;
}) {
  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="grid gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </span>
    </>
  );
  const cls = "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left";
  if (!href) return <div className={cn(cls, "opacity-60")} aria-disabled="true">{body}</div>;
  return (
    <a href={href} target="_blank" rel="noopener" className={cn(cls, "transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none")}>
      {body}
    </a>
  );
}

/** The toolbar's "导出 PDF": the next visit's list, the stock, the reserve. */
export function ExportMenu({ nextVisit }: { nextVisit: ISODate | null }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label="导出 PDF">
          <FileDownIcon />
          <span className="hidden sm:inline">导出 PDF</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0.5 p-1.5">
        <ReportLink
          href={nextVisit ? reportHref("visit", nextVisit) : null}
          icon={CalendarClockIcon}
          title="复诊开药清单"
          note={
            nextVisit
              ? `下次复诊 ${fmtDate(nextVisit)}：截止前一晚还剩多少，接下来（通常 4 周）缺几盒（几颗）、缺的原因和购买记录`
              : "先在“就诊计划”里添加下次复诊"
          }
        />
        <ReportLink href={reportHref("stock")} icon={PackageIcon} title="药品现有清单" note="每种药现有多少、能吃到哪天、购买与盘点记录（不含储备）" />
        <ReportLink href={reportHref("reserve")} icon={ArchiveIcon} title="药品储备清单" note="另放的储备药有多少，按当前规律可用几天" />
      </PopoverContent>
    </Popover>
  );
}
