import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkAccess } from "./access";

const TEAM = "unit-test.cloudflareaccess.com";
const AUD = "test-aud";

let privateKey: CryptoKey;
let jwks: { keys: object[] };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function enforce() {
  vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", `https://${TEAM}/`);
  vi.stubEnv("CF_ACCESS_AUD", AUD);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
      return new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });
    }),
  );
}

const sign = (claims: { iss?: string; aud?: string; email?: string }) =>
  new SignJWT({ email: claims.email ?? "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(claims.iss ?? `https://${TEAM}`)
    .setAudience(claims.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

describe("checkAccess", () => {
  it("accepts a token from the configured team and application", async () => {
    enforce();
    const token = await sign({});
    expect(await checkAccess(new Headers({ "cf-access-jwt-assertion": token }))).toEqual({
      ok: true,
      email: "owner@example.com",
    });
    // The CF_Authorization cookie works too.
    expect(await checkAccess(new Headers({ cookie: `a=1; CF_Authorization=${token}` }))).toMatchObject({ ok: true });
  });

  it("rejects another application's token, another team's token, and no token", async () => {
    enforce();
    expect(await checkAccess(new Headers({ "cf-access-jwt-assertion": await sign({ aud: "other-app" }) }))).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      await checkAccess(new Headers({ "cf-access-jwt-assertion": await sign({ iss: "https://evil.cloudflareaccess.com" }) })),
    ).toMatchObject({ ok: false, status: 401 });
    expect(await checkAccess(new Headers())).toMatchObject({ ok: false, status: 401 });
  });

  it("fails closed in production without configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", "");
    vi.stubEnv("CF_ACCESS_AUD", "");
    expect(await checkAccess(new Headers())).toMatchObject({ ok: false, status: 503 });
    vi.stubEnv("MEDS_ACCESS_DISABLED", "1");
    expect(await checkAccess(new Headers())).toEqual({ ok: true, email: null });
  });
});
