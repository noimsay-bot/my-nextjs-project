"use client";

import { useEffect, useState } from "react";
import { getSession, initializeAuth, subscribeToAuth, type SessionUser } from "@/lib/auth/storage";
import { RestaurantCreateForm } from "@/components/restaurants/restaurant-create-form";

export function RestaurantCreatePage() {
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void initializeAuth().then((nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setCheckingSession(false);
    });

    const unsubscribe = subscribeToAuth((nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setCheckingSession(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="chip">맛집 등록</div>
          <div>
            <h1 style={{ margin: 0, fontSize: "clamp(30px, 5vw, 44px)", lineHeight: 1.05 }}>맛집 등록</h1>
            <p className="muted" style={{ margin: "10px 0 0", fontSize: 15 }}>
              구글 장소 검색으로 음식점을 선택하고 한줄 코멘트와 함께 등록할 수 있습니다.
            </p>
          </div>
        </div>

        {checkingSession ? (
          <div className="status note">로그인 정보를 확인하는 중입니다.</div>
        ) : null}
        {!checkingSession && !session ? (
          <div className="status warn">로그인 정보가 없습니다. 다시 로그인해 주세요.</div>
        ) : null}
        {!checkingSession && session && !session.approved ? (
          <div className="status warn">권한이 없습니다. 관리자 승인 후 이용해 주세요.</div>
        ) : null}
        {!checkingSession && session?.approved ? <RestaurantCreateForm authorId={session.id} /> : null}
      </div>
    </section>
  );
}
