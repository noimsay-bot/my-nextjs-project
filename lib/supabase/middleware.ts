import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_AUTH_COOKIE_SUFFIX = "-auth-token";
const PROTECTED_ROUTE_PREFIXES = ["/admin", "/review", "/schedule", "/submissions", "/team-lead", "/vacation"] as const;

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes(SUPABASE_AUTH_COOKIE_SUFFIX));
}

function authLog(stage: string, details: Record<string, unknown>) {
  console.info(`[auth] ${stage}`, details);
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

  authLog("middleware.entry", {
    pathname,
    hasAuthCookie,
  });

  if (!isProtectedRoute(pathname)) {
    authLog("middleware.next", {
      pathname,
      reason: "unprotected-route",
    });
    return NextResponse.next({ request });
  }

  if (!hasAuthCookie) {
    authLog("middleware.redirect", {
      pathname,
      reason: "missing-session-cookie",
    });
    return buildLoginRedirect(request, pathname);
  }

  authLog("middleware.next", {
    pathname,
    reason: "session-cookie-present",
  });
  return NextResponse.next({ request });
}
