import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["offline/**/*.spec.ts", "temporary-password-mail.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3107",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "offline-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "offline-mobile", testMatch: "offline/**/*.spec.ts", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "node scripts/tests/offline-next.mjs",
    url: "http://127.0.0.1:3107/login",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
