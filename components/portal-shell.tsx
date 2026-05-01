"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppRouteBoundary } from "@/components/app-route-boundary";
import { Sidebar, SidebarContent, SidebarFooter, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarProvider, SidebarSeparator, useSidebar } from "@/components/sidebar";
import { ScrollToTop } from "@/components/home/ScrollToTop";
import {
  getSession,
  hasAdminAccess,
  hasTeamLeadAccess,
  isReadOnlyPortalRole,
  logoutUser,
  setRoleExperience,
  subscribeToAuth,
  type SessionUser,
  type UserRole,
} from "@/lib/auth/storage";
import {
  getPortalAccessState,
  subscribeToPortalAccessState,
} from "@/lib/portal/access-state";
import { hasSubmittedReviewLock, REVIEW_SUBMISSION_LOCK_EVENT } from "@/lib/portal/data";
import {
  getMemberLevelProgressPercent,
  getMemberLevelSnapshot,
  getNextMemberLevel,
  type MemberLevelSnapshot,
} from "@/lib/portal/member-level";
import { recordPageVisit } from "@/lib/portal/page-visit-analytics";

type PortalNavChild = {
  href: string;
  label: string;
};

type PortalNavLink = {
  href: string;
  label: string;
  children?: PortalNavChild[];
};

const links: PortalNavLink[] = [
  { href: "/community", label: "커뮤니티" },
  { href: "/work-schedule", label: "근무표" },
  { href: "/vacation", label: "휴가 신청" },
  { href: "/submissions", label: "베스트리포트 제출" },
  { href: "/restaurants", label: "내 주변 맛집" },
  {
    href: "/schedule",
    label: "DESK",
    children: [
      { href: "/schedule/schedule-assignment", label: "일정배정" },
      { href: "/schedule/vacations", label: "휴가관리" },
      { href: "/schedule/domestic-trip", label: "국내출장" },
      { href: "/schedule/international-trip", label: "해외출장" },
      { href: "/schedule/press-support", label: "출입처지원" },
      { href: "/schedule/health-checks", label: "건강검진" },
      { href: "/schedule/long-service-leave", label: "장기근속휴가" },
      { href: "/schedule/final-cut", label: "정제본" },
      { href: "/schedule/write", label: "근무표관리" },
    ],
  },
  { href: "/review", label: "베스트리포트 평가" },
  {
    href: "/team-lead",
    label: "총괄팀장",
    children: [
      { href: "/team-lead/overall-score", label: "개인별 점수" },
      { href: "/team-lead/overall-score-summary", label: "종합점수" },
      { href: "/team-lead/reviewer-management", label: "평가자 관리" },
      { href: "/team-lead/reference-notes", label: "참고사항" },
      { href: "/team-lead/broadcast-accident", label: "방송사고" },
      { href: "/team-lead/live-safety", label: "LIVE무사고" },
      { href: "/team-lead/contribution", label: "기여도" },
      { href: "/team-lead/final-cut", label: "정제본" },
      { href: "/team-lead/special-report", label: "영상평가관리" },
    ],
  },
  { href: "/admin", label: "관리자" },
];

function withVisibleChildren(link: PortalNavLink, childHrefs: string[]) {
  if (!link.children) return link;
  return {
    ...link,
    children: link.children.filter((child) => childHrefs.includes(child.href)),
  };
}

type PortalTheme = "dark" | "light" | "pink" | "green";

const PORTAL_THEME_STORAGE_KEY = "jtbc-portal-theme";
const MOBILE_SIDEBAR_TRIGGER_STORAGE_KEY = "jtbc-mobile-sidebar-trigger-top";
const PORTAL_THEMES: PortalTheme[] = ["light", "dark", "pink", "green"];
const ROLE_EXPERIENCE_OPTIONS: UserRole[] = ["member", "outlet", "reviewer", "observer", "desk", "team_lead", "admin"];
const ROLE_EXPERIENCE_LABELS: Record<UserRole, string> = {
  member: "팀원",
  outlet: "출입처",
  reviewer: "평가자",
  observer: "Observer",
  desk: "DESK",
  team_lead: "총괄팀장",
  admin: "관리자",
};
const THEME_LABELS: Record<PortalTheme, string> = {
  light: "라이트",
  dark: "다크",
  pink: "핑크",
  green: "그린",
};
const MOBILE_SIDEBAR_TRIGGER_DEFAULT_TOP = 65;
const MOBILE_SIDEBAR_TRIGGER_MIN_TOP = 12;
const MOBILE_SIDEBAR_TRIGGER_HEIGHT = 100;
const MOBILE_SIDEBAR_TRIGGER_BOTTOM_GAP = 12;
const MOBILE_SIDEBAR_TRIGGER_LONG_PRESS_MS = 320;

function readStoredTheme(): PortalTheme {
  if (typeof window === "undefined") return "dark";
  const storedTheme = window.localStorage.getItem(PORTAL_THEME_STORAGE_KEY);
  return PORTAL_THEMES.includes(storedTheme as PortalTheme) ? (storedTheme as PortalTheme) : "dark";
}

function readStoredMobileSidebarTriggerTop() {
  if (typeof window === "undefined") return null;
  const storedTop = Number(window.localStorage.getItem(MOBILE_SIDEBAR_TRIGGER_STORAGE_KEY));
  if (!Number.isFinite(storedTop)) return null;
  return storedTop;
}

function clampMobileSidebarTriggerTop(top: number, viewportHeight: number) {
  const maxTop = Math.max(
    MOBILE_SIDEBAR_TRIGGER_MIN_TOP,
    viewportHeight - MOBILE_SIDEBAR_TRIGGER_HEIGHT - MOBILE_SIDEBAR_TRIGGER_BOTTOM_GAP,
  );
  return Math.min(Math.max(top, MOBILE_SIDEBAR_TRIGGER_MIN_TOP), maxTop);
}

function getVisibleLinks(
  session: SessionUser | null,
  vacationRequestOpen: boolean,
  submissionAccessOpen: boolean,
  reviewLocked: boolean,
) {
  switch (session?.role) {
    case "member":
    case "outlet":
    case "observer":
      return links.filter(
        (link) =>
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          (link.href === "/review" && session.canReview && !reviewLocked && !isReadOnlyPortalRole(session.role)),
      );
    case "reviewer":
      return links.filter(
        (link) =>
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          link.href === "/submissions" ||
          (link.href === "/review" && session.canReview && !reviewLocked),
      );
    case "desk":
      return links.filter(
        (link) =>
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          link.href === "/schedule" ||
          (link.href === "/review" && session.canReview),
      );
    case "team_lead":
      return links.filter(
        (link) =>
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          (link.href === "/review" && session.canReview && !reviewLocked) ||
          link.href === "/schedule" ||
          link.href === "/team-lead" ||
          link.href === "/admin",
      );
    case "admin":
      return links
        .filter((link) =>
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          link.href === "/schedule" ||
          (link.href === "/review" && session.canReview && !reviewLocked) ||
          link.href === "/admin",
        )
        .map((link) => (link.href === "/schedule" ? withVisibleChildren(link, ["/schedule/write"]) : link));
    default:
      return links.filter(
        (link) =>
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen),
      );
  }
}

function isLinkActive(pathname: string, href: string) {
  return (
    pathname === href ||
    (href === "/community" && (pathname.startsWith("/community") || pathname.startsWith("/notices"))) ||
    (href === "/work-schedule" && pathname.startsWith("/work-schedule")) ||
    (href === "/restaurants" && pathname.startsWith("/restaurants")) ||
    (href === "/schedule" && pathname.startsWith("/schedule")) ||
    (href === "/team-lead" && pathname.startsWith("/team-lead")) ||
    (href === "/admin" && pathname.startsWith("/admin"))
  );
}

function formatRoleSummary(session: SessionUser | null, memberLevel: MemberLevelSnapshot | null) {
  if (!session) {
    return "";
  }

  const levelText = memberLevel ? ` Lv ${memberLevel.level}` : "";
  if (!session.experienceRole) {
    return `${ROLE_EXPERIENCE_LABELS[session.role]}${levelText}`;
  }

  return `체험 ${ROLE_EXPERIENCE_LABELS[session.role]}${levelText} · 실권한 ${ROLE_EXPERIENCE_LABELS[session.actualRole]}`;
}

function getLevelProgressStyle(memberLevel: MemberLevelSnapshot | null) {
  const progressPercent = memberLevel ? getMemberLevelProgressPercent(memberLevel.totalPoints) : 0;
  return { "--member-level-progress": `${progressPercent}%` } as CSSProperties;
}

function formatNextLevelLabel(memberLevel: MemberLevelSnapshot | null) {
  const nextLevel = memberLevel ? getNextMemberLevel(memberLevel.totalPoints) : 2;
  return `Lv${nextLevel}`;
}

function PortalSidebar({
  pathname,
  session,
  memberLevel,
  theme,
  visibleLinks,
  experienceDraftRole,
  adminSession,
  canOpenAdminArea,
  onCycleTheme,
  onCycleExperienceRole,
  onConfirmRoleExperience,
  mobileTriggerProps,
}: {
  pathname: string;
  session: SessionUser | null;
  memberLevel: MemberLevelSnapshot | null;
  theme: PortalTheme;
  visibleLinks: typeof links;
  experienceDraftRole: UserRole;
  adminSession: SessionUser | null;
  canOpenAdminArea: boolean;
  onCycleTheme: () => void;
  onCycleExperienceRole: () => void;
  onConfirmRoleExperience: () => void;
  mobileTriggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const { closeMobileSidebar } = useSidebar();
  const shouldShowLogoutButton = Boolean(session);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});

  const handleMenuNavigate = () => {
    setExpandedMenus({});
    closeMobileSidebar();
  };

  return (
    <Sidebar mobileTriggerProps={mobileTriggerProps}>
      <SidebarContent>
        <nav aria-label="주요 메뉴">
          <SidebarMenu>
            {visibleLinks.map((link) => {
              const active = isLinkActive(pathname, link.href);
              const hasChildren = Boolean(link.children?.length);
              const isExpanded = expandedMenus[link.href] ?? false;

              return (
                <SidebarMenuItem key={link.href} className={hasChildren ? "portal-sidebar__menu-item--has-children" : undefined}>
                  {hasChildren ? (
                    <>
                      <button
                        type="button"
                        className={`portal-sidebar-link portal-sidebar-link--toggle ${active ? "is-active" : ""}`.trim()}
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedMenus(isExpanded ? {} : { [link.href]: true })
                        }
                      >
                        <span>{link.label}</span>
                        <span className={`portal-sidebar-link__chevron ${isExpanded ? "is-expanded" : ""}`.trim()} aria-hidden="true">
                          ▾
                        </span>
                      </button>
                      {isExpanded ? (
                        <div className="portal-sidebar-submenu">
                          {link.children?.map((child) => {
                            const childActive = pathname === child.href;

                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={`portal-sidebar-sublink ${childActive ? "is-active" : ""}`.trim()}
                                aria-current={childActive ? "page" : undefined}
                                onClick={handleMenuNavigate}
                              >
                                <span>{child.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <Link
                      href={link.href}
                      className={`portal-sidebar-link ${active ? "is-active" : ""}`.trim()}
                      aria-current={active ? "page" : undefined}
                      onClick={handleMenuNavigate}
                    >
                      <span>{link.label}</span>
                    </Link>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter>
        <div className="portal-sidebar-footer-stack">
          {shouldShowLogoutButton ? (
            <button
              className="btn portal-sidebar-action"
              onClick={async () => {
                closeMobileSidebar();
                await logoutUser();
                window.location.href = "/login";
              }}
            >
              로그아웃
            </button>
          ) : null}
          {adminSession && hasTeamLeadAccess(adminSession.actualRole) ? (
            <>
              <button type="button" className="btn primary portal-sidebar-action" onClick={onConfirmRoleExperience}>
                확인
              </button>
              <button type="button" className="btn portal-sidebar-action" onClick={onCycleExperienceRole}>
                권한 바꾸기: {ROLE_EXPERIENCE_LABELS[experienceDraftRole]}
              </button>
            </>
          ) : null}
          {session ? (
            <div className="portal-sidebar-usercard">
              <strong className="portal-sidebar-usercard__name">{session.username}</strong>
              <span className="muted portal-sidebar-usercard__meta">{formatRoleSummary(session, memberLevel)}</span>
              <div
                className="portal-sidebar-usercard__level-track"
                style={getLevelProgressStyle(memberLevel)}
                aria-label="다음 레벨까지 진행률"
              >
                <span />
              </div>
              <div className="portal-sidebar-usercard__level-next">{formatNextLevelLabel(memberLevel)}</div>
              {!adminSession && canOpenAdminArea ? (
                <span className="muted portal-sidebar-usercard__meta">총괄팀장 권한으로 관리자 메뉴 사용 가능</span>
              ) : null}
            </div>
          ) : null}
          <button type="button" className="btn portal-sidebar-action" onClick={onCycleTheme}>
            <span>모드변경</span>
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function PortalChrome({ children, pathname }: { children: React.ReactNode; pathname: string }) {
  const router = useRouter();
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();
  const headerRef = useRef<HTMLElement | null>(null);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [memberLevel, setMemberLevel] = useState<MemberLevelSnapshot | null>(null);
  const [theme, setTheme] = useState<PortalTheme>("dark");
  const [sidebarTopOffset, setSidebarTopOffset] = useState(0);
  const [sidebarTriggerTopOffset, setSidebarTriggerTopOffset] = useState(12);
  const [mobileSidebarTriggerTop, setMobileSidebarTriggerTop] = useState(MOBILE_SIDEBAR_TRIGGER_DEFAULT_TOP);
  const [isDraggingMobileSidebarTrigger, setIsDraggingMobileSidebarTrigger] = useState(false);
  const [experienceDraftRole, setExperienceDraftRole] = useState<UserRole>("member");
  const [vacationRequestOpen, setVacationRequestOpen] = useState(() => getPortalAccessState().vacationRequestOpen);
  const [submissionAccessOpen, setSubmissionAccessOpen] = useState(() => getPortalAccessState().submissionAccessOpen);
  const [reviewLocked, setReviewLocked] = useState(false);
  const shouldTrackReviewLock = Boolean(session?.canReview);
  const mobileSidebarTriggerLongPressTimeoutRef = useRef<number | null>(null);
  const mobileSidebarTriggerPointerIdRef = useRef<number | null>(null);
  const mobileSidebarTriggerPointerOffsetRef = useRef(0);
  const shouldSuppressMobileSidebarTriggerClickRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setSession(getSession());
    setTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!session?.id) {
      setMemberLevel(null);
      return () => {
        mounted = false;
      };
    }

    void getMemberLevelSnapshot(session.id).then((snapshot) => {
      if (!mounted) return;
      setMemberLevel(snapshot);
    });

    return () => {
      mounted = false;
    };
  }, [pathname, session?.id]);

  useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
      return;
    }

    setOpen(false);
  }, [isMobile, pathname, setOpen, setOpenMobile]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!isMobile) {
      setIsDraggingMobileSidebarTrigger(false);
      return;
    }

    const storedTop = readStoredMobileSidebarTriggerTop();
    setMobileSidebarTriggerTop(clampMobileSidebarTriggerTop(storedTop ?? MOBILE_SIDEBAR_TRIGGER_DEFAULT_TOP, window.innerHeight));
    const syncMobileSidebarTriggerTop = () => {
      setMobileSidebarTriggerTop((current) => clampMobileSidebarTriggerTop(current, window.innerHeight));
    };

    syncMobileSidebarTriggerTop();
    window.addEventListener("resize", syncMobileSidebarTriggerTop);

    return () => {
      window.removeEventListener("resize", syncMobileSidebarTriggerTop);
      if (mobileSidebarTriggerLongPressTimeoutRef.current !== null) {
        window.clearTimeout(mobileSidebarTriggerLongPressTimeoutRef.current);
        mobileSidebarTriggerLongPressTimeoutRef.current = null;
      }
    };
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncSidebarTopOffset = () => {
      const headerElement = headerRef.current;
      if (!headerElement) {
        setSidebarTopOffset(0);
        return;
      }

      const rect = headerElement.getBoundingClientRect();
      const nextOffset = Math.max(0, Math.round(rect.bottom));
      setSidebarTopOffset(nextOffset);
    };

    syncSidebarTopOffset();

    const headerElement = headerRef.current;
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && headerElement
        ? new ResizeObserver(() => syncSidebarTopOffset())
        : null;

    if (resizeObserver && headerElement) {
      resizeObserver.observe(headerElement);
    }
    window.addEventListener("resize", syncSidebarTopOffset);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncSidebarTopOffset);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isMobile) return;

    const isSidebarOpen = isMobile ? openMobile : open;
    const syncSidebarTriggerTopOffset = () => {
      if (!isSidebarOpen) {
        setSidebarTriggerTopOffset(Math.max(12, sidebarTopOffset || 12));
        return;
      }

      const detailElement = document.querySelector<HTMLElement>('[data-portal-news-meta-detail="true"]');
      if (detailElement) {
        const rect = detailElement.getBoundingClientRect();
        setSidebarTriggerTopOffset(Math.max(12, Math.round(rect.top + rect.height / 2 - 23)));
        return;
      }

      setSidebarTriggerTopOffset(Math.max(12, sidebarTopOffset || 12));
    };

    syncSidebarTriggerTopOffset();
    const raf = window.requestAnimationFrame(syncSidebarTriggerTopOffset);
    window.addEventListener("resize", syncSidebarTriggerTopOffset);
    window.addEventListener("scroll", syncSidebarTriggerTopOffset, { passive: true });

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", syncSidebarTriggerTopOffset);
      window.removeEventListener("scroll", syncSidebarTriggerTopOffset);
    };
  }, [isMobile, open, openMobile, sidebarTopOffset]);

  const clearMobileSidebarTriggerLongPressTimeout = () => {
    if (mobileSidebarTriggerLongPressTimeoutRef.current === null) return;
    window.clearTimeout(mobileSidebarTriggerLongPressTimeoutRef.current);
    mobileSidebarTriggerLongPressTimeoutRef.current = null;
  };

  const updateMobileSidebarTriggerTop = (nextTop: number, shouldPersist: boolean) => {
    const clampedTop = clampMobileSidebarTriggerTop(nextTop, window.innerHeight);
    setMobileSidebarTriggerTop(clampedTop);
    if (shouldPersist) {
      window.localStorage.setItem(MOBILE_SIDEBAR_TRIGGER_STORAGE_KEY, String(clampedTop));
    }
  };

  const handleMobileSidebarTriggerPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isMobile) return;
    mobileSidebarTriggerPointerIdRef.current = event.pointerId;
    mobileSidebarTriggerPointerOffsetRef.current = event.clientY - event.currentTarget.getBoundingClientRect().top;
    shouldSuppressMobileSidebarTriggerClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    clearMobileSidebarTriggerLongPressTimeout();
    mobileSidebarTriggerLongPressTimeoutRef.current = window.setTimeout(() => {
      setIsDraggingMobileSidebarTrigger(true);
      shouldSuppressMobileSidebarTriggerClickRef.current = true;
    }, MOBILE_SIDEBAR_TRIGGER_LONG_PRESS_MS);
  };

  const handleMobileSidebarTriggerPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDraggingMobileSidebarTrigger || mobileSidebarTriggerPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateMobileSidebarTriggerTop(event.clientY - mobileSidebarTriggerPointerOffsetRef.current, false);
  };

  const finishMobileSidebarTriggerInteraction = (
    event: React.PointerEvent<HTMLButtonElement>,
    shouldPersistPosition: boolean,
  ) => {
    if (mobileSidebarTriggerPointerIdRef.current !== event.pointerId) return;

    clearMobileSidebarTriggerLongPressTimeout();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (isDraggingMobileSidebarTrigger) {
      updateMobileSidebarTriggerTop(event.clientY - mobileSidebarTriggerPointerOffsetRef.current, shouldPersistPosition);
      shouldSuppressMobileSidebarTriggerClickRef.current = true;
      setIsDraggingMobileSidebarTrigger(false);
    }

    mobileSidebarTriggerPointerIdRef.current = null;
    mobileSidebarTriggerPointerOffsetRef.current = 0;
  };

  useEffect(() => {
    let mounted = true;

    const unsubscribe = subscribeToAuth((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(PORTAL_THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    void recordPageVisit(pathname);
  }, [pathname]);

  useEffect(() => {
    return subscribeToPortalAccessState((accessState) => {
      setVacationRequestOpen(accessState.vacationRequestOpen);
      setSubmissionAccessOpen(accessState.submissionAccessOpen);
    });
  }, []);

  useEffect(() => {
    if (!session?.actualRole) return;
    setExperienceDraftRole(session.experienceRole ?? session.actualRole);
  }, [session?.actualRole, session?.experienceRole]);

  useEffect(() => {
    const syncReviewLocked = () => {
      setReviewLocked(hasSubmittedReviewLock(getSession()?.id));
    };

    if (!shouldTrackReviewLock) {
      setReviewLocked(false);
      return;
    }

    syncReviewLocked();
    window.addEventListener("focus", syncReviewLocked);
    window.addEventListener(REVIEW_SUBMISSION_LOCK_EVENT, syncReviewLocked);
    return () => {
      window.removeEventListener("focus", syncReviewLocked);
      window.removeEventListener(REVIEW_SUBMISSION_LOCK_EVENT, syncReviewLocked);
    };
  }, [shouldTrackReviewLock, session?.id]);

  const visibleLinks = useMemo(
    () => getVisibleLinks(session, vacationRequestOpen, submissionAccessOpen, reviewLocked),
    [reviewLocked, session, submissionAccessOpen, vacationRequestOpen],
  );

  const adminSession = hasAdminAccess(session?.actualRole) ? session : null;
  const canOpenAdminArea = hasAdminAccess(session?.role);

  const cycleTheme = () => {
    setTheme((current) => {
      const currentIndex = PORTAL_THEMES.indexOf(current);
      if (currentIndex < 0) {
        return PORTAL_THEMES[0];
      }

      return PORTAL_THEMES[(currentIndex + 1) % PORTAL_THEMES.length] ?? PORTAL_THEMES[0];
    });
  };

  const cycleExperienceRole = () => {
    setExperienceDraftRole((current) => {
      const currentIndex = ROLE_EXPERIENCE_OPTIONS.indexOf(current);
      if (currentIndex < 0) return ROLE_EXPERIENCE_OPTIONS[0];
      return ROLE_EXPERIENCE_OPTIONS[(currentIndex + 1) % ROLE_EXPERIENCE_OPTIONS.length] ?? ROLE_EXPERIENCE_OPTIONS[0];
    });
  };

  const confirmRoleExperience = () => {
    if (!adminSession || !hasTeamLeadAccess(adminSession.actualRole)) return;

    const nextExperienceRole = experienceDraftRole === adminSession.actualRole ? null : experienceDraftRole;
    const confirmed = window.confirm(
      nextExperienceRole
        ? `${ROLE_EXPERIENCE_LABELS[nextExperienceRole]} 권한으로 전환하시겠습니까?`
        : "관리자 기본 모드로 돌아가시겠습니까?",
    );
    if (!confirmed) return;

    setRoleExperience(nextExperienceRole);
    router.refresh();
  };
  return (
    <div
      className="portal-sidebar-layout"
      style={
        {
          "--portal-sidebar-top-offset": `${sidebarTopOffset}px`,
          "--portal-sidebar-rail-top": `${isMobile ? mobileSidebarTriggerTop : sidebarTriggerTopOffset}px`,
          "--portal-sidebar-width": "232px",
          "--portal-sidebar-mobile-width": "288px",
        } as CSSProperties
      }
    >
      <PortalSidebar
        pathname={pathname}
        session={session}
        memberLevel={memberLevel}
        theme={theme}
        visibleLinks={visibleLinks}
        experienceDraftRole={experienceDraftRole}
        adminSession={adminSession}
        canOpenAdminArea={canOpenAdminArea}
        onCycleTheme={cycleTheme}
        onCycleExperienceRole={cycleExperienceRole}
        onConfirmRoleExperience={confirmRoleExperience}
        mobileTriggerProps={{
          className: isDraggingMobileSidebarTrigger ? "portal-sidebar-trigger--dragging" : undefined,
          onPointerDown: handleMobileSidebarTriggerPointerDown,
          onPointerMove: handleMobileSidebarTriggerPointerMove,
          onPointerUp: (event) => finishMobileSidebarTriggerInteraction(event, true),
          onPointerCancel: (event) => finishMobileSidebarTriggerInteraction(event, false),
          onClick: (event) => {
            if (shouldSuppressMobileSidebarTriggerClickRef.current) {
              shouldSuppressMobileSidebarTriggerClickRef.current = false;
              event.preventDefault();
            }
          },
        }}
      />
      <SidebarInset>
        <div className="shell portal-shell-main">
          <section ref={headerRef} className="panel portal-header-shell">
            <div className="panel-pad" style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Link href="/" className="brand-logo" aria-label="홈으로 이동">
                  <span
                    className="brand-logo-text"
                    style={{
                      fontWeight: 600,
                    }}
                  >
                    JTBC NEWS CAMERA HUB
                  </span>
                </Link>
              </div>
            </div>
          </section>
          <main style={{ marginTop: 20 }}>
            <AppRouteBoundary resetKey={pathname}>{children}</AppRouteBoundary>
          </main>
        </div>
      </SidebarInset>
    </div>
  );
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const normalizedPathname = pathname ? pathname.replace(/\/+$/, "") || "/" : "";
  const shouldShowGlobalScrollTop = normalizedPathname !== "/" && !normalizedPathname.endsWith("/schedule-assignment");

  return (
    <SidebarProvider defaultOpen={false}>
      <PortalChrome pathname={pathname}>{children}</PortalChrome>
      {shouldShowGlobalScrollTop ? <ScrollToTop /> : null}
    </SidebarProvider>
  );
}
