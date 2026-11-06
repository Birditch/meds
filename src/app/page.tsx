import { PillIcon } from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";
import { Board } from "@/components/meds/board";
import { wallClock } from "@/lib/meds/dates";
import { listMedications, listStays, listVisits } from "@/lib/meds/repo";

export default function Page() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <PillIcon className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">药品余量</h1>
          <p className="text-sm text-muted-foreground">按天、按早中晚推算每种药能吃到哪一顿</p>
        </div>
      </header>
      <Suspense fallback={<BoardSkeleton />}>
        <MedicationBoard />
      </Suspense>
    </main>
  );
}

async function MedicationBoard() {
  await connection();
  const [medications, visits, stays] = await Promise.all([listMedications(), listVisits(), listStays()]);
  const serverClock = wallClock();
  return <Board medications={medications} visits={visits} stays={stays} serverClock={serverClock} />;
}

function BoardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
