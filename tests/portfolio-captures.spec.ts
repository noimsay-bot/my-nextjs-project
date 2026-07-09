import fs from "node:fs/promises";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import {
  portfolioCaptureOutputDir,
  portfolioCaptureTargets,
  portfolioMaskSelectors,
  type PortfolioCaptureTarget,
} from "@/portfolio-capture.config";
import { AUTH_CACHE_KEY, seedSupabaseAuthCookie } from "./e2e-auth";

const MASK_ROOT_ID = "__portfolio-mask-root__";
const STORAGE_STATE_PATH = process.env.PORTFOLIO_STORAGE_STATE_PATH;

async function ensureOutputArtifacts() {
  const outputDir = path.join(process.cwd(), portfolioCaptureOutputDir);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "captured-selectors.txt"), `${portfolioMaskSelectors.join("\n")}\n`, "utf8");
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "capture";
}

async function seedPortfolioAuth(page: Page) {
  const { supabaseAuthTokenKey, supabaseSession, supabaseCookieValue } = await seedSupabaseAuthCookie(page);

  await page.addInitScript(
    ({ authCacheKey, nextSupabaseAuthTokenKey, nextSupabaseSession, nextSupabaseCookieValue }) => {
      document.cookie = `${nextSupabaseAuthTokenKey}=${nextSupabaseCookieValue}; path=/; max-age=3600; SameSite=Lax`;
      window.localStorage.setItem(
        authCacheKey,
        JSON.stringify({
          id: "admin-seed",
          email: "admin@example.com",
          loginId: "admin",
          username: "관리자",
          role: "admin",
          actualRole: "admin",
          experienceRole: null,
          approved: true,
          mustChangePassword: false,
          canReview: true,
          actualCanReview: true,
        }),
      );
      window.localStorage.setItem(nextSupabaseAuthTokenKey, JSON.stringify(nextSupabaseSession));
    },
    {
      authCacheKey: AUTH_CACHE_KEY,
      nextSupabaseAuthTokenKey: supabaseAuthTokenKey,
      nextSupabaseSession: supabaseSession,
      nextSupabaseCookieValue: supabaseCookieValue,
    },
  );
}

async function waitForPortfolioPage(page: Page, target: PortfolioCaptureTarget) {
  await page.goto(target.path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  if (target.waitFor) {
    await page.waitForSelector(target.waitFor, { state: "visible", timeout: 15_000 });
  }
}

async function applyPortfolioMasks(page: Page, selectors: string[]) {
  await page.evaluate(
    ({ maskRootId, nextSelectors }) => {
      document.getElementById(maskRootId)?.remove();

      const root = document.createElement("div");
      root.id = maskRootId;
      root.setAttribute("aria-hidden", "true");

      const doc = document.documentElement;
      const width = Math.max(doc.scrollWidth, doc.clientWidth, window.innerWidth);
      const height = Math.max(doc.scrollHeight, doc.clientHeight, window.innerHeight);

      Object.assign(root.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: "none",
        zIndex: "2147483647",
      });

      for (const selector of nextSelectors) {
        const matches = document.querySelectorAll<HTMLElement>(selector);
        for (const element of matches) {
          const rects = Array.from(element.getClientRects());
          const targetRects = rects.length > 0 ? rects : [element.getBoundingClientRect()];

          for (const rect of targetRects) {
            if (rect.width < 1 || rect.height < 1) continue;

            const overlay = document.createElement("div");
            overlay.dataset.portfolioMaskSelector = selector;

            Object.assign(overlay.style, {
              position: "absolute",
              left: `${window.scrollX + rect.left}px`,
              top: `${window.scrollY + rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              borderRadius: "4px",
              background: "rgba(39, 39, 42, 0.94)",
              boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.08) inset",
            });

            root.appendChild(overlay);
          }
        }
      }

      document.body.appendChild(root);
    },
    { maskRootId: MASK_ROOT_ID, nextSelectors: selectors },
  );
}

async function removePortfolioMasks(page: Page) {
  await page.evaluate((maskRootId) => {
    document.getElementById(maskRootId)?.remove();
  }, MASK_ROOT_ID);
}

test.describe("portfolio captures", () => {
  if (STORAGE_STATE_PATH) {
    test.use({ storageState: STORAGE_STATE_PATH });
  }

  test.beforeAll(async () => {
    await ensureOutputArtifacts();
  });

  for (const target of portfolioCaptureTargets) {
    test(`captures ${target.name}`, async ({ page }) => {
      if (!STORAGE_STATE_PATH) {
        await seedPortfolioAuth(page);
      }

      await waitForPortfolioPage(page, target);
      await applyPortfolioMasks(page, portfolioMaskSelectors);

      const outputPath = path.join(process.cwd(), portfolioCaptureOutputDir, `${sanitizeFileName(target.name)}.png`);
      await page.screenshot({ path: outputPath, fullPage: target.fullPage ?? true });

      await removePortfolioMasks(page);
    });
  }
});
