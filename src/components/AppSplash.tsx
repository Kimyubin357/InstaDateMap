"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** Root layout persists across app navigation, so this runs once per document. */
export default function AppSplash() {
  const image = useRef<HTMLImageElement>(null);
  const [phase, setPhase] = useState<"visible" | "leaving" | "done">("visible");

  useEffect(() => {
    const started = performance.now();
    let disposed = false;
    let finishing = false;
    let minimum: ReturnType<typeof setTimeout>;
    let removal: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (disposed || finishing) return;
      finishing = true;
      minimum = setTimeout(() => {
        setPhase("leaving");
        removal = setTimeout(() => setPhase("done"), 180);
      }, Math.max(0, 650 - (performance.now() - started)));
    };
    // A failed or slow image must never block access to the app.
    const maximum = setTimeout(finish, 2500);
    if (image.current) void image.current.decode().then(finish, finish);
    else finish();
    return () => {
      disposed = true;
      clearTimeout(maximum); clearTimeout(minimum); clearTimeout(removal);
    };
  }, []);

  if (phase === "done") return null;
  return <div className={`app-splash${phase === "leaving" ? " is-leaving" : ""}`} role="status" aria-label="데이트맵을 여는 중">
    <Image ref={image} src="/splash/datemap-splash.webp" alt="" width={1179} height={2556} preload unoptimized />
  </div>;
}
