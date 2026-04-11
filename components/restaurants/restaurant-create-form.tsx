"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasGoogleMapsApiKey } from "@/lib/google/maps";
import type { RestaurantCreateInput } from "@/lib/restaurants/types";
import { createRestaurant } from "@/lib/restaurants/create";
import type { RestaurantPlaceSelection } from "@/lib/restaurants/google-places";
import { RestaurantPlaceSearch } from "@/components/restaurants/restaurant-place-search";
import { readGeolocationPermissionState, requestBrowserLocation } from "@/lib/restaurants/location";
import type { GeolocationPermissionState } from "@/lib/restaurants/types";
import { LocationPermissionBanner } from "@/components/restaurants/location-permission-banner";

const EMPTY_FORM: RestaurantCreateInput = {
  name: "",
  address: "",
  note: "",
  placeId: "",
  lat: "",
  lng: "",
};

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

export function RestaurantCreateForm({ authorId }: { authorId: string | null }) {
  const router = useRouter();
  const searchEnabled = hasGoogleMapsApiKey();
  const [form, setForm] = useState<RestaurantCreateInput>(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "warn" | "note">("note");
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<RestaurantPlaceSelection | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [permissionState, setPermissionState] = useState<GeolocationPermissionState>("checking");

  useEffect(() => {
    void readGeolocationPermissionState().then((nextPermissionState) => {
      setPermissionState(nextPermissionState);
    });
  }, []);

  const updateField = (key: keyof RestaurantCreateInput, value: string) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const applyCurrentLocation = () => {
    setPermissionState("requesting");
    setLocating(true);
    setMessageTone("note");
    setMessage("현재 위치를 가져오는 중입니다.");

    void requestBrowserLocation().then((result) => {
      setLocating(false);
      if (result.ok) {
        setPermissionState("granted");
        setCurrentLocation(result.location);
        setForm((current) => ({
          ...current,
          lat: formatCoordinate(result.location.lat),
          lng: formatCoordinate(result.location.lng),
        }));
        setMessageTone("ok");
        setMessage("현재 위치 좌표를 입력했습니다.");
        return;
      }

      setPermissionState(result.permissionState);
      setMessageTone("warn");
      setMessage(
        result.permissionState === "denied"
          ? "위치 권한이 꺼져 있습니다. 브라우저 또는 휴대폰 설정을 확인한 뒤 다시 시도해 주세요."
          : result.message,
      );
    });
  };

  const handlePlaceSelect = (place: RestaurantPlaceSelection) => {
    setSelectedPlace(place);
    setMessageTone("ok");
    setMessage("장소를 선택했습니다. 코멘트를 확인한 뒤 저장해 주세요.");
    setForm((current) => ({
      ...current,
      name: place.name,
      address: place.address,
      lat: formatCoordinate(place.lat),
      lng: formatCoordinate(place.lng),
      placeId: place.placeId,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!authorId) {
      setMessageTone("warn");
      setMessage("로그인 정보가 없습니다. 다시 로그인해 주세요.");
      return;
    }

    if (searchEnabled && !form.placeId.trim()) {
      setMessageTone("warn");
      setMessage("장소를 먼저 검색해서 선택해 주세요.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    const result = await createRestaurant(authorId, form);
    setSubmitting(false);

    if (!result.ok) {
      setMessageTone("warn");
      setMessage(result.message);
      return;
    }

    setMessageTone("ok");
    setMessage(result.message);
    window.setTimeout(() => {
      router.push("/restaurants");
      router.refresh();
    }, 250);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
      {(permissionState === "denied" || permissionState === "unsupported" || permissionState === "error") ? (
        <LocationPermissionBanner
          permissionState={permissionState}
          locationStatus={permissionState === "denied" ? "denied" : "error"}
          onRetry={applyCurrentLocation}
          message={
            permissionState === "denied"
              ? "모바일에서는 브라우저 또는 휴대폰 설정에서 위치 권한을 허용한 뒤 다시 시도해 주세요."
              : undefined
          }
        />
      ) : null}

      <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <strong style={{ fontSize: 18 }}>1. 장소 검색</strong>
          <RestaurantPlaceSearch currentLocation={currentLocation} disabled={submitting} onSelect={handlePlaceSelect} />
        </div>
      </div>

      <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 18 }}>2. 선택된 장소 정보</strong>
            {selectedPlace ? <span className="chip">선택 완료</span> : <span className="chip">미선택</span>}
          </div>

          {!searchEnabled ? (
            <div className="status note">API 키가 없어서 수동 입력 모드로 표시합니다.</div>
          ) : null}

          <label style={{ display: "grid", gap: 8 }}>
            <span>가게명</span>
            <input
              className="field-input"
              placeholder="장소 검색 후 자동 입력됩니다."
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              disabled={submitting}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span>주소</span>
            <input
              className="field-input"
              placeholder="장소 검색 후 자동 입력됩니다."
              value={form.address}
              onChange={(event) => updateField("address", event.target.value)}
              disabled={submitting}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 8 }}>
              <span>위도 lat</span>
              <input
                className="field-input"
                inputMode="decimal"
                placeholder="예: 37.566500"
                value={form.lat}
                onChange={(event) => updateField("lat", event.target.value)}
                disabled={submitting}
              />
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span>경도 lng</span>
              <input
                className="field-input"
                inputMode="decimal"
                placeholder="예: 126.978000"
                value={form.lng}
                onChange={(event) => updateField("lng", event.target.value)}
                disabled={submitting}
              />
            </label>
          </div>

          {form.placeId ? (
            <div className="muted" style={{ fontSize: 12 }}>
              place_id {form.placeId}
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ background: "rgba(35, 52, 84, 0.22)" }}>
        <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
          <strong style={{ fontSize: 18 }}>3. 추가 입력</strong>
          <label style={{ display: "grid", gap: 8 }}>
            <span>한줄 코멘트</span>
            <textarea
              className="field-input"
              placeholder="100자 이내로 간단히 남겨 주세요."
              value={form.note}
              onChange={(event) => updateField("note", event.target.value.slice(0, 100))}
              disabled={submitting}
              rows={4}
              style={{ resize: "vertical", minHeight: 110 }}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              {form.note.length}/100
            </span>
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn white" onClick={applyCurrentLocation} disabled={submitting || locating}>
          {locating ? "현재 위치 확인 중..." : "현재 위치 사용"}
        </button>
        <button type="submit" className="btn primary" disabled={submitting || (searchEnabled && !form.placeId.trim())}>
          {submitting ? "저장 중..." : "저장"}
        </button>
        <button type="button" className="btn" onClick={() => router.push("/restaurants")} disabled={submitting}>
          취소
        </button>
      </div>

      {message ? <div className={`status ${messageTone}`}>{message}</div> : null}
    </form>
  );
}
