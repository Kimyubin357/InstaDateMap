"use client";

import { useEffect } from "react";
import { installEdgeBackGuard } from "@/lib/edge-navigation";

export default function EdgeNavigationGuard() {
  useEffect(() => installEdgeBackGuard(document, {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
  }), []);
  return null;
}
