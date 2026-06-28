import { expect, test } from "@playwright/test";

import {
  detectScheduleMonthConflict,
  buildAssemblySyncRetryState,
  type AssemblySyncRetryState,
} from "@/lib/schedule/optimistic-lock";

// ---------------------------------------------------------------------------
// R1 — 단일 writer 정상 저장: 1행 업데이트는 충돌이 아님
// ---------------------------------------------------------------------------

test("R1: update returning 1 row is not a conflict", () => {
  expect(detectScheduleMonthConflict([{ month_key: "2026-06" }])).toBe(false);
});

test("R1: update returning multiple rows is not a conflict", () => {
  expect(detectScheduleMonthConflict([{ month_key: "2026-06" }, { month_key: "2026-07" }])).toBe(false);
});

test("R1: null data (error path) is not treated as conflict", () => {
  // null 은 에러 경로에서 올 수 있다. 충돌이 아닌 오류로 처리한다.
  expect(detectScheduleMonthConflict(null)).toBe(false);
});

// ---------------------------------------------------------------------------
// R2 — 연속 저장: 0행 업데이트(충돌)만 충돌로 인식
// ---------------------------------------------------------------------------

test("R2: empty array from update is a conflict", () => {
  expect(detectScheduleMonthConflict([])).toBe(true);
});

// R2 통합 시나리오 —
// 1회차 저장이 DB 반환 updated_at으로 캐시를 갱신하고,
// 2회차 저장이 갱신된 캐시 값을 사용하여 정상 성공하는 흐름을 검증한다.
// (persistScheduleStateNow / persistPublishedItem의 캐시 갱신 로직과 동일한 패턴)
test("R2: sequential saves — cache is updated from DB response and second save succeeds without conflict", () => {
  const cache = new Map<string, string | null>();
  const monthKey = "2026-06";

  // 1회차: DB UPDATE가 T1을 반환 → 충돌 없음 → 캐시에 T1 기록
  const save1Rows = [{ month_key: monthKey, updated_at: "2026-06-01T00:00:00.000Z" }];
  expect(detectScheduleMonthConflict(save1Rows)).toBe(false);
  cache.set(monthKey, (save1Rows as Array<{ updated_at: string | null }>)[0]?.updated_at ?? null);

  // 2회차: 캐시가 T1로 갱신되어 있어야 한다 (다음 저장에 전달할 값)
  expect(cache.get(monthKey)).toBe("2026-06-01T00:00:00.000Z");

  // 2회차: DB UPDATE가 T2를 반환 → 충돌 없음 → 캐시에 T2 기록
  const save2Rows = [{ month_key: monthKey, updated_at: "2026-06-01T00:00:01.000Z" }];
  expect(detectScheduleMonthConflict(save2Rows)).toBe(false);
  cache.set(monthKey, (save2Rows as Array<{ updated_at: string | null }>)[0]?.updated_at ?? null);

  // 캐시는 추정값이 아닌 DB 반환값(T2)으로 갱신되어야 한다
  expect(cache.get(monthKey)).toBe("2026-06-01T00:00:01.000Z");
});

// ---------------------------------------------------------------------------
// A — 충돌 재현: stale updated_at → 0행 update → 충돌 감지
// ---------------------------------------------------------------------------

test("A: retry state starts at attempt 0 with the given readUpdatedAt", () => {
  const state = buildAssemblySyncRetryState("2026-06-01T00:00:00.000Z");
  expect(state.attempt).toBe(0);
  expect(state.readUpdatedAt).toBe("2026-06-01T00:00:00.000Z");
  expect(state.exhausted).toBe(false);
});

test("A: advancing retry state increments attempt", () => {
  const initial = buildAssemblySyncRetryState("2026-06-01T00:00:00.000Z");
  const next = buildAssemblySyncRetryState("2026-06-01T00:00:01.000Z", initial.attempt + 1);
  expect(next.attempt).toBe(1);
  expect(next.readUpdatedAt).toBe("2026-06-01T00:00:01.000Z");
  expect(next.exhausted).toBe(false);
});

// ---------------------------------------------------------------------------
// B — 락 도입 후: 최대 시도 초과 시 exhausted로 전환 (허브 우선=웹훅 양보)
// ---------------------------------------------------------------------------

test("B: retry state is exhausted after max attempts", () => {
  const maxAttempts = 3;
  const state = buildAssemblySyncRetryState("2026-06-01T00:00:00.000Z", maxAttempts);
  expect(state.exhausted).toBe(true);
});

test("B: retry state is not exhausted before max attempts", () => {
  const maxAttempts = 3;
  const state = buildAssemblySyncRetryState("2026-06-01T00:00:00.000Z", maxAttempts - 1);
  expect(state.exhausted).toBe(false);
});

test("B: delay increases with each attempt (exponential backoff)", () => {
  const maxAttempts = 3;
  const baseDelayMs = 100;

  const delays = Array.from({ length: maxAttempts }, (_, i) => {
    const state = buildAssemblySyncRetryState("ts", i);
    return state.delayMs(baseDelayMs);
  });

  // attempt 0: 0ms (첫 번째 시도는 즉시)
  expect(delays[0]).toBe(0);
  // attempt 1: 100ms
  expect(delays[1]).toBe(100);
  // attempt 2: 300ms
  expect(delays[2]).toBe(300);
  // 단조 증가
  for (let i = 1; i < delays.length; i++) {
    expect(delays[i]).toBeGreaterThan(delays[i - 1]!);
  }
});
