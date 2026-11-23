import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// 보안 열쇠 화면의 인앱 브라우저 경고 판별을 실제 userAgent 예시로 검사한다.
function loadModule(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const commonJsModule = { exports: {} };
  new Function("exports", "module", "require", code)(commonJsModule.exports, commonJsModule, () => {
    throw new Error("unexpected import");
  });
  return commonJsModule.exports;
}

const { detectTeamLeadInAppBrowser } = loadModule("../lib/team-lead/e2e-browser-check.ts");

const UA = {
  kakaoAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36;KAKAOTALK 2410530",
  kakaoIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.5",
  naverIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.6.3; 15PRO)",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
  iosWebView: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

test("카카오톡·네이버 앱 안에서 열면 앱 이름을 알려 준다", () => {
  assert.equal(detectTeamLeadInAppBrowser(UA.kakaoAndroid), "카카오톡");
  assert.equal(detectTeamLeadInAppBrowser(UA.kakaoIos), "카카오톡");
  assert.equal(detectTeamLeadInAppBrowser(UA.naverIos), "네이버 앱");
});

test("이름을 모르는 앱 내부 브라우저도 잡는다", () => {
  assert.equal(detectTeamLeadInAppBrowser(UA.androidWebView), "앱");
  assert.equal(detectTeamLeadInAppBrowser(UA.iosWebView), "앱");
});

test("일반 브라우저와 홈 화면에 추가한 포털은 경고하지 않는다", () => {
  for (const key of ["chromeAndroid", "samsungInternet", "safariIos", "chromeIos", "chromeWindows"]) {
    assert.equal(detectTeamLeadInAppBrowser(UA[key]), null, key);
  }
  assert.equal(detectTeamLeadInAppBrowser(UA.iosWebView, { standalone: true }), null);
});
