import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ThemeScript } from "@/components/theme/theme-script";

export const metadata: Metadata = {
  title: "JTBC News Camera Hub",
  description: "근무표와 베스트리포트 평가 운영용 포털",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: true,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard/dist/web/static/pretendard.css" />
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
