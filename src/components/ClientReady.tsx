"use client";
import { useEffect, useState, type ReactNode } from "react";
/** Disable server-rendered controls until their event handlers are attached. */
export default function ClientReady({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return <fieldset className="client-ready" disabled={!ready} aria-busy={!ready}>{children}</fieldset>;
}
