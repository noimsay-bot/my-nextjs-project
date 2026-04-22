import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_AUTH_COOKIE_SUFFIX = "-auth-token";
const MIDDLEWARE_AUTH_TIMEOUT_MS = 4_000;

function needsAuthenticatedPortalSession(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/review") ||
    pathname.startsWith("/schedule") ||
    pathname.startsWith("/submissions") ||
    pathname.startsWith("/team-lead") ||
    pathname.startsWith("/vacation")
  );
}

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes(SUPABASE_AUTH_COOKIE_SUFFIX));
}

function buildLoginRedirect(request: NextRequest, pathname: string, reason?: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  if (reason) {
    loginUrl.searchParams.set("reason", reason);
  }
  return NextResponse.redirect(loginUrl);
}

async function getUserWithTimeout(supabase: ReturnType<typeof createServerClient>) {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      reject(new Error("Supabase auth middleware timeout"));
    }, MIDDLEWARE_AUTH_TIMEOUT_MS);
  });

  return Promise.race([supabase.auth.getUser(), timeoutPromise]);
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    if (!hasSupabaseAuthCookie(request) && needsAuthenticatedPortalSession(pathname)) {
      return buildLoginRedirect(request, pathname);
    }

    return NextResponse.next({ request });
  }

  if (!hasSupabaseAuthCookie(request)) {
    if (needsAuthenticatedPortalSession(pathname)) {
      return buildLoginRedirect(request, pathname);
    }

    return NextResponse.next({
      request,
    });
  }

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  try {
    const {
      data: { user },
    } = await getUserWithTimeout(supabase);

    if (!user && needsAuthenticatedPortalSession(pathname)) {
      return buildLoginRedirect(request, pathname);
    }
  } catch (error) {
    console.warn("Supabase middleware session check failed.", error);
    if (needsAuthenticatedPortalSession(pathname)) {
      return buildLoginRedirect(request, pathname, "supabase-unavailable");
    }
  }

  return response;
}
