# meds · 药品余量与服用周期推算

A small, exact pill-count tracker: record every refill and every dosing schedule, and it
simulates stock day by day, slot by slot (早 / 中 / 晚) to tell you **the exact meal on which
each medication runs out** — e.g. `能吃到 2027-01-07 中`, or
`能吃到 2026-11-07 晚（仅余 1/2 颗，最后完整一顿为当日中）`.

- **Three fields per medication**: name, brand (optional), dosage/strength.
- **Supply logs**: `+N` pills on any date (whole or 0.5), counted before that day's morning dose;
  enter either a pill count or boxes × pills per box.
- **Regimen timeline**: morning / noon / evening doses, each with an `effectiveFrom` date.
  A regimen never applies before its date; setting one again for the same date overwrites it.
- **Stock chart**: vertical jumps on refills, slope changes on regimen changes, a "today" line,
  history vs. projection, and a tooltip with the per-slot breakdown of any day.
- **No accounts**: the site sits behind Cloudflare Access; everyone let through shares one data set.

Stack: Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS 4 · shadcn/ui ·
Recharts · Drizzle ORM · PostgreSQL.

## How the projection works

[`src/lib/meds/simulate.ts`](src/lib/meds/simulate.ts) is a pure function shared by the server
(`/api/medications`, the first render) and the browser (live recompute). Starting at the
earliest record with `balance = 0`, for each day `d`:

1. **Supply** — add every `+N` logged on `d`.
2. **Regimen** — the latest regimen with `effectiveFrom <= d` (none yet → doses are 0).
3. **Doses, 早 → 中 → 晚** — a slot with dose `0` is skipped; if `balance >= dose` it is taken in
   full; if `0 < balance < dose` the remainder is taken as a partial dose and `balance` becomes 0;
   if `balance == 0` the slot is missed. Stock never goes negative, and a later refill resumes it.
4. **Snapshot** — end-of-day balance, each slot's outcome, refill / regimen-change events.

Once every record (and today) is behind it, the simulation stops when the regimen in force is
all zeros (**stopped**, stock kept) or when stock hits 0 (**depleted**: last full dose plus the
partial one, if any), with a 10-year safety cap. Quantities are counted in half pills
internally, so there is no floating-point drift.

All dates and "now" are **Beijing time** (`Asia/Shanghai`, `APP_TIME_ZONE` in
`src/lib/meds/dates.ts`) for every visitor and the server alike; a slot counts as taken from
08:00 / 12:00 / 18:00.

## Development

Requires Node.js 24+, pnpm, and Docker.

```bash
pnpm install
docker compose -f compose.dev.yaml up -d --wait   # Postgres 18 on 127.0.0.1:55432 (volume meds-dev_pgdata)
cp .env.example .env.local                         # then set:
#   DATABASE_URL=postgres://meds:meds-dev-only@127.0.0.1:55432/meds
#   MEDS_ACCESS_DISABLED=1
pnpm dev                                           # migrations in ./drizzle are applied on boot
```

| Command | |
|---|---|
| `pnpm test` | unit tests of the simulation (Vitest) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm build` | production build (`output: "standalone"`) |
| `pnpm db:generate` | new SQL migration after editing `src/db/schema.ts` |

Stop the dev database with `docker compose -f compose.dev.yaml down` (data stays in the volume;
add `-v` only if you mean to wipe it).

## Configuration

| Variable | |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access team domain and application AUD; every request must carry a valid Access JWT |
| `MEDS_ACCESS_DISABLED=1` | skip the Access check (local only). In production, missing Access settings fail closed with 503 |
| `MEDS_MIGRATE_ON_START=0` | don't apply migrations at boot |

`GET /api/medications` returns all data with the server-side projection
(`?today=YYYY-MM-DD&minutes=N` to evaluate another moment). `GET /api/health` checks the database.

## Deployment

See [docs/deploy.md](docs/deploy.md): Docker Compose on the host, host PostgreSQL, nginx in front,
Cloudflare Access at the edge.

## License

[MIT](LICENSE)
