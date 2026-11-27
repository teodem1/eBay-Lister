import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, accessToken, sameString } from "@/lib/auth/access";

/** POST { key } -> sets the access cookie when the key matches APP_ACCESS_KEY. */
export async function POST(request: Request) {
  const expected = process.env.APP_ACCESS_KEY;
  if (!expected) return Response.json({ ok: true });
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key || !sameString(await accessToken(key), await accessToken(expected))) {
    // Slows guessing down.
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ error: "That key isn't right." }, { status: 401 });
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${ACCESS_COOKIE}=${await accessToken(expected)}; Path=/; Max-Age=${ACCESS_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
      },
    },
  );
}
