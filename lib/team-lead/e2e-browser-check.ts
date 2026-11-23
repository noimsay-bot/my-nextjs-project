"use client";

// 기기 열쇠가 금방 사라질 수 있는 브라우저 환경(메신저 인앱 브라우저, 시크릿 창)을 알아본다.
// 판별은 보조 안내용일 뿐이며, 결과와 관계없이 등록·사용은 막지 않는다.

const IN_APP_BROWSER_PATTERNS: Array<[RegExp, string]> = [
  [/KAKAOTALK/i, "카카오톡"],
  [/NAVER\(inapp/i, "네이버 앱"],
  [/DaumApps/i, "다음 앱"],
  [/\bLine\//i, "라인"],
  [/Instagram/i, "인스타그램"],
  [/FBAN|FBAV|FB_IAB/i, "페이스북"],
  [/everytimeApp/i, "에브리타임"],
  [/BAND\//i, "밴드"],
];

/**
 * userAgent로 메신저·SNS 앱 안에서 열린 브라우저인지 판별한다. 앱 이름(모르면 "앱")을 돌려주고, 일반 브라우저면 null.
 * iPhone 홈 화면에 추가한 포털(standalone)은 일반 사용으로 본다.
 */
export function detectTeamLeadInAppBrowser(userAgent: string, options: { standalone?: boolean } = {}): string | null {
  for (const [pattern, name] of IN_APP_BROWSER_PATTERNS) {
    if (pattern.test(userAgent)) return name;
  }
  // 안드로이드 WebView는 "; wv)" 표시를 붙인다.
  if (/Android/.test(userAgent) && /; wv\)/.test(userAgent)) return "앱";
  // iOS 앱 내부 WebView는 Safari 표시가 없다. (크롬·엣지·웨일 iOS 앱은 Safari 표시가 있다.)
  if (/iPhone|iPad|iPod/.test(userAgent) && /AppleWebKit/.test(userAgent) && !/Safari\//.test(userAgent)) {
    return options.standalone ? null : "앱";
  }
  return null;
}

type NavigatorWithExtras = Navigator & {
  standalone?: boolean;
  storage?: StorageManager & { getDirectory?: () => Promise<unknown> };
};

type PerformanceWithMemory = Performance & { memory?: { jsHeapSizeLimit?: number } };

/** 시크릿(개인정보 보호) 창일 가능성. 확실하지 않으면 false. */
async function looksLikePrivateWindow(nav: NavigatorWithExtras, userAgent: string) {
  try {
    const isFirefox = /Firefox\//.test(userAgent);
    const isSafari = /Safari\//.test(userAgent) && !/Chrome\/|CriOS\/|FxiOS\/|EdgiOS\/|Edg\//.test(userAgent);

    if (isFirefox) {
      // 파이어폭스 사생활 보호 창에서는 서비스 워커를 쓸 수 없다.
      return !("serviceWorker" in nav);
    }

    if (isSafari) {
      if (typeof nav.storage?.getDirectory !== "function") return false;
      try {
        await nav.storage.getDirectory();
        return false;
      } catch (error) {
        // 사파리 개인정보 보호 창은 파일 저장소 열기를 거부한다.
        return error instanceof Error && /unknown/i.test(error.name + error.message);
      }
    }

    if (/Chrome\//.test(userAgent) && typeof nav.storage?.estimate === "function") {
      // 크롬 계열 시크릿 창은 저장 한도가 메모리 크기 수준으로 작다. 일반 창은 디스크 크기 기준이다.
      const { quota } = await nav.storage.estimate();
      const heapLimit = (performance as PerformanceWithMemory).memory?.jsHeapSizeLimit ?? 1024 ** 3;
      return typeof quota === "number" && quota > 0 && quota < heapLimit * 2;
    }
  } catch {
    return false;
  }
  return false;
}

export interface TeamLeadKeyStorageRisks {
  /** 인앱 브라우저 앱 이름. 일반 브라우저면 null. */
  inAppBrowser: string | null;
  /** 시크릿 창으로 보이는지(추정). */
  maybePrivateWindow: boolean;
}

export async function detectTeamLeadKeyStorageRisks(): Promise<TeamLeadKeyStorageRisks> {
  if (typeof navigator === "undefined") return { inAppBrowser: null, maybePrivateWindow: false };
  const nav = navigator as NavigatorWithExtras;
  const userAgent = nav.userAgent ?? "";
  const standalone =
    nav.standalone === true ||
    (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  return {
    inAppBrowser: detectTeamLeadInAppBrowser(userAgent, { standalone }),
    maybePrivateWindow: await looksLikePrivateWindow(nav, userAgent),
  };
}
