import "./globals.css";
import type { Metadata } from "next";
import { AuthGate } from "@/components/auth/auth-gate";
import { PortalShell } from "@/components/portal-shell";

export const metadata: Metadata = {
  title: "J특공대 포털",
  description: "근무표와 영상평가 운영용 포털",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <AuthGate>
          <PortalShell>{children}</PortalShell>
        </AuthGate>
      </body>
    </html>
  );
}
