import { AuthGate } from "@/components/auth/auth-gate";
import { PortalShell } from "@/components/portal-shell";

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGate>
      <PortalShell>{children}</PortalShell>
    </AuthGate>
  );
}
