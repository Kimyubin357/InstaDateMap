"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-request";
import { workId } from "@/lib/work-id";
const requests = new Map<string, Promise<unknown>>();
function enqueue(url: string, task: () => Promise<unknown>) {
  const next = (requests.get(url) || Promise.resolve()).catch(() => {}).then(task);
  requests.set(url, next);
  void next.finally(() => { if (requests.get(url) === next) requests.delete(url); }).catch(() => {});
  return next;
}
export function useSourceSession(sourceId?: string, version?: string) {
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const claimRef = useRef<() => Promise<void>>(async () => {});
  const retry = useCallback(() => claimRef.current(), []);
  useEffect(() => {
    setReady(false); setError(""); setChecking(false);
    if (!sourceId || !version) return;
    let active = true, flight = false;
    const url = `/api/sources/${sourceId}/session`;
    const body = (action: string) => JSON.stringify({ action, version, work_id: workId() });
    const claim = async () => {
      if (!active || flight) return;
      flight = true; setChecking(true); setError("");
      try { await enqueue(url, () => requestJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body("claim"), timeoutMs: 10000 })); if (active) { setReady(true); setError(""); } }
      catch (e) { if (active) { setReady(false); setError(e instanceof Error ? e.message : "링크 상태를 확인하지 못했어요."); } }
      finally { flight = false; if (active) setChecking(false); }
    };
    claimRef.current = claim;
    const release = () => { void enqueue(url, () => requestJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body("release"), keepalive: true, timeoutMs: 5000 })).catch(() => {}); };
    const resume = () => { if (document.visibilityState === "visible") void claim(); };
    void claim();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void claim(); }, 25000);
    window.addEventListener("pagehide", release); window.addEventListener("pageshow", resume); document.addEventListener("visibilitychange", resume);
    return () => { active = false; if (claimRef.current === claim) claimRef.current = async () => {}; clearInterval(timer); window.removeEventListener("pagehide", release); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume); release(); };
  }, [sourceId, version]);
  return { ready, error, checking, retry };
}
