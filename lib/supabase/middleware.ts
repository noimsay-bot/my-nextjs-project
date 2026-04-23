import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_AUTH_COOKIE_SUFFIX = "-auth-token";
const PROTECTED_ROUTE_PREFIXES = ["/admin", "/review", "/schedule", "/submissions", "/team-lead", "/vacation"] as const;

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes(SUPABASE_AUTH_COOKIE_SUFFIX));
}

function isProtectedRoute(pathname: string) {
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function buildLoginRedirect(request: NextRequest, pathname: string, reason?: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  if (reason) {
    loginUrl.searchParams.set("reason", reason);
  }
  return NextResponse.redirect(loginUrl);
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasAuthCookie = hasSupabaseAuthCookie(request);

  if (!isProtectedRoute(pathname)) {
    return NextResponse.next({ request });
  }

  if (!hasAuthCookie) {
    return buildLoginRedirect(request, pathname);
  }

  return NextResponse.next({ request });
}
