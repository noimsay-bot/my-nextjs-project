import "./globals.css";
import type { Metadata, Viewport } from "next";
import { AuthGate } from "@/components/auth/auth-gate";
import { PortalShell } from "@/components/portal-shell";

export const metadata: Metadata = {
  title: "JTBC 영상취재팀 포털",
  description: "근무표와 베스트리포트 평가 운영용 포털",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 0.65,
  maximumScale: 3,
  userScalable: true,
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
