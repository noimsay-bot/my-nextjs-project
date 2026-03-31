import { createBrowserClient } from "@supabase/ssr";

export const SUPABASE_ENV_ERROR_MESSAGE =
  "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.";

export function hasSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return false;
  }

  if (
    url.includes("your-project-ref") ||
    publishableKey.includes("your-supabase-publishable-key")
  ) {
    return false;
  }

  return true;
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(SUPABASE_ENV_ERROR_MESSAGE);
  }

  return createBrowserClient(url, publishableKey);
}
