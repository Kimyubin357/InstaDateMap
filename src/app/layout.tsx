import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./fabric-theme.css";
import BoardProvider from "@/components/BoardProvider";

const dahyun = localFont({
  src: "../../public/fonts/ownglyph-park-dahyun.woff2",
  variable: "--font-dahyun",
  weight: "400",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "size-adjust", value: "125%" }],
  fallback: ["Apple SD Gothic Neo", "sans-serif"],
});

export const metadata: Metadata = {
  title: "데이트맵",
  description: "우리가 같이 가보고 싶은 곳",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "데이트맵", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4efdf",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={dahyun.variable}>
      <body><BoardProvider>{children}</BoardProvider></body>
    </html>
  );
}
