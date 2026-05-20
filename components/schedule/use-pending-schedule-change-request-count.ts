"use client";

import { useEffect, useState } from "react";
import {
  CHANGE_REQUESTS_EVENT,
  getPendingScheduleChangeRequests,
  refreshScheduleChangeRequests,
} from "@/lib/schedule/change-requests";
import type { ScheduleChangeRequest } from "@/lib/schedule/types";

const CHANGE_REQUEST_COUNT_STATUSES: ScheduleChangeRequest["status"][] = [
  "pending",
  "accepted",
  "rejected",
  "rolledBack",
];

export function usePendingScheduleChangeRequestCount() {
  const [count, setCount] = useState(() => getPendingScheduleChangeRequests().length);

  useEffect(() => {
    let mounted = true;

    const syncFromCache = () => {
      if (!mounted) return;
      setCount(getPendingScheduleChangeRequests().length);
    };

    const refreshCount = () => {
      void refreshScheduleChangeRequests({ statuses: CHANGE_REQUEST_COUNT_STATUSES })
        .then(() => syncFromCache())
        .catch(() => syncFromCache());
    };

    syncFromCache();
    refreshCount();
    window.addEventListener(CHANGE_REQUESTS_EVENT, syncFromCache);
    window.addEventListener("focus", refreshCount);

    return () => {
      mounted = false;
      window.removeEventListener(CHANGE_REQUESTS_EVENT, syncFromCache);
      window.removeEventListener("focus", refreshCount);
    };
  }, []);

  return count;
}
