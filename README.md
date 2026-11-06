# meds · 药品余量与服用周期推算

A small, exact pill-count tracker: record every refill and every dosing schedule, and it
simulates stock day by day, slot by slot (早 / 中 / 晚) to tell you **the last day each
medication is fully covered** — e.g. `能吃到：2027.01.06 周三`, with
`额外多 2 颗：够 2027.01.07 周四 早、中` when the pills left cover only part of the next day.

- **Per medication**: name, brand (optional), dosage/strength, and how it is packed (盒 / 瓶 and
  pills per pack, optional). Every remaining amount is also shown in packs, e.g. `合 6 瓶 14 颗`.
- **Supply logs**: `+N` pills on any date (whole or 0.5), counted before that day's morning dose;
  enter a pill count or packs × pills per pack plus loose pills from an opened pack, or **按日期**:
  pick the evening it should last to (default: the day before the next visit, with a chip for
  the Wednesday before it) and it works out exactly how many pills that takes on the regimen,
  counting what is already there and skipping hospital days.
- **Stock counts (盘点)**: the pills actually at home at one moment (before 早, or after 早 /
  中 / 晚 of a day). From then on the stock is exactly the counted number, whatever the earlier
  records say; a same-day supply entered after the count is added on top of it, one entered
  before it is already in it. One count per medication per day (counting again replaces it).
- **One-click import (一键录入)**: paste a list, one medication per line, or fill the table, and
  record the stock of every medication at once (as counts), plus reserves, pills per pack,
  regimen changes and new medications, in one transaction. Lines are free text, e.g.
  `他克莫司胶囊，普乐可复，1mg，每盒50颗，余 3盒12颗，储备 2盒，早1 晚1` or
  `阿托伐他汀钙片（立普妥） 20mg 7片×2板 剩 20 片`; amounts are stock unless a reserve word
  (储备 / 备用) comes first, and a bare number is read only right after 余 / 剩 / 储备. Lines
  match existing medications by name, brand or pinyin (narrowed by dosage; another dosage is a
  new medication). "填入当前清单" writes the current list in that format to edit and paste back.
  A stock equal to the projection records nothing; a new medication's stock becomes a supply that
  day (plus the doses already taken by then). Medications without pills per pack are tagged
  **未写明每盒颗数** on the board, filterable, and in the import table.
- **Regimen timeline**: morning / noon / evening doses, each with an `effectiveFrom` date.
  A regimen never applies before its date; setting one again for the same date overwrites it.
- **Reserve (药物储备)**: extra pills kept at home, outside the stock and the projection. The app
  only says how many whole days they would last on today's regimen. "从储备取用" moves pills from
  the reserve into the stock as one supply log.
- **Visit plan (就诊计划)**: enter the next visits (下次, 下下次, …). For each one and each
  medication it works out how many pills — and how many whole boxes / bottles — to get so the
  stock lasts to the following visit without touching the reserve. Extra pills from rounding up
  to whole packs carry over to the next visit. Visits are on **Thursdays**: a visit counts the
  stock left after Wednesday evening's dose, and what it prescribes must last through the
  Wednesday evening before the next visit. They are usually every 4 weeks at the start of a
  month (days 1–10, when the hospital has imported drugs): the add form offers the Thursday
  about 4 weeks later and that pushed back to a month start, and a visit on another weekday is
  flagged. The last visit is assumed to be followed by one on the Thursday 4 weeks later (so it
  covers through the Wednesday evening before that); entering the next visit replaces the
  assumption with the real gap. If stock runs out before the first visit, it names the last
  Thursday that would still avoid the gap.
- **PDF lists (导出 PDF)**: A4, Chinese, generated on the server for the current moment.
  **复诊开药清单** (per visit, the next one from the toolbar): the stock left after the Wednesday
  evening before the visit, what the period to the following visit (usually 4 weeks) takes, and
  what is short as `N 盒（M 颗）`, with each medication's reason, the whole packs to get, every
  purchase (each supply log counts as one) and stock count. **药品现有清单**: current stock,
  regimen, run-out day, purchases and counts. **药品储备清单**: the reserve and how long it
  lasts. The visit and stock lists never include the reserve.
- **Hospital stays (住院)**: no medication is taken from home stock on those days (start and end
  included), so run-out dates and visit needs move back accordingly.
- **Stock chart**: vertical jumps on refills, slope changes on regimen changes, a "today" line,
  visit lines, shaded hospital stays, history vs. projection, and a per-slot tooltip.
- **Fuzzy search** over name, brand, dosage and their pinyin (full or initials: `ypb` → 药品B).
- **No accounts**: the site sits behind Cloudflare Access; everyone let through shares one data set.

Dates are written `yyyy.mm.dd 周X` throughout the UI (the JSON API uses ISO `YYYY-MM-DD`).

Stack: Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS 4 · shadcn/ui ·
Recharts · Drizzle ORM · PostgreSQL.

## How the projection works

[`src/lib/meds/simulate.ts`](src/lib/meds/simulate.ts) is a pure function shared by the server
(`/api/medications`, the first render) and the browser (live recompute). Starting at the
earliest record with `balance = 0`, for each day `d`:

1. **Supply** — add every `+N` logged on `d` (one entered after that day's count waits for it).
2. **Regimen** — the latest regimen with `effectiveFrom <= d` (none yet → doses are 0). On a
   hospital-stay day every dose is 0.
3. **Doses, 早 → 中 → 晚** — a slot with dose `0` is skipped; if `balance >= dose` it is taken in
   full; if `0 < balance < dose` the remainder is taken as a partial dose and `balance` becomes 0;
   if `balance == 0` the slot is missed. Stock never goes negative, and a later refill resumes it.
   A **count** replaces `balance` once its number of slots is behind (0 = before 早), then adds
   the same-day supplies entered after it.
4. **Snapshot** — end-of-day balance, each slot's outcome, refill / regimen-change / count events.

Once every record, today and the end of the visit plan are behind it, the simulation stops when
the regimen in force is all zeros (**stopped**, stock kept) or when stock hits 0 (**depleted**),
with a 10-year safety cap. Quantities are counted in half pills internally, so there is no
floating-point drift.

"能吃到" is the last day whose doses were all taken in full: if day *x* only gets 早, the answer is
*x − 1*, and the pills that go to day *x* are reported as extra.

The visit plan ([`src/lib/meds/visits.ts`](src/lib/meds/visits.ts)) reads the same simulation:
visit *k* covers `[visit k, visit k+1)`. With `S_k` the unmet demand over periods 1..k and `C_k`
the pills got at visits 1..k, visit *k* needs `max(0, S_k − C_{k−1})`, rounded up to whole packs
when the pack size is known; stock never goes negative, so this never double-counts.

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

`GET /api/medications` returns all data (medications with their supplies, counts and regimens,
visits, hospital stays) with the
server-side projection, visit plan and reserve estimate (`?today=YYYY-MM-DD&minutes=N` to
evaluate another moment). `GET /api/reports/visit[?date=YYYY-MM-DD]`, `/api/reports/stock` and
`/api/reports/reserve` return the PDF lists (inline, Chinese file names). They embed Noto Sans
SC (SIL OFL 1.1, from `@expo-google-fonts/noto-sans-sc`, subset to the glyphs used); the build
traces exactly the two weights used (see `src/lib/meds/pdf-fonts.ts`). `GET /api/health` checks
the database.

## Deployment

See [docs/deploy.md](docs/deploy.md): Docker Compose on the host, host PostgreSQL, nginx in front,
Cloudflare Access at the edge.

## License

[MIT](LICENSE)
