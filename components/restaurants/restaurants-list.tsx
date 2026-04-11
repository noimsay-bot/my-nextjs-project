"use client";

import Link from "next/link";
import { formatDistance } from "@/lib/restaurants/distance";
import type { NearbyRestaurant } from "@/lib/restaurants/types";

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function RestaurantsList({
  restaurants,
  hasCurrentLocation,
}: {
  restaurants: NearbyRestaurant[];
  hasCurrentLocation: boolean;
}) {
  if (restaurants.length === 0) {
    return <div className="status note">등록된 맛집이 아직 없습니다.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {restaurants.map((restaurant, index) => (
        <Link
          key={restaurant.id}
          href={`/restaurants/${restaurant.id}`}
          style={{ color: "inherit", textDecoration: "none", display: "block" }}
        >
          <article className="panel">
            <div className="panel-pad" style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <strong style={{ fontSize: 18 }}>{restaurant.name}</strong>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {restaurant.address || "주소 정보 없음"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="chip">#{index + 1}</span>
                  <span className="chip">{formatDistance(restaurant.distanceMeters)}</span>
                </div>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {hasCurrentLocation
                  ? "현재 위치 기준 가까운 순으로 정렬했습니다."
                  : "현재 위치 확인 전이라 등록 순으로 표시합니다."}
              </div>
              {restaurant.note ? (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 16,
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {restaurant.note}
                </div>
              ) : null}
              <div className="muted" style={{ fontSize: 13 }}>
                등록일 {formatCreatedAt(restaurant.createdAt) || "-"}
              </div>
            </div>
          </article>
        </Link>
      ))}
    </div>
  );
}
