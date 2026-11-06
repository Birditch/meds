import "server-only";

import { connection } from "next/server";
import { wallClock } from "./dates";
import { listMedications, listStays, listVisits } from "./repo";

/** Everything a page shows, read per request (the data changes with every record). */
export async function loadMeds() {
  await connection();
  const [medications, visits, stays] = await Promise.all([listMedications(), listVisits(), listStays()]);
  return { medications, visits, stays, serverClock: wallClock() };
}
