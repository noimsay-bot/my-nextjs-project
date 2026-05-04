import { AuthGate } from "@/components/auth/auth-gate";
import { CelebrationProvider } from "@/components/events/celebration-provider";
import { PortalShell } from "@/components/portal-shell";

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGate>
      <PortalShell>
        <CelebrationProvider>{children}</CelebrationProvider>
      </PortalShell>
    </AuthGate>
  );
}
