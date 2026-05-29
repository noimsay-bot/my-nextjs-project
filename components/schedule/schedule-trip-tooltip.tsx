"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ScheduleAssignmentTripTooltip as ScheduleAssignmentTripTooltipData } from "@/lib/team-lead/storage";

function getTravelTypeLabel(value: string) {
  if (value === "국내출장") return "국내출장";
  if (value === "해외출장") return "해외출장";
  if (value === "당일출장") return "당일출장";
  return "";
}

type ScheduleTripTooltipProps = {
  tooltip: ScheduleAssignmentTripTooltipData | null;
  clickEnabled?: boolean;
  children: ReactNode;
};

export function ScheduleTripTooltip({
  tooltip,
  clickEnabled = true,
  children,
}: ScheduleTripTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isOpen]);

  if (!tooltip) {
    return <>{children}</>;
  }

  const travelTypeLabel = getTravelTypeLabel(tooltip.travelType);

  return (
    <div
      ref={rootRef}
      className="schedule-trip-tooltip-anchor"
      data-tooltip-open={isOpen ? "true" : undefined}
      onClickCapture={() => {
        if (!clickEnabled) return;
        setIsOpen((current) => !current);
      }}
      onKeyDownCapture={(event) => {
        if (!clickEnabled) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setIsOpen((current) => !current);
      }}
    >
      {children}
      <span className="schedule-trip-tooltip" role="tooltip">
        <span className="schedule-trip-tooltip__head">
          <strong>{tooltip.tripTagLabel}</strong>
          {travelTypeLabel ? <span>{travelTypeLabel}</span> : null}
        </span>
        <span className="schedule-trip-tooltip__body">
          {tooltip.schedules.length > 0 ? (
            tooltip.schedules.map((schedule, index) => (
              <span key={`${schedule}-${index}`}>{schedule}</span>
            ))
          ) : (
            <span>일정 내용 없음</span>
          )}
        </span>
      </span>
    </div>
  );
}
