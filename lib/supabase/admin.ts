import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ReturnType of the generic factory erases its default schema and makes RPC
// arguments infer as undefined. Match the factory's default client type instead.
let adminClient: SupabaseClient | null = null;

export function hasSupabaseAdminEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "임시 비밀번호 발급을 위해 Vercel 환경변수에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요.",
    );
  }

  if (!adminClient) {
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
}
