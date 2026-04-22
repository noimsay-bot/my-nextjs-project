import {
  isVacationRequestOpen,
  refreshVacationStore,
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
let portalAccessLoaded = false;
const portalAccessListeners = new Set<PortalAccessListener>();
const PORTAL_ACCESS_REFRESH_TTL_MS = 60_000;

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
  if (!portalAccessLoaded) return true;
  return Date.now() - portalAccessLastRefreshedAt >= PORTAL_ACCESS_REFRESH_TTL_MS;
}

export async function refreshPortalAccessState(options?: { force?: boolean }) {
  if (portalAccessRefreshPromise) return portalAccessRefreshPromise;
  if (!options?.force && !shouldRefreshPortalAccessState()) {
    return syncPortalAccessState();
  }

  portalAccessRefreshPromise = Promise.all([
    refreshVacationStore(),
    refreshTeamLeadSubmissionAccessState(),
  ])
    .then(() => {
      portalAccessLoaded = true;
      portalAccessLastRefreshedAt = Date.now();
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
