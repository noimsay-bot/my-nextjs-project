import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const E2E_BASE_URL = "http://127.0.0.1:3101";
export const AUTH_CACHE_KEY = "j-special-force-auth-cache-v4";

type E2eSupabaseSession = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: number;
  user: {
    id: string;
    email: string;
    user_metadata: {
      role: string;
      login_id: string;
      name: string;
    };
  };
};

export function getSupabaseAuthTokenKey() {
  for (const envFile of [".env.local", ".env"]) {
    const fullPath = path.join(process.cwd(), envFile);
    if (!fs.existsSync(fullPath)) continue;
    const text = fs.readFileSync(fullPath, "utf8");
    const match = text.match(/NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+)/);
    if (!match) continue;
    const value = match[1].trim().replace(/^['"]|['"]$/g, "");
    const host = new URL(value).hostname.split(".")[0];
    return `sb-${host}-auth-token`;
  }
  return "sb-local-auth-token";
}

export function createE2eSupabaseSession(): E2eSupabaseSession {
  return {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "admin-seed",
      email: "admin@example.com",
      user_metadata: {
        role: "admin",
        login_id: "admin",
        name: "관리자",
      },
    },
  };
}

export function encodeSupabaseCookie(session: E2eSupabaseSession) {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

export async function seedSupabaseAuthCookie(page: Page) {
  const supabaseAuthTokenKey = getSupabaseAuthTokenKey();
  const supabaseSession = createE2eSupabaseSession();
  const supabaseCookieValue = encodeSupabaseCookie(supabaseSession);

  await page.context().addCookies([
    {
      name: supabaseAuthTokenKey,
      value: supabaseCookieValue,
      url: E2E_BASE_URL,
      sameSite: "Lax",
    },
  ]);

  return { supabaseAuthTokenKey, supabaseSession, supabaseCookieValue };
}
