import {
  isVacationRequestOpen,
  refreshVacationRequestOpenState,
  VACATION_EVENT,
} from "@/lib/vacation/storage";
import {
  isTeamLeadSubmissionAccessOpen,
  refreshTeamLeadSubmissionAccessState,
  TEAM_LEAD_SUBMISSION_ACCESS_EVENT,
} from "@/lib/team-lead/storage";

export interface PortalAccessState {
  submissionAccessOpen: boolean;
  vacationRequestOpen: boolean;
}

type PortalAccessListener = (state: PortalAccessState) => void;

let portalAccessState: PortalAccessState = {
  vacationRequestOpen: isVacationRequestOpen(),
  submissionAccessOpen: isTeamLeadSubmissionAccessOpen(),
};
let portalAccessListenersInitialized = false;
let portalAccessRefreshPromise: Promise<PortalAccessState> | null = null;
let portalAccessLastRefreshedAt = 0;
let portalAccessLastFailureAt = 0;
let portalAccessLoaded = false;
const portalAccessListeners = new Set<PortalAccessListener>();
const PORTAL_ACCESS_REFRESH_TTL_MS = 60_000;
const PORTAL_ACCESS_FAILURE_COOLDOWN_MS = 10_000;

function readPortalAccessState(): PortalAccessState {
  return {
    vacationRequestOpen: isVacationRequestOpen(),
    submissionAccessOpen: isTeamLeadSubmissionAccessOpen(),
  };
}

function emitPortalAccessState() {
  portalAccessListeners.forEach((listener) => listener(portalAccessState));
}

function syncPortalAccessState() {
  const nextState = readPortalAccessState();
  if (
    nextState.vacationRequestOpen === portalAccessState.vacationRequestOpen &&
    nextState.submissionAccessOpen === portalAccessState.submissionAccessOpen
  ) {
    return portalAccessState;
  }

  portalAccessState = nextState;
  emitPortalAccessState();
  return portalAccessState;
}

function initPortalAccessListeners() {
  if (portalAccessListenersInitialized || typeof window === "undefined") return;

  const handleFocus = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    void refreshPortalAccessState();
  };

  window.addEventListener("focus", handleFocus);
  window.addEventListener(VACATION_EVENT, syncPortalAccessState);
  window.addEventListener(TEAM_LEAD_SUBMISSION_ACCESS_EVENT, syncPortalAccessState);

  portalAccessListenersInitialized = true;
}

export function getPortalAccessState() {
  return portalAccessState;
}

function shouldRefreshPortalAccessState() {
  if (portalAccessLastFailureAt && Date.now() - portalAccessLastFailureAt < PORTAL_ACCESS_FAILURE_COOLDOWN_MS) {
    return false;
  }
  if (!portalAccessLoaded) return true;
  return Date.now() - portalAccessLastRefreshedAt >= PORTAL_ACCESS_REFRESH_TTL_MS;
}

export async function refreshPortalAccessState(options?: { force?: boolean }) {
  if (portalAccessRefreshPromise) return portalAccessRefreshPromise;
  if (!options?.force && !shouldRefreshPortalAccessState()) {
    return syncPortalAccessState();
  }

  portalAccessRefreshPromise = Promise.all([
    refreshVacationRequestOpenState(),
    refreshTeamLeadSubmissionAccessState(),
  ])
    .then(() => {
      portalAccessLoaded = true;
      portalAccessLastRefreshedAt = Date.now();
      portalAccessLastFailureAt = 0;
      return syncPortalAccessState();
    })
    .catch((error) => {
      portalAccessLastFailureAt = Date.now();
      console.warn(
        "포털 접근 상태를 새로고침하지 못했습니다.",
        error instanceof Error ? error.message : String(error),
      );
      return syncPortalAccessState();
    })
    .finally(() => {
      portalAccessRefreshPromise = null;
    });

  return portalAccessRefreshPromise;
}

export function subscribeToPortalAccessState(listener: PortalAccessListener) {
  initPortalAccessListeners();
  portalAccessListeners.add(listener);
  listener(portalAccessState);

  if (typeof window !== "undefined" && shouldRefreshPortalAccessState()) {
    void refreshPortalAccessState();
  }

  return () => {
    portalAccessListeners.delete(listener);
  };
}
