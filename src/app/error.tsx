"use client";

import { useEffect } from "react";
import RecoveryPage from "@/components/RecoveryPage";

export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { console.error("페이지를 표시하지 못했어요.", error); }, [error]);
  // A fresh GET also retries a failed Server Component; resetting a cached tree alone cannot.
  return <RecoveryPage />;
}
