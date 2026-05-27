"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppRouteBoundary } from "@/components/app-route-boundary";
import { CustomerSupportDialog } from "@/components/customer-support-dialog";
import { Sidebar, SidebarContent, SidebarFooter, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarProvider, SidebarSeparator, useSidebar } from "@/components/sidebar";
import { ShinyText } from "@/components/effects/ShinyText";
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
import {
  acknowledgeCustomerSupportFeedbackNotification,
  CUSTOMER_SUPPORT_ADMIN_COUNT_EVENT,
  getPortalCustomerSupportSummary,
  type CustomerSupportFeedbackNotification,
} from "@/lib/portal/customer-support";
import { hasSubmittedReviewLock, REVIEW_SUBMISSION_LOCK_EVENT } from "@/lib/portal/data";
import {
  getMemberLevelProgressPercent,
  getMemberLevelSnapshot,
  getNextMemberLevel,
  type MemberLevelSnapshot,
} from "@/lib/portal/member-level";
import { recordPageVisit } from "@/lib/portal/page-visit-analytics";
import { equipmentNavItems } from "@/lib/equipment/types";
import Image from "next/image";

type PortalNavChild = {
  href: string;
  label: string;
  children?: PortalNavChild[];
};

type PortalNavLink = {
  href: string;
  label: string;
  children?: PortalNavChild[];
};

type SidebarNavActionId = "customer-support" | "theme" | "admin-member-view";

type SidebarNavEntry =
  | { kind: "link"; link: PortalNavLink }
  | { kind: "action"; id: SidebarNavActionId; label: string };

const links: PortalNavLink[] = [
  { href: "/", label: "홈" },
  { href: "/election", label: "선거" },
  {
    href: "/me",
    label: "마이페이지",
    children: [
      { href: "/me/work", label: "내 일정" },
      { href: "/me", label: "자동 문구" },
    ],
  },
  { href: "/work-schedule", label: "근무표" },
  { href: "/restaurants", label: "내 주변 맛집" },
  { href: "/community", label: "커뮤니티" },
  { href: "/vacation", label: "휴가 신청" },
  { href: "/submissions", label: "베스트리포트 제출" },
  { href: "/partner/schedule", label: "일정" },
  { href: "/weather", label: "날씨" },
  {
    href: "/equipment",
    label: "TVU/장비",
    children: equipmentNavItems.map((item) => ({ href: item.href, label: item.label })),
  },
  {
    href: "/schedule",
    label: "DESK",
    children: [
      { href: "/schedule/schedule-assignment", label: "일정배정" },
      {
        href: "/schedule/write",
        label: "근무 관리",
        children: [
          { href: "/schedule/vacations", label: "휴가 관리" },
          { href: "/schedule/long-service-leave", label: "근속휴가" },
          { href: "/schedule/health-checks", label: "검진" },
          { href: "/schedule/press-support", label: "출입처 지원" },
        ],
      },
      { href: "/schedule/final-cut", label: "정제본" },
      { href: "/schedule/domestic-trip", label: "국내출장" },
      { href: "/schedule/international-trip", label: "해외출장" },
    ],
  },
  { href: "/review", label: "베스트리포트 평가" },
  {
    href: "/team-lead",
    label: "총괄팀장",
    children: [
      { href: "/team-lead/special-report", label: "영상평가 결과" },
      { href: "/team-lead/contribution", label: "팀 기여도" },
      { href: "/team-lead/broadcast-accident", label: "장비/인적 사고" },
      { href: "/team-lead/live-safety", label: "라이브 무사고" },
      { href: "/team-lead/overall-score", label: "개인별 점수" },
      { href: "/team-lead/overall-score-summary", label: "종합점수" },
      { href: "/team-lead/reviewer-management", label: "평가자 관리" },
      { href: "/team-lead/reference-notes", label: "참고사항" },
    ],
  },
  { href: "/admin", label: "관리자" },
];

const SIDEBAR_ICON_BY_HREF: Partial<Record<string, string>> = {
  "/equipment": "/images/sidebar-icons/tvu-equipment.webp",
  "/election": "/images/sidebar-icons/election.webp",
  "/admin": "/images/sidebar-icons/admin.webp",
  "/work-schedule": "/images/sidebar-icons/work-schedule.webp",
  "/restaurants": "/images/sidebar-icons/restaurants.webp",
  "/schedule": "/images/sidebar-icons/desk.webp",
  "/me": "/images/sidebar-icons/my-page.webp",
  "/submissions": "/images/sidebar-icons/best-report-submit.webp",
  "/review": "/images/sidebar-icons/best-report-review.webp",
  "/community": "/images/sidebar-icons/community.webp",
  "/vacation": "/images/sidebar-icons/vacation.webp",
  "/team-lead": "/images/sidebar-icons/team-lead.webp",
};

const SIDEBAR_ACTION_ICON_BY_ID: Record<SidebarNavActionId, string> = {
  "admin-member-view": "/images/sidebar-icons/my-page.webp",
  "customer-support": "/images/sidebar-icons/customer-support.webp",
  theme: "/images/sidebar-icons/theme-mode.webp",
};

const SIDEBAR_NAV_ORDER: Array<{ kind: "link"; href: string } | { kind: "action"; id: SidebarNavActionId }> = [
  { kind: "link", href: "/election" },
  { kind: "link", href: "/me" },
  { kind: "link", href: "/work-schedule" },
  { kind: "link", href: "/equipment" },
  { kind: "link", href: "/vacation" },
  { kind: "link", href: "/submissions" },
  { kind: "link", href: "/review" },
  { kind: "link", href: "/restaurants" },
  { kind: "link", href: "/community" },
  { kind: "link", href: "/schedule" },
  { kind: "link", href: "/team-lead" },
  { kind: "action", id: "customer-support" },
  { kind: "action", id: "admin-member-view" },
  { kind: "link", href: "/weather" },
  { kind: "link", href: "/admin" },
];

function withVisibleChildren(link: PortalNavLink, childHrefs: string[]) {
  if (!link.children) return link;
  return {
    ...link,
    children: link.children.filter((child) => childHrefs.includes(child.href)),
  };
}

function withVisibleLeafChildren(link: PortalNavLink, childHrefs: string[]) {
  if (!link.children) return link;
  return {
    ...link,
    children: link.children
      .filter((child) => childHrefs.includes(child.href))
      .map((child) => ({ href: child.href, label: child.label })),
  };
}

function hasEquipmentStatusAccessRole(role: UserRole | null | undefined) {
  return role === "desk" || role === "team_lead" || role === "admin";
}

function canViewEquipmentStatusLink(session: SessionUser | null) {
  return Boolean(
    session?.approved &&
    (hasEquipmentStatusAccessRole(session.role) || hasEquipmentStatusAccessRole(session.actualRole)),
  );
}

function withVisibleEquipmentChildren(link: PortalNavLink, session: SessionUser | null) {
  if (!link.children) return link;
  const canViewStatus = canViewEquipmentStatusLink(session);
  return {
    ...link,
    children: link.children.filter((child) => child.href !== "/equipment/status" || canViewStatus),
  };
}

function hasElectionManagerRole(role: UserRole | null | undefined) {
  return role === "desk" || role === "team_lead" || role === "admin";
}

function canViewElectionLink(session: SessionUser | null, electionSidebarOpen: boolean) {
  return Boolean(
    session?.approved &&
    (electionSidebarOpen || hasElectionManagerRole(session.actualRole)),
  );
}

type PortalTheme = "dark" | "light" | "pink" | "green";

const PORTAL_THEME_STORAGE_KEY = "jtbc-portal-theme";
const MOBILE_SIDEBAR_TRIGGER_STORAGE_KEY = "jtbc-mobile-sidebar-trigger-top";
const PORTAL_THEMES: PortalTheme[] = ["light", "dark", "pink", "green"];
const ROLE_EXPERIENCE_OPTIONS: UserRole[] = ["member", "outlet", "reviewer", "observer", "partner", "desk", "team_lead", "admin"];
const ROLE_EXPERIENCE_LABELS: Record<UserRole, string> = {
  member: "팀원",
  outlet: "출입처",
  reviewer: "평가자",
  observer: "Observer",
  partner: "파트너",
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
const PORTAL_BACKGROUND_POLL_INTERVAL_MS = 120_000;
const PORTAL_FOCUS_REFRESH_COOLDOWN_MS = 60_000;

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
  electionSidebarOpen: boolean,
) {
  const visibleRoleLinks = links
    .filter((link) => link.href !== "/election" || canViewElectionLink(session, electionSidebarOpen))
    .map((link) => (
      link.href === "/equipment" ? withVisibleEquipmentChildren(link, session) : link
    ));

  switch (session?.role) {
    case "member":
      return visibleRoleLinks.filter(
        (link) =>
          link.href === "/me" ||
          link.href === "/election" ||
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          link.href === "/equipment" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          (link.href === "/review" && session.canReview && !reviewLocked && !isReadOnlyPortalRole(session.role)),
      );
    case "outlet":
      return visibleRoleLinks.filter(
        (link) =>
          link.href === "/me" ||
          link.href === "/election" ||
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          link.href === "/equipment" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          (link.href === "/review" && session.canReview && !reviewLocked && !isReadOnlyPortalRole(session.role)),
      );
    case "observer":
      return visibleRoleLinks.filter(
        (link) =>
          link.href === "/election" ||
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          link.href === "/equipment" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          (link.href === "/review" && session.canReview && !reviewLocked && !isReadOnlyPortalRole(session.role)),
      );
    case "partner":
      return visibleRoleLinks.filter(
        (link) =>
          link.href === "/" ||
          link.href === "/me" ||
          link.href === "/election" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          link.href === "/equipment" ||
          link.href === "/partner/schedule",
      );
    case "reviewer":
      return visibleRoleLinks.filter(
        (link) =>
          link.href === "/election" ||
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          link.href === "/equipment" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          (link.href === "/review" && session.canReview && !reviewLocked),
      );
    case "desk":
      return visibleRoleLinks.filter(
        (link) =>
          link.href === "/me" ||
          link.href === "/election" ||
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          link.href === "/equipment" ||
          link.href === "/schedule" ||
          (link.href === "/review" && session.canReview),
      );
    case "team_lead":
      return visibleRoleLinks.filter(
        (link) =>
          link.href === "/me" ||
          link.href === "/election" ||
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          (link.href === "/review" && session.canReview && !reviewLocked) ||
          link.href === "/equipment" ||
          link.href === "/schedule" ||
          link.href === "/team-lead" ||
          link.href === "/admin",
      );
    case "admin":
      return visibleRoleLinks
        .filter((link) =>
          link.href === "/community" ||
          link.href === "/election" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          link.href === "/me" ||
          link.href === "/equipment" ||
          (link.href === "/vacation" && vacationRequestOpen) ||
          (link.href === "/submissions" && submissionAccessOpen) ||
          link.href === "/schedule" ||
          (link.href === "/review" && session.canReview && !reviewLocked) ||
          link.href === "/weather" ||
          link.href === "/admin",
        )
        .map((link) => (link.href === "/schedule" ? withVisibleLeafChildren(link, ["/schedule/write"]) : link));
    default:
      return visibleRoleLinks.filter(
        (link) =>
          link.href === "/election" ||
          link.href === "/community" ||
          link.href === "/work-schedule" ||
          link.href === "/restaurants" ||
          link.href === "/equipment" ||
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
    (href === "/me" && pathname.startsWith("/me")) ||
    (href === "/election" && pathname.startsWith("/election")) ||
    (href === "/partner/schedule" && pathname.startsWith("/partner")) ||
    (href === "/equipment" && pathname.startsWith("/equipment")) ||
    (href === "/schedule" && pathname.startsWith("/schedule")) ||
    (href === "/team-lead" && pathname.startsWith("/team-lead")) ||
    (href === "/weather" && pathname.startsWith("/weather")) ||
    (href === "/admin" && pathname.startsWith("/admin"))
  );
}

function isChildLinkActive(pathname: string, child: PortalNavChild): boolean {
  return pathname === child.href || Boolean(child.children?.some((nestedChild) => isChildLinkActive(pathname, nestedChild)));
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

function formatCustomerSupportFeedbackDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR");
}

function CustomerSupportFeedbackPopup({
  notification,
  onConfirm,
}: {
  notification: CustomerSupportFeedbackNotification;
  onConfirm: () => void;
}) {
  return (
    <div className="customer-support-feedback-backdrop" role="presentation">
      <section
        className="customer-support-feedback-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-support-feedback-title"
      >
        <div className="customer-support-feedback-popup__header">
          <span className="customer-support-status customer-support-status--processed">처리완료</span>
          <h2 id="customer-support-feedback-title">고객센터 문의가 처리되었습니다</h2>
          {notification.processedAt ? (
            <span className="muted">{formatCustomerSupportFeedbackDate(notification.processedAt)}</span>
          ) : null}
        </div>
        <div className="customer-support-feedback-popup__body">
          <div>
            <strong>문의 내용</strong>
            <p>{notification.body}</p>
          </div>
          <div>
            <strong>관리자 피드백</strong>
            <p>{notification.processedFeedback || "관리자가 문의를 처리완료했습니다."}</p>
          </div>
        </div>
        <div className="customer-support-feedback-popup__footer">
          <button type="button" className="btn primary" onClick={onConfirm}>
            확인
          </button>
        </div>
      </section>
    </div>
  );
}

function SidebarItemIcon({ src, label }: { src?: string; label: string }) {
  return (
    <span className="portal-sidebar-link__icon" aria-hidden="true">
      {src ? (
        <Image src={src} alt="" width={34} height={34} sizes="34px" unoptimized />
      ) : (
        <span className="portal-sidebar-link__fallback-icon">{label.slice(0, 1)}</span>
      )}
    </span>
  );
}

function PortalSidebar({
  pathname,
  session,
  memberLevel,
  theme,
  visibleLinks,
  experienceDraftRole,
  adminSession,
  adminCustomerSupportOpenCount,
  canOpenAdminArea,
  canUseAdminMemberView,
  onCycleTheme,
  onOpenCustomerSupport,
  onToggleAdminMemberView,
  onCycleExperienceRole,
  onConfirmRoleExperience,
  desktopSidebarPinned,
  onDesktopSidebarPinnedChange,
  mobileTriggerProps,
}: {
  pathname: string;
  session: SessionUser | null;
  memberLevel: MemberLevelSnapshot | null;
  theme: PortalTheme;
  visibleLinks: typeof links;
  experienceDraftRole: UserRole;
  adminSession: SessionUser | null;
  adminCustomerSupportOpenCount: number;
  canOpenAdminArea: boolean;
  canUseAdminMemberView: boolean;
  onCycleTheme: () => void;
  onOpenCustomerSupport: () => void;
  onToggleAdminMemberView: () => void;
  onCycleExperienceRole: () => void;
  onConfirmRoleExperience: () => void;
  desktopSidebarPinned: boolean;
  onDesktopSidebarPinnedChange: (pinned: boolean) => void;
  mobileTriggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const { closeMobileSidebar, isMobile, openMobile, setOpen } = useSidebar();
  const shouldShowLogoutButton = Boolean(session);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});
  const [mobileSubmenuTop, setMobileSubmenuTop] = useState<number | null>(null);
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const submenuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const expandedMenuHref = Object.keys(expandedMenus).find((href) => expandedMenus[href]) ?? null;
  const sidebarEntries = useMemo<SidebarNavEntry[]>(() => {
    const linkByHref = new Map(visibleLinks.map((link) => [link.href, link] as const));
    const usedHrefs = new Set<string>();
    const entries: SidebarNavEntry[] = [];
    const appendRemainingLinks = () => {
      visibleLinks.forEach((link) => {
        if (usedHrefs.has(link.href)) return;
        usedHrefs.add(link.href);
        entries.push({ kind: "link", link });
      });
    };

    SIDEBAR_NAV_ORDER.forEach((item) => {
      if (item.kind === "action") {
        if (item.id === "admin-member-view" && !canUseAdminMemberView) return;
        entries.push({
          kind: "action",
          id: item.id,
          label:
            item.id === "customer-support"
              ? "고객센터"
              : item.id === "admin-member-view" && session?.experienceRole === "member"
                ? "관리자보기"
                : item.id === "admin-member-view"
                  ? "팀원보기"
                  : "모드변경",
        });
        return;
      }

      const link = linkByHref.get(item.href);
      if (!link) return;
      usedHrefs.add(link.href);
      entries.push({ kind: "link", link });
    });

    appendRemainingLinks();

    return entries;
  }, [canUseAdminMemberView, session?.experienceRole, visibleLinks]);

  useEffect(() => {
    if (!openMobile) {
      setExpandedMenus({});
      setMobileSubmenuTop(null);
    }
  }, [openMobile]);

  useEffect(() => {
    if (isMobile || !desktopSidebarPinned || typeof document === "undefined") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".portal-sidebar")) return;

      setExpandedMenus({});
      setMobileSubmenuTop(null);
      onDesktopSidebarPinnedChange(false);
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [desktopSidebarPinned, isMobile, onDesktopSidebarPinnedChange, setOpen]);

  useEffect(() => {
    if (!expandedMenuHref || typeof window === "undefined") {
      setMobileSubmenuTop(null);
      return;
    }

    let animationFrame = 0;
    const viewportGap = isMobile ? 10 : 12;
    const syncSubmenuPosition = () => {
      const buttonElement = menuButtonRefs.current[expandedMenuHref];
      const submenuElement = submenuRefs.current[expandedMenuHref];
      if (!buttonElement || !submenuElement) return;

      const buttonRect = buttonElement.getBoundingClientRect();
      const submenuRect = submenuElement.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const visibleSubmenuHeight = Math.min(submenuRect.height, viewportHeight - viewportGap * 2);
      const preferredTop = isMobile ? buttonRect.bottom + 6 : buttonRect.top;
      const maxTop = viewportHeight - visibleSubmenuHeight - viewportGap;
      setMobileSubmenuTop(Math.round(Math.max(viewportGap, Math.min(preferredTop, maxTop))));
    };
    const scheduleSync = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(syncSubmenuPosition);
    };

    scheduleSync();
    const menuScrollElement = menuButtonRefs.current[expandedMenuHref]?.closest(".portal-sidebar__content");
    window.addEventListener("resize", scheduleSync);
    menuScrollElement?.addEventListener("scroll", scheduleSync, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleSync);

    const submenuElement = submenuRefs.current[expandedMenuHref];
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && submenuElement
        ? new ResizeObserver(scheduleSync)
        : null;
    if (resizeObserver && submenuElement) {
      resizeObserver.observe(submenuElement);
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleSync);
      menuScrollElement?.removeEventListener("scroll", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      resizeObserver?.disconnect();
    };
  }, [expandedMenuHref, isMobile]);

  const handleMenuNavigate = () => {
    setExpandedMenus({});
    onDesktopSidebarPinnedChange(false);
    closeMobileSidebar();
  };

  const handleSubmenuNavigate = () => {
    if (isMobile) {
      handleMenuNavigate();
      return;
    }

    onDesktopSidebarPinnedChange(true);
    setOpen(true);
  };
  const sidebarDensityClassName = sidebarEntries.length >= 10 ? "portal-sidebar--dense" : undefined;

  return (
    <Sidebar
      className={sidebarDensityClassName}
      keepOpenOnMouseLeave={!isMobile && desktopSidebarPinned}
      mobileTriggerProps={mobileTriggerProps}
    >
      <SidebarContent>
        <nav aria-label="주요 메뉴">
          <SidebarMenu>
            {sidebarEntries.map((entry) => {
              if (entry.kind === "action") {
                const iconSrc = SIDEBAR_ACTION_ICON_BY_ID[entry.id];
                const handleActionClick = () => {
                  closeMobileSidebar();
                  if (entry.id === "customer-support") {
                    onOpenCustomerSupport();
                    return;
                  }
                  if (entry.id === "admin-member-view") {
                    onToggleAdminMemberView();
                    return;
                  }
                  onCycleTheme();
                };

                return (
                  <SidebarMenuItem key={`action:${entry.id}`}>
                    <button
                      type="button"
                      className="portal-sidebar-link portal-sidebar-link--action"
                      aria-label={entry.label}
                      title={entry.label}
                      onClick={handleActionClick}
                    >
                      <SidebarItemIcon src={iconSrc} label={entry.label} />
                      <span className="portal-sidebar-link__label">{entry.label}</span>
                    </button>
                  </SidebarMenuItem>
                );
              }

              const link = entry.link;
              const active = isLinkActive(pathname, link.href);
              const hasChildren = Boolean(link.children?.length);
              const isExpanded = expandedMenus[link.href] ?? false;
              const iconSrc = SIDEBAR_ICON_BY_HREF[link.href];
              const showAdminCustomerSupportBadge = link.href === "/admin" && adminCustomerSupportOpenCount > 0;

              return (
                <SidebarMenuItem key={link.href} className={hasChildren ? "portal-sidebar__menu-item--has-children" : undefined}>
                  {hasChildren ? (
                    <>
                      <button
                        ref={(node) => {
                          menuButtonRefs.current[link.href] = node;
                        }}
                        type="button"
                        className={`portal-sidebar-link portal-sidebar-link--toggle ${active ? "is-active" : ""}`.trim()}
                        aria-expanded={isExpanded}
                        onClick={() => {
                          setMobileSubmenuTop(null);
                          onDesktopSidebarPinnedChange(!isExpanded && !isMobile);
                          if (!isExpanded && !isMobile) {
                            setOpen(true);
                          }
                          setExpandedMenus(isExpanded ? {} : { [link.href]: true });
                        }}
                      >
                        <SidebarItemIcon src={iconSrc} label={link.label} />
                        <span className="portal-sidebar-link__label">{link.label}</span>
                        {showAdminCustomerSupportBadge ? (
                          <span className="portal-sidebar-link__badge" aria-label={`미처리 고객센터 ${adminCustomerSupportOpenCount}건`}>
                            {adminCustomerSupportOpenCount.toLocaleString("ko-KR")}
                          </span>
                        ) : null}
                        <span className={`portal-sidebar-link__chevron ${isExpanded ? "is-expanded" : ""}`.trim()} aria-hidden="true">
                          ▾
                        </span>
                      </button>
                      {isExpanded ? (
                        <div
                          ref={(node) => {
                            submenuRefs.current[link.href] = node;
                          }}
                          className="portal-sidebar-submenu"
                          style={
                            {
                              "--portal-sidebar-submenu-top": `${mobileSubmenuTop ?? 10}px`,
                              visibility: mobileSubmenuTop === null ? "hidden" : undefined,
                            } as CSSProperties
                          }
                        >
                          {link.children?.map((child) => {
                            const childActive = isChildLinkActive(pathname, child);

                            return (
                              <div key={child.href} className={child.children?.length ? "portal-sidebar-submenu-group" : undefined}>
                                <Link
                                  href={child.href}
                                  className={`portal-sidebar-sublink ${childActive ? "is-active" : ""}`.trim()}
                                  aria-current={pathname === child.href ? "page" : undefined}
                                  onClick={handleSubmenuNavigate}
                                >
                                  <span>{child.label}</span>
                                </Link>
                                {child.children?.length ? (
                                  <div className="portal-sidebar-submenu-children">
                                    {child.children.map((nestedChild) => {
                                      const nestedChildActive = pathname === nestedChild.href;

                                      return (
                                        <Link
                                          key={nestedChild.href}
                                          href={nestedChild.href}
                                          className={`portal-sidebar-sublink portal-sidebar-sublink--nested ${
                                            nestedChildActive ? "is-active" : ""
                                          }`.trim()}
                                          aria-current={nestedChildActive ? "page" : undefined}
                                          onClick={handleSubmenuNavigate}
                                        >
                                          <span>{nestedChild.label}</span>
                                        </Link>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
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
                      <SidebarItemIcon src={iconSrc} label={link.label} />
                      <span className="portal-sidebar-link__label">{link.label}</span>
                      {showAdminCustomerSupportBadge ? (
                        <span className="portal-sidebar-link__badge" aria-label={`미처리 고객센터 ${adminCustomerSupportOpenCount}건`}>
                          {adminCustomerSupportOpenCount.toLocaleString("ko-KR")}
                        </span>
                      ) : null}
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
          <button
            type="button"
            className="btn portal-sidebar-action"
            onClick={() => {
              closeMobileSidebar();
              onCycleTheme();
            }}
          >
            모드변경
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
  const [customerSupportOpen, setCustomerSupportOpen] = useState(false);
  const [customerSupportFeedback, setCustomerSupportFeedback] = useState<CustomerSupportFeedbackNotification | null>(null);
  const [adminCustomerSupportOpenCount, setAdminCustomerSupportOpenCount] = useState(0);
  const [desktopSidebarPinned, setDesktopSidebarPinned] = useState(false);
  const [experienceDraftRole, setExperienceDraftRole] = useState<UserRole>("member");
  const [electionSidebarOpen, setElectionSidebarOpen] = useState(() => getPortalAccessState().electionSidebarOpen);
  const [vacationRequestOpen, setVacationRequestOpen] = useState(() => getPortalAccessState().vacationRequestOpen);
  const [submissionAccessOpen, setSubmissionAccessOpen] = useState(() => getPortalAccessState().submissionAccessOpen);
  const [reviewLocked, setReviewLocked] = useState(false);
  const shouldTrackReviewLock = Boolean(session?.canReview);
  const mobileSidebarTriggerLongPressTimeoutRef = useRef<number | null>(null);
  const mobileSidebarTriggerPointerIdRef = useRef<number | null>(null);
  const mobileSidebarTriggerPointerOffsetRef = useRef(0);
  const shouldSuppressMobileSidebarTriggerClickRef = useRef(false);
  const customerSupportSummaryLastSyncAtRef = useRef(0);
  const customerSupportSummaryPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setSession(getSession());
    setTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    if (!session?.approved) {
      setCustomerSupportFeedback(null);
      setAdminCustomerSupportOpenCount(0);
      return;
    }

    let mounted = true;
    const syncCustomerSupportSummary = (reason: "initial" | "focus" | "poll" | "event" | "visible" = "poll") => {
      if ((reason === "focus" || reason === "poll" || reason === "visible") && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (reason !== "initial" && now - customerSupportSummaryLastSyncAtRef.current < PORTAL_FOCUS_REFRESH_COOLDOWN_MS) return;
      if (customerSupportSummaryPromiseRef.current) return;

      customerSupportSummaryPromiseRef.current = getPortalCustomerSupportSummary().then((summary) => {
        if (!mounted) return;
        customerSupportSummaryLastSyncAtRef.current = Date.now();
        setCustomerSupportFeedback(summary.feedbackNotification);
        setAdminCustomerSupportOpenCount(hasAdminAccess(session.actualRole) ? summary.openCount : 0);
      }).catch(() => {
        customerSupportSummaryLastSyncAtRef.current = Date.now();
      }).finally(() => {
        customerSupportSummaryPromiseRef.current = null;
      });
    };

    const onFocus = () => syncCustomerSupportSummary("focus");
    const onAdminCountEvent = () => syncCustomerSupportSummary("event");
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncCustomerSupportSummary("visible");
    };

    syncCustomerSupportSummary("initial");
    window.addEventListener("focus", onFocus);
    window.addEventListener(CUSTOMER_SUPPORT_ADMIN_COUNT_EVENT, onAdminCountEvent);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const intervalId = window.setInterval(() => syncCustomerSupportSummary("poll"), PORTAL_BACKGROUND_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(CUSTOMER_SUPPORT_ADMIN_COUNT_EVENT, onAdminCountEvent);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [session?.approved, session?.actualRole, session?.id]);

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
      setDesktopSidebarPinned(false);
      setOpenMobile(false);
      return;
    }

    if (desktopSidebarPinned) {
      setOpen(true);
      return;
    }

    setOpen(false);
  }, [desktopSidebarPinned, isMobile, pathname, setOpen, setOpenMobile]);

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
      setElectionSidebarOpen(accessState.electionSidebarOpen);
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
    () => getVisibleLinks(session, vacationRequestOpen, submissionAccessOpen, reviewLocked, electionSidebarOpen),
    [electionSidebarOpen, reviewLocked, session, submissionAccessOpen, vacationRequestOpen],
  );

  const adminSession = hasAdminAccess(session?.actualRole) ? session : null;
  const canOpenAdminArea = hasAdminAccess(session?.role);
  const canUseAdminMemberView = Boolean(session?.approved && session.actualRole === "admin");

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

  const toggleAdminMemberView = () => {
    if (!canUseAdminMemberView) return;
    setRoleExperience(session?.experienceRole === "member" ? null : "member");
    router.refresh();
  };

  const confirmCustomerSupportFeedback = () => {
    const notification = customerSupportFeedback;
    if (!notification) return;
    setCustomerSupportFeedback(null);
    void acknowledgeCustomerSupportFeedbackNotification(notification.id);
  };

  return (
    <div
      className="portal-sidebar-layout"
      style={
        {
          "--portal-sidebar-top-offset": `${sidebarTopOffset}px`,
          "--portal-sidebar-rail-top": `${isMobile ? mobileSidebarTriggerTop : sidebarTriggerTopOffset}px`,
          "--portal-sidebar-width": "232px",
          "--portal-sidebar-collapsed-width": "68px",
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
        adminCustomerSupportOpenCount={adminCustomerSupportOpenCount}
        canOpenAdminArea={canOpenAdminArea}
        canUseAdminMemberView={canUseAdminMemberView}
        onCycleTheme={cycleTheme}
        onOpenCustomerSupport={() => setCustomerSupportOpen(true)}
        onToggleAdminMemberView={toggleAdminMemberView}
        onCycleExperienceRole={cycleExperienceRole}
        onConfirmRoleExperience={confirmRoleExperience}
        desktopSidebarPinned={desktopSidebarPinned}
        onDesktopSidebarPinnedChange={setDesktopSidebarPinned}
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
      <CustomerSupportDialog open={customerSupportOpen} onClose={() => setCustomerSupportOpen(false)} />
      {customerSupportFeedback ? (
        <CustomerSupportFeedbackPopup
          notification={customerSupportFeedback}
          onConfirm={confirmCustomerSupportFeedback}
        />
      ) : null}
      <SidebarInset>
        <div className="shell portal-shell-main">
          <section ref={headerRef} className="panel portal-header-shell">
            <div className="panel-pad" style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Link href="/" className="brand-logo" aria-label="홈으로 이동">
                  <ShinyText
                    className="brand-logo-text"
                    text="JTBC NEWS CAMERA HUB"
                    speed={4.8}
                    delay={0.8}
                    color="var(--brand-shiny-base, var(--brand-text))"
                    shineColor="var(--brand-shine-text, #ffffff)"
                    spread={120}
                    direction="left"
                  />
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

  return (
    <SidebarProvider defaultOpen={false}>
      <PortalChrome pathname={pathname}>{children}</PortalChrome>
    </SidebarProvider>
  );
}
