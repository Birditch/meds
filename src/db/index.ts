import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

declare global {
  var __medsDb: Db | undefined;
}

/** Lazily connects, so importing this module never needs DATABASE_URL (e.g. during `next build`). */
export function getDb(): Db {
  if (!globalThis.__medsDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const client = postgres(url, { max: 5, idle_timeout: 30, connect_timeout: 10 });
    // Kept on globalThis so dev hot reloads reuse one pool.
    globalThis.__medsDb = drizzle(client, { schema, casing: "snake_case" });
  }
  return globalThis.__medsDb;
}
