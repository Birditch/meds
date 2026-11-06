export async function register() {
  // Apply pending SQL migrations (./drizzle) before the server takes requests.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.MEDS_MIGRATE_ON_START !== "0") {
    const { migrateDatabase } = await import("./db/migrate");
    await migrateDatabase();
  }
}
