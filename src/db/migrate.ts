import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function migrateDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const folder = process.env.MEDS_MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle");
    await migrate(drizzle(client), { migrationsFolder: folder });
    console.log(`[meds] migrations applied from ${folder}`);
  } finally {
    await client.end();
  }
}
