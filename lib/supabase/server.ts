import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const SUPABASE_AUTH_COOKIE_SUFFIX = "-auth-token";

async function getCookieStore() {
  return cookies();
}

export async function hasSupabaseAuthCookie() {
  const cookieStore = await getCookieStore();
  return cookieStore
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes(SUPABASE_AUTH_COOKIE_SUFFIX));
}

export async function createClient() {
  const cookieStore = await getCookieStore();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies. Middleware handles refreshes.
        }
      },
    },
  });
}
