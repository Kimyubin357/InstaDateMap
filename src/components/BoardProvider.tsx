"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BoardStore, EMPTY_BOARD_STATE } from "@/lib/board-store";
import { connectBoardSync } from "@/lib/sync-connection";
import { accessSender, announceAccess, type AccessMessage } from "@/lib/board-events";
import { cacheScope, type SyncAccess } from "@/lib/sync-types";
import MapApp from "@/app/MapApp";

interface BoardContext { store: BoardStore; suspended: boolean; suspend: () => void; resume: () => void; resetAccess: (broadcast?: boolean) => Promise<void>; lock: () => Promise<void> }
const Context = createContext<BoardContext | null>(null);
export function useBoardSync() { const context = useContext(Context); if (!context) throw new Error("BoardProvider missing"); return context; }
export function useBoardState() { const { store } = useBoardSync(); return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_BOARD_STATE); }
export default function BoardProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new BoardStore()); const [suspended, setSuspended] = useState(false);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_BOARD_STATE);
  const pathname = usePathname();
  const suspend = () => { setSuspended(true); store.suspend(); };
  const resume = () => { setSuspended(false); store.resume(); };
  const lock = async () => { suspend(); await store.forget(); try { sessionStorage.removeItem("datemap-view"); } catch {} announceAccess("locked"); window.location.replace(`/enter?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); };
  const resetAccess = async (broadcast = true) => {
    suspend(); await store.forget(); if (broadcast) announceAccess("changed");
    try {
      const res = await fetch("/api/access/context", { cache: "no-store" });
      if (res.status === 401 || res.status === 409) { await lock(); return; }
      if (!res.ok) throw new Error("기기의 입장 상태를 확인하지 못했어요.");
      await store.authorize(await res.json()); setSuspended(false);
    } catch { window.location.reload(); }
  };
  store.onUnauthorized = () => { void lock(); };
  const scope = state.access ? cacheScope(state.access) : "";
  useEffect(() => { if (!scope || suspended) return; return connectBoardSync(store); }, [scope, suspended, store]);
  useEffect(() => {
    if (!state.access) return;
    const expiry = new Date(state.access.expiresAt).getTime(); let timer: ReturnType<typeof setTimeout>;
    const check = () => { const remaining = expiry - Date.now(); if (remaining <= 0) store.onUnauthorized(); else timer = setTimeout(check, Math.min(remaining, 2147483647)); };
    check();
    return () => clearTimeout(timer);
  }, [state.access, store]);
  useEffect(() => {
    if (["/enter", "/setup"].includes(pathname)) void store.forget();
  }, [pathname, store]);
  useEffect(() => {
    const change = () => store.invalidate();
    const seen = new Set<number>();
    const receive = (event: { type?: AccessMessage; nonce?: number; sender?: string }) => {
      if (event?.sender === accessSender || typeof event?.nonce !== "number" || seen.has(event.nonce)) return;
      seen.add(event.nonce); if (seen.size > 20) seen.delete(seen.values().next().value!);
      if (event.type === "locked") { store.suspend(); void store.forget().then(() => { if (window.location.pathname !== "/enter") window.location.replace("/enter"); }); } else if (event.type === "changed") void resetAccess(false);
    };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("datemap-access"); channel.onmessage = (e) => receive(e.data); } catch {}
    const storage = (event: StorageEvent) => { if (event.key === "datemap-access-event" && event.newValue) { try { receive(JSON.parse(event.newValue)); } catch {} } };
    window.addEventListener("datemap:changed", change); window.addEventListener("storage", storage);
    return () => { channel?.close(); window.removeEventListener("datemap:changed", change); window.removeEventListener("storage", storage); };
  }, [store]);
  return <Context.Provider value={{ store, suspended, suspend, resume, resetAccess, lock }}>
    {state.access && <div className={`persistent-map${pathname === "/" ? "" : " is-away"}`} aria-hidden={pathname !== "/"} data-sync-status={state.connected ? "connected" : "reconnecting"}><MapApp who={state.access.who} kakaoKey={state.access.kakaoKey} active={pathname === "/"} /></div>}
    {children}
  </Context.Provider>;
}
export function MapEntry({ access }: { access: SyncAccess }) {
  const { store } = useBoardSync(); const state = useBoardState();
  useEffect(() => { void store.authorize(access); }, [store, access.boardId, access.authVersion, access.who, access.expiresAt]);
  return state.access ? null : <main className="map-opening" role="status">우리 지도를 여는 중…</main>;
}
