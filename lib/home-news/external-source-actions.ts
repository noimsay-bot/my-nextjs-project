"use server";

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { buildExternalNewsWorkspace } from "@/lib/home-news/briefing-batch";
import { scoreExternalNewsCandidates } from "@/lib/home-news/external-candidate-scoring";
import { fetchExternalNewsRawItems } from "@/lib/home-news/external-source-fetchers";
import { ExternalNewsWorkspaceResponse } from "@/lib/home-news/external-source-types";
import { toExternalNewsCandidate } from "@/lib/home-news/external-source-transform";
import { NewsBriefingAdminRecord } from "@/lib/home-news/admin-types";

function hasAdminLikeRole(role: string | null | undefined) {
  return role === "admin" || role === "team_lead";
}

async function requireServerAdminSession() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("로그인된 관리자 세션을 확인하지 못했습니다.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, approved")
    .eq("id", user.id)
    .single<{ id: string; role: string; approved: boolean }>();

  if (profileError || !profile || !hasAdminLikeRole(profile.role) || !profile.approved) {
    throw new Error("외부 뉴스 후보 조회 권한이 없습니다.");
  }
}

export async function loadExternalNewsWorkspace(
  existingItems: NewsBriefingAdminRecord[],
): Promise<ExternalNewsWorkspaceResponse> {
  try {
    await requireServerAdminSession();

    const generatedAt = new Date();
    const rawItems = await fetchExternalNewsRawItems();
    const normalizedCandidates = rawItems.map(toExternalNewsCandidate);

    if (normalizedCandidates.length === 0) {
      return {
        ok: true,
        message: "지금은 가져올 수 있는 외부 뉴스 후보가 없습니다.",
        workspace: buildExternalNewsWorkspace(generatedAt, [], []),
      };
    }

    const scored = scoreExternalNewsCandidates(normalizedCandidates, {
      existingItems,
      now: generatedAt,
    });

    return {
      ok: true,
      message: "외부 뉴스 후보를 불러왔습니다.",
      workspace: buildExternalNewsWorkspace(generatedAt, scored.candidates, scored.trendHints),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "외부 뉴스 후보를 불러오지 못했습니다.",
    };
  }
}
