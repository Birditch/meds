import { Suspense } from "react";
import { Board } from "@/components/meds/board";
import { CardsSkeleton } from "@/components/meds/page-title";
import { loadMeds } from "@/lib/meds/load";

export default function Page() {
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <MedicationBoard />
    </Suspense>
  );
}

async function MedicationBoard() {
  return <Board {...await loadMeds()} />;
}
