# Deployment

Production runs on a single host (SSH alias `server`):

```
visitor ─▶ Cloudflare (Access) ─▶ nginx :443 (Origin CA) ─▶ meds-web 127.0.0.1:28100 ─▶ PostgreSQL 127.0.0.1:5432
```

| What | Where |
|---|---|
| Compose project / container | `/opt/meds/compose.yaml`, project `meds`, container `meds-web` (host network, loopback only) |
| Secrets / runtime config | `/opt/meds/.env` (root, mode 600; template: [`.env.example`](../.env.example)) |
| Source checkout used for builds | `/opt/meds/src` (detached at the deployed commit) |
| Deploy history | `/opt/meds/deployments.log` (`<sha> <utc time>` per healthy deploy) |
| Images | `meds:sha-<commit>` per build; `meds:current` = last healthy one |
| nginx vhost | `/www/server/panel/vhost/nginx/meds.birditch.net.conf` (copy of [`deploy/nginx/`](../deploy/nginx/meds.birditch.net.conf)) |
| Database | `meds` on the host PostgreSQL (`/www/server/pgsql`), owned by role `meds` |
| Logs | `docker logs meds-web`; nginx: `/www/wwwlogs/meds.birditch.net{,.error}.log` |

## Deploy a new version

```bash
git push origin main
deploy/deploy.sh            # or deploy/deploy.sh <commit>
```

`deploy.sh` refuses uncommitted or unpushed commits, then on the host checks the commit out,
builds `meds:sha-<commit>` (the image build runs the unit tests), replaces the container, waits
for the health check and tags it `meds:current`. If the new container is not healthy within 90 s
it prints the logs and restarts the previous image. Database migrations in `drizzle/` are applied
by the app itself at boot (`src/instrumentation.ts`), so a deploy is also a migration.

## Operate

```bash
ssh server
cd /opt/meds
docker compose ps                     # state + health
docker compose logs -f --tail 100
docker compose restart                # same image
docker compose up -d                  # (re)start meds:current
MEDS_IMAGE_TAG=sha-<commit> docker compose up -d --wait   # run a specific older build
docker compose down                   # stop (data lives in PostgreSQL, nothing is lost)
curl -s http://127.0.0.1:28100/api/health                 # {"ok":true}
```

## First-time setup (already done on `server`; for reference)

1. **Database** — as the `postgres` superuser (peer auth):

   ```sql
   CREATE ROLE meds LOGIN PASSWORD '<random>';
   CREATE DATABASE meds OWNER meds;
   REVOKE ALL ON DATABASE meds FROM PUBLIC;
   ```

   The existing `pg_hba.conf` rule `host all all 127.0.0.1/32 scram-sha-256` covers it.

2. **`/opt/meds/.env`** (mode 600): `DATABASE_URL=postgres://meds:<random>@127.0.0.1:5432/meds`,
   `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`.

3. **nginx** — copy `deploy/nginx/meds.birditch.net.conf` into
   `/www/server/panel/vhost/nginx/`, then `nginx -t && /etc/init.d/nginx reload`. Written by hand
   on purpose: creating the site in the BT panel UI would overwrite it from the panel's template.
   It only answers Cloudflare's IP ranges (anything else gets `444`) and serves the
   `*.birditch.net` Cloudflare Origin CA certificate, so the DNS record must stay proxied.

4. **Cloudflare**
   - DNS: `meds.birditch.net` → the server's IP, **proxied** (orange cloud). SSL mode Full (strict).
   - Zero Trust → Access → Applications → *Self-hosted* for `meds.birditch.net`, with a policy
     listing who may enter. Everyone admitted shares the same data.
   - Copy the application's **AUD** and your team domain (`<team>.cloudflareaccess.com`) into
     `.env`, then `docker compose up -d`.

   The app verifies the `Cf-Access-Jwt-Assertion` JWT on every request (`src/proxy.ts`) and
   re-checks it inside every Server Action. Without `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` it
   answers 503 rather than run unprotected.

   Current setup (2026-11-06):

   | | |
   |---|---|
   | DNS | `A meds.birditch.net → 13.230.90.76`, proxied |
   | Team domain | `withered-hall-b5c3.cloudflareaccess.com` |
   | Access application | "meds 药品余量", self-hosted, `meds.birditch.net`, session 24h |
   | Policy | "Allow Owner Email" — allow, include one email (the account owner) |
   | Login method | the account's existing Cloudflare-account login (no change to identity providers) |

   To let someone else in, add their email to that policy in Zero Trust → Access → Applications;
   no redeploy is needed. Changing the application (new AUD) means updating `CF_ACCESS_AUD`
   in `.env` and `docker compose up -d --force-recreate`.

## Troubleshooting

| Symptom | Check |
|---|---|
| 503 "Cloudflare Access is not configured" | `.env` lacks `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` |
| 401 "Invalid Cloudflare Access token" | AUD/team domain mismatch, or the request bypassed Access |
| Cloudflare 521/522 | `docker compose ps`; `curl 127.0.0.1:28100/api/health`; `nginx -t` |
| Container unhealthy | `docker logs meds-web` — usually `DATABASE_URL` or a failed migration |
| Saving fails with a toast | `docker logs meds-web` shows `[meds] action failed` with the database error |
