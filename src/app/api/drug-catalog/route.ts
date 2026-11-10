import { connection } from "next/server";
import { z } from "zod";
import { loadCatalog } from "@/lib/meds/drug-catalog/load";
import { matchDrug } from "@/lib/meds/drug-catalog/match";
import { catalogDetail, searchCatalog } from "@/lib/meds/drug-catalog/search";

const MAX_TEXT = 100;
const MAX_BRANDS = 20;
const MAX_MATCHED_MAKERS = 5;

/**
 * Look a drug up in the bundled national catalog.
 * `?q=` lists the matching drugs; `?id=` (with the same `q`) lists one drug's manufacturers and packs;
 * `?name=&dosage=&brand=` matches a medication as it is filled in.
 */
export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const clip = (s: string | null) => (s ?? "").slice(0, MAX_TEXT);
  const data = loadCatalog();
  if (params.has("name")) {
    return Response.json(matchDrug(data, { name: clip(params.get("name")), dosage: clip(params.get("dosage")), brands: params.getAll("brand").slice(0, MAX_BRANDS).map(clip) }));
  }
  const query = clip(params.get("q"));
  const rawId = params.get("id");
  if (rawId !== null) {
    const id = Number(rawId);
    const detail = Number.isInteger(id) && id >= 0 ? catalogDetail(data, id, query) : null;
    return detail ? Response.json(detail) : Response.json({ error: "no such drug" }, { status: 404 });
  }
  return Response.json({ ...searchCatalog(data, query), source: data.source });
}

const matchAllSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string().max(MAX_TEXT),
        dosage: z.string().max(MAX_TEXT),
        brands: z.array(z.string().max(MAX_TEXT)).max(MAX_BRANDS),
      }),
    )
    .max(500),
});

/** Matches many medications at once. Reads nothing but the catalog and stores nothing. */
export async function POST(request: Request) {
  await connection();
  const parsed = matchAllSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const data = loadCatalog();
  const results = parsed.data.items.map(({ id, ...input }) => {
    const match = matchDrug(data, input);
    return { id, match: { ...match, strengths: [], makers: match.makers.filter((m) => m.matched).slice(0, MAX_MATCHED_MAKERS) } };
  });
  return Response.json({ results, source: data.source });
}
