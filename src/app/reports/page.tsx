import type { Metadata } from "next";
import { Suspense } from "react";
import { CardsSkeleton } from "@/components/meds/page-title";
import { ReportsBoard } from "@/components/meds/reports-board";
import { loadMeds } from "@/lib/meds/load";

export const metadata: Metadata = { title: "导出清单" };

export default function ReportsPage() {
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <Reports />
    </Suspense>
  );
}

async function Reports() {
  return <ReportsBoard {...await loadMeds()} />;
}
