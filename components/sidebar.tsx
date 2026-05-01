"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type Dispatch,
  type HTMLAttributes,
  type ReactNode,
  type SetStateAction,
} from "react";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = 232;
const SIDEBAR_WIDTH_MOBILE = 288;
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarContextValue = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  openMobile: boolean;
  setOpenMobile: Dispatch<SetStateAction<boolean>>;
  isMobile: boolean;
  toggleSidebar: () => void;
  closeMobileSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function joinClassNames(...values: Array<string | undefined | false | null>) {
  return values.filter(Boolean).join(" ");
}

function readSidebarCookie() {
  if (typeof document === "undefined") {
    return false;
  }

  const match = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${SIDEBAR_COOKIE_NAME}=`));

  if (!match) {
    return false;
  }

  return match.split("=")[1] !== "false";
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1024px)");
    const sync = () => setIsMobile(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  return isMobile;
}

export function useSidebar() {
  const context = useContext(SidebarContext);

  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider.");
  }

  return context;
}

export function useOptionalSidebar() {
  return useContext(SidebarContext);
}

type SidebarProviderProps = {
  children: ReactNode;
  defaultOpen?: boolean;
};

export function SidebarProvider({
  children,
  defaultOpen = false,
  ..._props
}: SidebarProviderProps) {
  const isMobile = useIsMobile();
  const [open, setOpenState] = useState(defaultOpen);
  const [openMobile, setOpenMobile] = useState(false);

  useEffect(() => {
    setOpenState(readSidebarCookie());
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  }, [open]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    if (openMobile) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [openMobile]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== SIDEBAR_KEYBOARD_SHORTCUT || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      if (isMobile) {
        setOpenMobile((current) => !current);
        return;
      }

      setOpenState((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile]);

  const contextValue = useMemo<SidebarContextValue>(
    () => ({
      open,
      setOpen: setOpenState,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar: () => {
        if (isMobile) {
          setOpenMobile((current) => !current);
          return;
        }

        setOpenState((current) => !current);
      },
      closeMobileSidebar: () => setOpenMobile(false),
    }),
    [isMobile, open, openMobile],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      {children}
    </SidebarContext.Provider>
  );
}

type SidebarProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  mobileTriggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
};

export function Sidebar({ children, className, mobileTriggerProps, ...props }: SidebarProps) {
  const { open, openMobile, closeMobileSidebar, isMobile, setOpen } = useSidebar();
  const { className: mobileTriggerClassName, ...mobileTriggerRest } = mobileTriggerProps ?? {};

  return (
    <>
      <div
        className={joinClassNames("portal-sidebar-backdrop", openMobile && "is-open")}
        aria-hidden={!openMobile}
        onClick={closeMobileSidebar}
      />
      <div
        className={joinClassNames("portal-sidebar", open ? "is-open" : "is-collapsed", className)}
        style={
          {
            "--portal-sidebar-width": `${SIDEBAR_WIDTH}px`,
            "--portal-sidebar-mobile-width": `${SIDEBAR_WIDTH_MOBILE}px`,
          } as CSSProperties
        }
        {...props}
      >
        <div className="portal-sidebar__spacer" aria-hidden="true" />
        {isMobile ? (
          <SidebarTrigger
            className={joinClassNames("portal-sidebar-trigger--rail", mobileTriggerClassName)}
            aria-label={openMobile ? "사이드바 닫기" : "사이드바 열기"}
            {...mobileTriggerRest}
          />
        ) : null}
        <aside
          className={joinClassNames("portal-sidebar__panel", openMobile && "is-open")}
          aria-label="포털 사이드바"
          onMouseEnter={() => {
            if (isMobile) {
              return;
            }

            if (!open) {
              setOpen(true);
            }
          }}
          onMouseLeave={() => {
            if (isMobile || !open) {
              return;
            }

            setOpen(false);
          }}
        >
          <div className="portal-sidebar__inner">{children}</div>
        </aside>
      </div>
    </>
  );
}

type SidebarSectionProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function SidebarHeader({ children, className, ...props }: SidebarSectionProps) {
  return (
    <div className={joinClassNames("portal-sidebar__header", className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarContent({ children, className, ...props }: SidebarSectionProps) {
  return (
    <div className={joinClassNames("portal-sidebar__content", className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarFooter({ children, className, ...props }: SidebarSectionProps) {
  return (
    <div className={joinClassNames("portal-sidebar__footer", className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarSeparator({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={joinClassNames("portal-sidebar__separator", className)} {...props} />;
}

type SidebarMenuProps = HTMLAttributes<HTMLUListElement> & {
  children: ReactNode;
};

export function SidebarMenu({ children, className, ...props }: SidebarMenuProps) {
  return (
    <ul className={joinClassNames("portal-sidebar__menu", className)} {...props}>
      {children}
    </ul>
  );
}

type SidebarMenuItemProps = HTMLAttributes<HTMLLIElement> & {
  children: ReactNode;
};

export function SidebarMenuItem({ children, className, ...props }: SidebarMenuItemProps) {
  return (
    <li className={joinClassNames("portal-sidebar__menu-item", className)} {...props}>
      {children}
    </li>
  );
}

type SidebarInsetProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function SidebarInset({ children, className, ...props }: SidebarInsetProps) {
  return (
    <div className={joinClassNames("portal-sidebar__inset", className)} {...props}>
      {children}
    </div>
  );
}

type SidebarTriggerProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function SidebarTrigger({ className, onClick, type = "button", ...props }: SidebarTriggerProps) {
  const { toggleSidebar, isMobile } = useSidebar();

  return (
    <button
      type={type}
      className={joinClassNames("btn portal-sidebar-trigger", className)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        toggleSidebar();
      }}
      {...props}
    >
      {isMobile ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      )}
      <span className="sr-only">사이드바 열기</span>
    </button>
  );
}
