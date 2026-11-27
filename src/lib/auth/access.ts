/**
 * App access key: the server routes publish and edit listings on the seller's
 * eBay account and spend Claude and sold-comps credit, so only a phone that
 * entered APP_ACCESS_KEY once (on /unlock) may call them. The phone keeps a
 * cookie holding a hash of the key, never the key itself.
 *
 * A client that cannot keep the cookie (the seller's Claude thread, whose network
 * secret adds the key outside its session) sends the key in KEY_HEADER on API calls.
 *
 * With APP_ACCESS_KEY unset the app stays open (local development, and so a
 * deploy before the key is set doesn't lock anyone out).
 *
 * Web Crypto only, so it runs in the proxy as well as in route handlers.
 */
export const ACCESS_COOKIE = "el_access";
/** About a year: the phone signs in once. */
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Paths reachable without the cookie: the unlock page and its route, and what every page needs to load. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/unlock" ||
    pathname === "/api/unlock" ||
    pathname === "/offline.html" ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico" ||
    pathname === "/apple-touch-icon.png" ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/_next/")
  );
}

/** The cookie value for a key: hex SHA-256, so the cookie never holds the key. */
export async function accessToken(key: string): Promise<string> {
  const data = new TextEncoder().encode(`ebay-lister:${key}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without stopping at the first different character. */
export function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** True when the cookie matches the key (or when no key is set). */
export async function hasAccess(key: string | undefined, cookie: string | undefined): Promise<boolean> {
  if (!key) return true;
  if (!cookie) return false;
  return sameString(cookie, await accessToken(key));
}

/** Request header that carries the key itself, for API calls only. */
export const KEY_HEADER = "x-elister-key";

/** True only when a key is set and the header holds exactly that key (compared as hashes). */
export async function hasHeaderAccess(key: string | undefined, header: string | null): Promise<boolean> {
  if (!key || !header) return false;
  return sameString(await accessToken(header), await accessToken(key));
}

/** Where to go after unlocking: only a path on this site, never another host. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
