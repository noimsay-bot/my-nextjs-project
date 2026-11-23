"use client";

// 보호 데이터 읽기·쓰기의 실제 연결. 규칙은 e2e-state-core.ts에 있다.

import { getPortalSession } from "@/lib/supabase/portal";
import { createTeamLeadProtectedState } from "@/lib/team-lead/e2e-state-core";
import { loadTeamLeadCryptoMeta, teamLeadE2eKeys } from "@/lib/team-lead/e2e-keys";

const LOCKED_NOTICE_EVENT = "j-team-lead-storage-status";
let lastLockedNoticeAt = 0;

export const teamLeadProtectedState = createTeamLeadProtectedState({
  async getSession() {
    const session = await getPortalSession();
    if (!session) return null;
    // 화면 체험 등급이 아니라 실제 등급으로 판단한다.
    return { id: session.id, role: session.actualRole, approved: session.approved };
  },
  loadCryptoMeta: loadTeamLeadCryptoMeta,
  getUnlockedDataKey: (profileId) => teamLeadE2eKeys.getUnlockedDataKey(profileId),
  getDataKeyForVersion: (profileId, keyVersion) => teamLeadE2eKeys.getDataKeyForVersion(profileId, keyVersion),
  unlock: () => teamLeadE2eKeys.unlock(),
  onLocked() {
    // 총괄팀장 화면에만 한 번 안내한다(같은 순간 여러 key가 잠겨도 한 번만).
    if (typeof window === "undefined") return;
    const now = Date.now();
    if (now - lastLockedNoticeAt < 5000) return;
    lastLockedNoticeAt = now;
    window.dispatchEvent(
      new CustomEvent(LOCKED_NOTICE_EVENT, {
        detail: {
          ok: false,
          message: "이 기기는 보안 열쇠가 잠겨 있어 일부 총괄팀장 데이터를 표시할 수 없습니다. 보안 열쇠 화면에서 이 기기를 열어 주세요.",
        },
      }),
    );
  },
});
