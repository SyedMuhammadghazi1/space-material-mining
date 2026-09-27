import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — in-space materials`, template: `%s · ${APP_NAME}` },
  description: `${APP_NAME}: ${APP_TAGLINE} Planning, operations and procurement for lunar and asteroid materials.`,
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0c1426",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <a
          href="#main"
          className="sr-only z-50 rounded bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
