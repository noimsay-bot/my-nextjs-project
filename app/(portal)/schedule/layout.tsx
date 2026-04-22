"use client";

import { DeskShell } from "@/components/schedule/desk-shell";

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return <DeskShell>{children}</DeskShell>;
}
