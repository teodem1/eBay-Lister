import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, hasAccess, hasHeaderAccess, isPhoneOnly, isPublicPath, KEY_HEADER } from "./lib/auth/access";

/**
 * Locks the app to the seller's phone once APP_ACCESS_KEY is set: API calls
 * without the access cookie or key header get 401, pages redirect to /unlock.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (await hasAccess(process.env.APP_ACCESS_KEY, request.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    if (!isPhoneOnly(pathname) && (await hasHeaderAccess(process.env.APP_ACCESS_KEY, request.headers.get(KEY_HEADER)))) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "This app is locked. Open it and enter the access key." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
