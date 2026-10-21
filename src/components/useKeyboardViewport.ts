"use client";
import { useEffect, useState } from "react";
export default function useKeyboardViewport() {
  const [viewport, setViewport] = useState({ keyboard: false, height: 0, top: 0 });
  useEffect(() => {
    let baseline = window.innerHeight;
    const measure = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      baseline = Math.max(baseline, window.innerHeight);
      const editable = document.activeElement?.matches("input,textarea,[contenteditable=true]");
      const keyboard = !!editable && baseline - height > 120 && window.innerWidth < 760;
      const top = keyboard ? window.visualViewport?.offsetTop || 0 : 0;
      setViewport((previous) => previous.keyboard === keyboard && previous.height === height && previous.top === top ? previous : { keyboard, height, top });
    };
    const rotate = () => { baseline = window.innerHeight; measure(); };
    measure(); window.visualViewport?.addEventListener("resize", measure); window.visualViewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure); window.addEventListener("orientationchange", rotate);
    document.addEventListener("focusin", measure); document.addEventListener("focusout", measure);
    return () => {
      window.visualViewport?.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", rotate);
      document.removeEventListener("focusin", measure); document.removeEventListener("focusout", measure);
    };
  }, []);
  return viewport;
}
