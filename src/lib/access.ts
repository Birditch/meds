/**
 * Cloudflare Access gate.
 *
 * The site has no accounts of its own: Cloudflare Access sits in front of it and every
 * visitor it lets through shares the same data. Access signs each proxied request with a
 * JWT (`Cf-Access-Jwt-Assertion` header / `CF_Authorization` cookie); verifying it here
 * means a request that reaches the origin some other way is refused.
 *
 *   CF_ACCESS_TEAM_DOMAIN  e.g. "birditch.cloudflareaccess.com"
 *   CF_ACCESS_AUD          the Access application's Audience (AUD) tag
 *   MEDS_ACCESS_DISABLED=1 opt out explicitly (local acceptance only)
 *
 * Production without either the pair or the opt-out fails closed.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type AccessConfig =
  | { mode: "enforce"; teamDomain: string; aud: string }
  | { mode: "disabled" }
  | { mode: "misconfigured" };

export function accessConfig(): AccessConfig {
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const aud = process.env.CF_ACCESS_AUD?.trim();
  if (teamDomain && aud) return { mode: "enforce", teamDomain, aud };
  if (process.env.MEDS_ACCESS_DISABLED === "1" || process.env.NODE_ENV !== "production") {
    return { mode: "disabled" };
  }
  return { mode: "misconfigured" };
}

const jwksByTeam = new Map<string, JWTVerifyGetKey>();
function jwks(teamDomain: string): JWTVerifyGetKey {
  let set = jwksByTeam.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, set);
  }
  return set;
}

function tokenFrom(headers: Headers): string | null {
  const header = headers.get("cf-access-jwt-assertion");
  if (header) return header;
  const cookie = headers.get("cookie");
  const m = cookie && /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

export type AccessResult =
  | { ok: true; email: string | null }
  | { ok: false; status: 401 | 503; message: string };

export async function checkAccess(headers: Headers): Promise<AccessResult> {
  const cfg = accessConfig();
  if (cfg.mode === "disabled") return { ok: true, email: null };
  if (cfg.mode === "misconfigured") {
    return { ok: false, status: 503, message: "Cloudflare Access is not configured (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD)." };
  }
  const token = tokenFrom(headers);
  if (!token) return { ok: false, status: 401, message: "Missing Cloudflare Access token." };
  try {
    const { payload } = await jwtVerify(token, jwks(cfg.teamDomain), {
      issuer: `https://${cfg.teamDomain}`,
      audience: cfg.aud,
    });
    return { ok: true, email: typeof payload.email === "string" ? payload.email : null };
  } catch {
    return { ok: false, status: 401, message: "Invalid Cloudflare Access token." };
  }
}
