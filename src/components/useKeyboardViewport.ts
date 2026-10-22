"use client";
import { useEffect, useState } from "react";
import { layoutViewportHeight, visibleViewport } from "@/lib/viewport";
export default function useKeyboardViewport() {
  const [viewport, setViewport] = useState({ keyboard: false, height: 0, top: 0 });
  useEffect(() => {
    let baseline = layoutViewportHeight();
    const measure = () => {
      baseline = Math.max(baseline, layoutViewportHeight());
      const editable = !!document.activeElement?.matches("input,textarea,[contenteditable=true]") && window.innerWidth < 760;
      const next = visibleViewport(baseline, window.visualViewport?.height || window.innerHeight, window.visualViewport?.offsetTop || 0, editable);
      setViewport((previous) => previous.keyboard === next.keyboard && previous.height === next.height && previous.top === next.top ? previous : next);
    };
    const rotate = () => { baseline = layoutViewportHeight(); measure(); };
    measure(); window.visualViewport?.addEventListener("resize", measure); window.visualViewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure); window.addEventListener("orientationchange", rotate); window.addEventListener("pageshow", rotate);
    document.addEventListener("focusin", measure); document.addEventListener("focusout", measure);
    return () => {
      window.visualViewport?.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", rotate); window.removeEventListener("pageshow", rotate);
      document.removeEventListener("focusin", measure); document.removeEventListener("focusout", measure);
    };
  }, []);
  return viewport;
}
