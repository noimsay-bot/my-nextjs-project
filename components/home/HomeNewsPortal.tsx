"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HomeNewsSection } from "@/components/home/HomeNewsSection";
import { HomeNewsDataset } from "@/components/home/home-news.types";
import { emptyHomeNewsDataset } from "@/lib/home-news/fallback";
import { fetchHomeNewsDataset } from "@/lib/home-news/queries";

const HOST_SELECTOR = '[data-home-news-slot="true"]';

function ensurePortalHost() {
  const panel = document.querySelector<HTMLElement>(".schedule-published-panel > .panel-pad");
  const hero = panel?.querySelector<HTMLElement>(".schedule-published-hero");
  if (!panel || !hero) return null;

  const duplicatedHosts = panel.querySelectorAll<HTMLElement>(HOST_SELECTOR);
  if (duplicatedHosts.length > 1) {
    duplicatedHosts.forEach((node, index) => {
      if (index > 0) node.remove();
    });
  }

  let host = panel.querySelector<HTMLElement>(HOST_SELECTOR);
  if (!host) {
    host = document.createElement("div");
    host.dataset.homeNewsSlot = "true";
    host.dataset.homeNewsOwner = "HomeNewsPortal";
    host.style.width = "100%";
    host.style.margin = "0";
    host.style.padding = "0";
  }

  if (hero.nextSibling !== host) {
    hero.insertAdjacentElement("afterend", host);
  }

  return host;
}

export function HomeNewsPortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<HomeNewsDataset>(emptyHomeNewsDataset);
  const [loading, setLoading] = useState(true);
  const hostRef = useRef<HTMLElement | null>(null);
  const section = useMemo(() => <HomeNewsSection data={data} loading={loading} />, [data, loading]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    let frameId = 0;
    let observer: MutationObserver | null = null;
    let cancelled = false;

    const syncHost = () => {
      const nextHost = ensurePortalHost();
      hostRef.current = nextHost;
      setHost((current) => (current === nextHost ? current : nextHost));
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncHost);
    };

    void (async () => {
      setLoading(true);
      const result = await fetchHomeNewsDataset();
      if (cancelled) return;
      setData(result.data);
      setLoading(false);
      if (result.errorMessage) {
        console.warn(result.errorMessage);
      }
    })();

    syncHost();
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      const currentHost = hostRef.current;
      if (currentHost?.dataset.homeNewsOwner === "HomeNewsPortal") {
        currentHost.remove();
      }
    };
  }, []);

  if (!host) return null;
  return createPortal(section, host);
}
