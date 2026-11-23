import { expect, test, type Page, type Route } from "@playwright/test";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "../e2e-auth";

// 총괄팀장 보안 열쇠 화면을 휴대폰 화면에서 처음부터 끝까지(기기 등록 → 열쇠 만들기 → 복구 코드) 확인한다.
// Supabase는 이 테스트 안의 가짜 저장소로 대신한다. 실제 DB에는 접속하지 않는다.

const TEAM_LEAD_ID = "admin-seed";

type Row = Record<string, unknown>;

function createFakeBackend() {
  const holders: Row[] = [];
  const envelopes: Row[] = [];
  const state = new Map<string, { state: unknown; updated_at: string }>();
  let sequence = 0;
  let clock = 0;
  const putState = (key: string, value: unknown) => {
    clock += 1;
    state.set(key, { state: value, updated_at: new Date(Date.UTC(2026, 10, 23, 2, 0, clock)).toISOString() });
  };

  const withOwner = (row: Row) => ({ ...row, owner: { name: row.profile_id ? "총괄팀장" : null } });

  function readEq(url: URL, column: string) {
    const raw = url.searchParams.get(column);
    return raw?.startsWith("eq.") ? raw.slice(3) : null;
  }

  async function reply(route: Route, rows: Row[] | Row | null) {
    const wantsObject = (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      const single = Array.isArray(rows) ? rows[0] ?? null : rows;
      if (!single) {
        await route.fulfill({
          status: 406,
          contentType: "application/json",
          body: JSON.stringify({ code: "PGRST116", details: "0 rows", hint: null, message: "no rows" }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows ?? []) });
  }

  function readIn(url: URL, column: string) {
    const raw = url.searchParams.get(column);
    if (!raw?.startsWith("in.(")) return null;
    return raw.slice(4, -1).split(",").map((item) => item.replace(/^"|"$/g, ""));
  }

  return {
    holders,
    state,
    putState,
    async handleHolders(route: Route) {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (method === "GET") {
        await reply(route, holders.map(withOwner));
        return;
      }
      if (method === "POST") {
        const body = JSON.parse(request.postData() ?? "{}") as Row;
        sequence += 1;
        const row: Row = {
          id: `holder-${sequence}`,
          approved_by: null,
          approved_at: null,
          revoked_at: null,
          wrapped_private_key: null,
          kdf: null,
          profile_id: null,
          ...body,
          created_at: new Date(Date.UTC(2026, 10, 23, 1, sequence)).toISOString(),
        };
        holders.push(row);
        await reply(route, [withOwner(row)]);
        return;
      }
      if (method === "PATCH") {
        const id = readEq(url, "id");
        const patch = JSON.parse(request.postData() ?? "{}") as Row;
        for (const row of holders) if (row.id === id) Object.assign(row, patch);
        await reply(route, []);
        return;
      }
      if (method === "DELETE") {
        const id = readEq(url, "id");
        holders.splice(0, holders.length, ...holders.filter((row) => row.id !== id));
        await reply(route, []);
        return;
      }
      await route.fallback();
    },
    async handleEnvelopes(route: Route) {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (method === "GET") {
        const holderId = readEq(url, "holder_id");
        const keyVersion = readEq(url, "key_version");
        await reply(
          route,
          envelopes.filter(
            (row) => (!holderId || row.holder_id === holderId) && (!keyVersion || String(row.key_version) === keyVersion),
          ),
        );
        return;
      }
      if (method === "POST") {
        const body = JSON.parse(request.postData() ?? "{}") as Row | Row[];
        for (const item of Array.isArray(body) ? body : [body]) {
          const index = envelopes.findIndex(
            (row) => row.holder_id === item.holder_id && row.key_version === item.key_version,
          );
          if (index >= 0) envelopes[index] = item;
          else envelopes.push(item);
        }
        await reply(route, []);
        return;
      }
      if (method === "DELETE") {
        const holderId = readEq(url, "holder_id");
        const below = url.searchParams.get("key_version")?.startsWith("lt.")
          ? Number(url.searchParams.get("key_version")?.slice(3))
          : null;
        envelopes.splice(
          0,
          envelopes.length,
          ...envelopes.filter((row) =>
            below !== null ? Number(row.key_version) >= below : row.holder_id !== holderId,
          ),
        );
        await reply(route, []);
        return;
      }
      await route.fallback();
    },
    async handleTeamLeadState(route: Route) {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET") {
        const key = readEq(url, "key");
        const keys = readIn(url, "key");
        const rows = [...state.entries()]
          .filter(([stateKey]) => (!key || stateKey === key) && (!keys || keys.includes(stateKey)))
          .map(([stateKey, row]) => ({ key: stateKey, ...row }));
        await reply(route, rows);
        return;
      }
      if (request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}") as Row | Row[];
        for (const item of Array.isArray(body) ? body : [body]) putState(String(item.key), item.state);
        await reply(route, []);
        return;
      }
      if (request.method() === "PATCH") {
        const key = readEq(url, "key") ?? "";
        const expected = readEq(url, "updated_at");
        const patch = JSON.parse(request.postData() ?? "{}") as Row;
        const current = state.get(key);
        if (!current || current.updated_at !== expected) {
          await reply(route, []);
          return;
        }
        putState(key, patch.state);
        await reply(route, [{ key }]);
        return;
      }
      await reply(route, []);
    },
  };
}

async function openSecurityPageAsTeamLead(page: Page) {
  const backend = createFakeBackend();
  await page.route("**/rest/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/rest/v1/team_lead_key_holders**", (route) => backend.handleHolders(route));
  await page.route("**/rest/v1/team_lead_key_envelopes**", (route) => backend.handleEnvelopes(route));
  await page.route("**/rest/v1/team_lead_state**", (route) => backend.handleTeamLeadState(route));

  const { supabaseAuthTokenKey, supabaseSession, supabaseCookieValue } = await seedSupabaseAuthCookie(page);
  await page.addInitScript(
    ({ authCacheKey, supabaseAuthTokenKey, supabaseSession, supabaseCookieValue, teamLeadId }) => {
      document.cookie = `${supabaseAuthTokenKey}=${supabaseCookieValue}; path=/; max-age=3600; SameSite=Lax`;
      window.localStorage.setItem(supabaseAuthTokenKey, JSON.stringify(supabaseSession));
      window.localStorage.setItem(
        authCacheKey,
        JSON.stringify({
          id: teamLeadId,
          email: "admin@example.com",
          loginId: "admin",
          username: "총괄팀장",
          role: "team_lead",
          actualRole: "team_lead",
          experienceRole: null,
          approved: true,
          mustChangePassword: false,
          canReview: true,
          actualCanReview: true,
        }),
      );
    },
    {
      authCacheKey: AUTH_CACHE_KEY,
      supabaseAuthTokenKey,
      supabaseSession,
      supabaseCookieValue,
      teamLeadId: TEAM_LEAD_ID,
    },
  );

  await page.goto("/team-lead/security");
  return backend;
}

// 보안 열쇠 화면(main 안쪽)의 요소가 휴대폰 화면 밖으로 나가지 않는지 본다.
// 포털 공통 머리글은 375px에서 원래 2px 넘친다(모든 페이지 공통, 이 화면과 무관)라서 검사 대상에서 뺀다.
async function expectNoHorizontalScroll(page: Page) {
  const offenders = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll("main *")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.right > width + 1 || rect.left < -1))
      .slice(0, 12)
      .map(
        ({ element, rect }) =>
          `${element.tagName}.${String(element.className).slice(0, 60)} left=${Math.round(rect.left)} right=${Math.round(rect.right)} text=${(element.textContent ?? "").trim().slice(0, 30)}`,
      );
  });
  expect(offenders, offenders.join("\n")).toEqual([]);
}

test("휴대폰에서 기기 등록 → 열쇠 만들기 → 복구 코드 확인까지 화면이 넘치지 않는다", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const backend = await openSecurityPageAsTeamLead(page);
  backend.putState("reference_notes_v1", { notes: { "user-1": "야간 선호" } });

  const registerButton = page.getByRole("button", { name: "이 기기 등록" });
  await expect(registerButton).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("1-register.png"), fullPage: true });

  await registerButton.click();
  const setupButton = page.getByRole("button", { name: "보안 열쇠 만들기" });
  await expect(setupButton).toBeVisible();
  expect(backend.holders.some((row) => row.kind === "device" && row.status === "pending")).toBe(true);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("2-setup.png"), fullPage: true });

  await setupButton.click();
  const confirmInput = page.locator("input[maxlength='4']");
  // 열쇠 만들기(RSA 3072 생성 + 복구 코드 PBKDF2)는 테스트용 WebKit에서 몇 초 걸린다.
  await expect(confirmInput).toBeVisible({ timeout: 90_000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("3-recovery-code.png"), fullPage: true });

  const code = (await page.locator("div", { hasText: /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/ }).first().textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  await confirmInput.fill(code.slice(-4));
  await page.getByRole("button", { name: "보관했습니다" }).click();

  await expect(page.getByText("열림", { exact: true })).toBeVisible();
  await expect(page.getByText("등록된 열쇠")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("4-unlocked.png"), fullPage: true });

  const lockButton = page.getByRole("button", { name: "데이터 잠그기" });
  await expect(lockButton).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await lockButton.click();
  await expect(page.getByText("데이터 보호 중입니다.", { exact: false })).toBeVisible({ timeout: 30_000 });
  const stored = backend.state.get("reference_notes_v1")?.state as { enc?: string } | undefined;
  expect(stored?.enc).toBe("tl-e2e-v1");
  expect(JSON.stringify(stored)).not.toContain("야간");
  expect((backend.state.get("crypto_meta_v1")?.state as { enabled?: boolean } | undefined)?.enabled).toBe(true);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("5-locked-data.png"), fullPage: true });

  // 열쇠 새로 고치기: 데이터가 2세대 열쇠로 다시 잠긴다.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "열쇠 새로 고치기" }).click();
  await expect(page.getByText("열쇠를 새로 고쳤습니다.", { exact: false })).toBeVisible({ timeout: 30_000 });
  expect((backend.state.get("reference_notes_v1")?.state as { keyVersion?: number } | undefined)?.keyVersion).toBe(2);
  expect((backend.state.get("crypto_meta_v1")?.state as { currentKeyVersion?: number } | undefined)?.currentKeyVersion).toBe(2);
  await page.getByText("총괄팀장이 바뀔 때 순서").click();
  await expect(page.getByText("열쇠 새로 고치기를 누릅니다", { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("5b-rotated.png"), fullPage: true });
});

test("카카오톡 인앱 브라우저로 열면 다른 브라우저로 열라는 경고가 보인다", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36;KAKAOTALK 2410530",
  });
  const page = await context.newPage();
  await openSecurityPageAsTeamLead(page);

  await expect(page.getByRole("alert").filter({ hasText: "카카오톡 안의 브라우저" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("6-kakao-warning.png"), fullPage: true });
  await context.close();
});
