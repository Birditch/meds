import type { Metadata } from "next";
import { Suspense } from "react";
import { CardsSkeleton } from "@/components/meds/page-title";
import { VisitsBoard } from "@/components/meds/visits-board";
import { loadMeds } from "@/lib/meds/load";

export const metadata: Metadata = { title: "就诊 · 住院" };

export default function VisitsPage() {
  return (
    <Suspense fallback={<CardsSkeleton count={2} className="lg:grid-cols-3" />}>
      <Visits />
    </Suspense>
  );
}

async function Visits() {
  return <VisitsBoard {...await loadMeds()} />;
}
