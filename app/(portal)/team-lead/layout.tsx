import { TeamLeadShell } from "@/components/team-lead/team-lead-shell";

export default function TeamLeadLayout({ children }: { children: React.ReactNode }) {
  return <TeamLeadShell>{children}</TeamLeadShell>;
}
