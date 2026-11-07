"use client";

import { ArchiveIcon, CalendarClockIcon, ExternalLinkIcon, PackageIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, type ISODate } from "@/lib/meds/dates";
import { daysFromToday, visitOrdinal } from "@/lib/meds/visits";
import { PageTitle } from "./page-title";
import { useMeds, type MedsData } from "./use-meds";

/** The PDF lists (src/app/api/reports/[kind]/route.ts). */
export const reportHref = (kind: "visit" | "stock" | "reserve", date?: ISODate) =>
  `/api/reports/${kind}${date ? `?date=${date}` : ""}`;

function PdfButton({ href, label = "打开 PDF", primary = true }: { href: string | null; label?: string; primary?: boolean }) {
  if (!href)
    return (
      <Button size="sm" variant="outline" disabled>
        {label}
      </Button>
    );
  return (
    <Button asChild size="sm" variant={primary ? "default" : "outline"} className="tabular-nums">
      <a href={href} target="_blank" rel="noopener">
        <ExternalLinkIcon />
        {label}
      </a>
    </Button>
  );
}

function ReportCard({
  icon: Icon,
  title,
  description,
  meta,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription className="text-pretty">{description}</CardDescription>
      </CardHeader>
      {meta && <CardContent className="text-sm text-muted-foreground tabular-nums">{meta}</CardContent>}
      <CardFooter className="mt-auto flex flex-wrap gap-2">{children}</CardFooter>
    </Card>
  );
}

/** 导出清单: the three PDF lists, each generated on the server for this moment. */
export function ReportsBoard(data: MedsData) {
  const { clock, upcoming, taking, notTaking } = useMeds(data);
  const none = data.medications.length === 0;
  const withReserve = data.medications.filter((m) => m.reserve > 0).length;
  return (
    <>
      <PageTitle title="导出清单" description="A4 PDF，按此刻的记录生成，在新标签页打开，可直接打印、保存或拿给医生看。" />
      {none && <p className="text-sm text-muted-foreground">还没有药品，清单是空的。先在“药品”里添加或一键录入。</p>}
      <div className="grid items-stretch gap-4 md:grid-cols-3">
        <ReportCard
          icon={CalendarClockIcon}
          title="复诊开药清单"
          description="复诊前一晚（周三晚）吃完后还剩多少，到下一次复诊（通常 4 周）还缺几盒（几颗）、缺的原因、要开的整盒数，以及购买和盘点记录。不含储备，未在吃的药不列。"
          meta={upcoming.length ? `${taking.length} 种在吃的药参与计算` : undefined}
        >
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有安排复诊。
              <Link href="/visits" className="font-medium text-foreground underline underline-offset-4">
                去“就诊 · 住院”添加
              </Link>
            </p>
          ) : (
            upcoming.slice(0, 4).map((d, i) => (
              <PdfButton
                key={d}
                href={none ? null : reportHref("visit", d)}
                primary={i === 0}
                label={`${visitOrdinal(i)} ${fmtDate(d)}（${daysFromToday(d, clock.date)}）`}
              />
            ))
          )}
        </ReportCard>
        <ReportCard
          icon={PackageIcon}
          title="药品现有清单"
          description="每种药现在有多少、当前服用规律、能吃到哪天，以及购买和盘点记录；在吃和未在吃分开列。不含储备。"
          meta={`${taking.length} 种在吃 · ${notTaking.length} 种未在吃`}
        >
          <PdfButton href={none ? null : reportHref("stock")} />
        </ReportCard>
        <ReportCard
          icon={ArchiveIcon}
          title="药品储备清单"
          description="另外放着的储备药各有多少，按当前规律够吃几天；没有储备的药逐行列在后面。"
          meta={`${withReserve} 种有储备 · ${data.medications.length - withReserve} 种没有`}
        >
          <PdfButton href={none ? null : reportHref("reserve")} />
        </ReportCard>
      </div>
    </>
  );
}
