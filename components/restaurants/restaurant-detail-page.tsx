"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSession, initializeAuth, subscribeToAuth, type SessionUser } from "@/lib/auth/storage";
import { RestaurantsMap } from "@/components/restaurants/restaurants-map";
import { RestaurantCommentForm } from "@/components/restaurants/restaurant-comment-form";
import { RestaurantCommentList } from "@/components/restaurants/restaurant-comment-list";
import { fetchRestaurantComments, fetchRestaurantDetail } from "@/lib/restaurants/fetch";
import { calculateDistanceMeters, formatDistance } from "@/lib/restaurants/distance";
import type { NearbyRestaurant, RestaurantCommentRow, RestaurantRow } from "@/lib/restaurants/types";

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function RestaurantDetailPage({ restaurantId }: { restaurantId: string }) {
  const [session, setSession] = useState<SessionUser | null>(() => getSession());
  const [restaurant, setRestaurant] = useState<RestaurantRow | null>(null);
  const [comments, setComments] = useState<RestaurantCommentRow[]>([]);
  const [loadingRestaurant, setLoadingRestaurant] = useState(true);
  const [loadingComments, setLoadingComments] = useState(true);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "warn" | "note">("note");
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void initializeAuth().then((nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
    });

    const unsubscribe = subscribeToAuth((nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const loadRestaurant = useCallback(async () => {
    setLoadingRestaurant(true);
    const result = await fetchRestaurantDetail(restaurantId);
    setLoadingRestaurant(false);

    if (!result.ok) {
      setMessageTone("warn");
      setMessage(result.message ?? "맛집 정보를 불러오지 못했습니다.");
      return;
    }

    setRestaurant(result.detail.restaurant);
    if (!result.detail.restaurant) {
      setMessageTone("warn");
      setMessage("식당을 찾지 못했습니다.");
    }
  }, [restaurantId]);

  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    const result = await fetchRestaurantComments(restaurantId);
    setLoadingComments(false);

    if (!result.ok) {
      setMessageTone("warn");
      setMessage(result.message ?? "코멘트를 불러오지 못했습니다.");
      return;
    }

    setComments(result.comments);
  }, [restaurantId]);

  useEffect(() => {
    void loadRestaurant();
    void loadComments();
  }, [loadComments, loadRestaurant]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCurrentLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        // Current location on detail page is optional.
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000,
      },
    );
  }, []);

  const detailRestaurantForMap = useMemo<NearbyRestaurant[]>(() => {
    if (!restaurant) return [];
    return [
      {
        ...restaurant,
        distanceMeters: currentLocation
          ? calculateDistanceMeters(currentLocation, {
              lat: restaurant.lat,
              lng: restaurant.lng,
            })
          : null,
      },
    ];
  }, [currentLocation, restaurant]);

  return (
    <section className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/restaurants" className="btn" style={{ textDecoration: "none" }}>
            뒤로가기
          </Link>
          {restaurant ? <span className="chip">{formatDistance(detailRestaurantForMap[0]?.distanceMeters ?? null)}</span> : null}
        </div>

        {loadingRestaurant ? <div className="status note">상세 데이터를 불러오는 중입니다.</div> : null}
        {!loadingRestaurant && !restaurant ? <div className="status warn">식당이 없거나 잘못된 주소입니다.</div> : null}
        {message ? <div className={`status ${messageTone}`}>{message}</div> : null}

        {restaurant ? (
          <>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="chip">맛집 상세</div>
              <div>
                <h1 style={{ margin: 0, fontSize: "clamp(30px, 5vw, 44px)", lineHeight: 1.05 }}>{restaurant.name}</h1>
                <p className="muted" style={{ margin: "10px 0 0", fontSize: 15 }}>
                  {restaurant.address || "주소 정보 없음"}
                </p>
              </div>
            </div>

            {restaurant.note ? (
              <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
                <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
                  <strong style={{ fontSize: 18 }}>등록 메모</strong>
                  <div style={{ lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{restaurant.note}</div>
                </div>
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
                <div className="panel-pad" style={{ display: "grid", gap: 8 }}>
                  <strong style={{ fontSize: 18 }}>기본 정보</strong>
                  <span className="muted">등록일 {formatCreatedAt(restaurant.createdAt) || "-"}</span>
                  <span className="muted">등록자 {restaurant.authorName || "이름 미확인"}</span>
                  <span className="muted">위도 {restaurant.lat.toFixed(6)}</span>
                  <span className="muted">경도 {restaurant.lng.toFixed(6)}</span>
                </div>
              </div>

              <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
                <div className="panel-pad" style={{ display: "grid", gap: 8 }}>
                  <strong style={{ fontSize: 18 }}>위치</strong>
                  <RestaurantsMap currentLocation={currentLocation} restaurants={detailRestaurantForMap} />
                </div>
              </div>
            </div>

            <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
              <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
                <strong style={{ fontSize: 18 }}>코멘트 남기기</strong>
                <RestaurantCommentForm
                  restaurantId={restaurant.id}
                  authorId={session?.id ?? null}
                  onCreated={async () => {
                    await loadComments();
                  }}
                />
              </div>
            </div>

            <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
              <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 18 }}>코멘트 목록</strong>
                  {loadingComments ? <span className="muted">코멘트 불러오는 중</span> : <span className="muted">{comments.length}개</span>}
                </div>
                {loadingComments ? (
                  <div className="status note">코멘트를 불러오는 중입니다.</div>
                ) : (
                  <RestaurantCommentList
                    comments={comments}
                    currentUserId={session?.id ?? null}
                    onDeleted={async () => {
                      await loadComments();
                    }}
                  />
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
