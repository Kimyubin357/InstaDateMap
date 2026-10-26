"use client";

import { useEffect } from "react";
import { dahyun } from "@/lib/app-font";
import RecoveryPage from "@/components/RecoveryPage";
import "./globals.css";
import "./fabric-theme.css";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { console.error("앱 화면을 표시하지 못했어요.", error); }, [error]);
  return <html lang="ko" className={dahyun.variable}>
    <head><title>데이트맵</title><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /></head>
    <body><RecoveryPage /></body>
  </html>;
}
