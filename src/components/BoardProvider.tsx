"use client";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BoardStore, EMPTY_BOARD_STATE } from "@/lib/board-store";
import { connectBoardSync } from "@/lib/sync-connection";
import { accessSender, announceAccess, type AccessMessage } from "@/lib/board-events";
import { cacheScope, type SyncAccess } from "@/lib/sync-types";
import MapApp from "@/app/MapApp";
import SearchApp from "./SearchApp";
import useKeyboardViewport from "./useKeyboardViewport";
import AddForm from "@/app/add/AddForm";
import SettingsForm from "@/app/settings/SettingsForm";
import TrashPlaces from "./TrashPlaces";
import ActionDialog from "./ActionDialog";
import Feedback, { type ToastNotice, type ToastAction } from "./Feedback";

function AddPanel() {
  const url = useSearchParams().get("url") || "";
  return <AddForm key={url} initialUrl={url} />;
}

interface BoardContext { store: BoardStore; homeHref: string; suspended: boolean; suspend: () => void; resume: () => void; resetAccess: (broadcast?: boolean) => Promise<void>; lock: () => Promise<void>; notify: (message: string, tone?: "success" | "error" | "info", action?: ToastAction) => void }
const Context = createContext<BoardContext | null>(null);
export function useBoardSync() { const context = useContext(Context); if (!context) throw new Error("BoardProvider missing"); return context; }
export function useBoardState() { const { store } = useBoardSync(); return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_BOARD_STATE); }
export default function BoardProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new BoardStore()); const [suspended, setSuspended] = useState(false);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_BOARD_STATE);
  const pathname = usePathname();
  const viewport = useKeyboardViewport();
  const onMap = pathname === "/" || pathname === "/search";
  useEffect(() => {
    document.documentElement.dataset.mapViewport = String(onMap);
    return () => { delete document.documentElement.dataset.mapViewport; };
  }, [onMap]);
  const [backHref, setBackHref] = useState("/");
  const [homeHref, setHomeHref] = useState("/");
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "success", action?: ToastAction) => {
    if (tone === "error") { setToast(null); setNotice({ message, tone }); }
    else { setNotice(null); setToast({ message, tone, action }); }
  }, []);
  useEffect(() => { if (pathname === "/") setHomeHref(backHref); else if (pathname === "/search") setHomeHref("/search"); }, [pathname, backHref]);
  const suspend = () => { setSuspended(true); store.suspend(); };
  const resume = () => { setSuspended(false); store.resume(); };
  const lock = async () => { setNotice(null); setToast(null); suspend(); await store.forget(); try { sessionStorage.removeItem("datemap-view"); } catch {} announceAccess("locked"); window.location.replace(`/enter?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); };
  const resetAccess = async (broadcast = true) => {
    setNotice(null); setToast(null);
    suspend(); await store.forget({ keepShell: true }); if (broadcast) announceAccess("changed");
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
  return <Context.Provider value={{ store, homeHref, suspended, suspend, resume, resetAccess, lock, notify }}>
    {state.access && <><div ref={(element) => { if (element) element.inert = pathname !== "/"; }} className={`persistent-map${pathname === "/" ? "" : " is-away"}`} aria-hidden={pathname !== "/"} data-sync-status={state.connected ? "connected" : "reconnecting"}><MapApp key={scope} who={state.access.who} kakaoKey={state.access.kakaoKey} active={pathname === "/"} keyboard={viewport.keyboard} onViewChange={setBackHref} /></div>
      <div className={`persistent-search${onMap ? "" : " is-away"}${pathname === "/search" ? " is-covering" : ""}`} aria-hidden={!onMap}><SearchApp key={scope} active={pathname === "/search"} backHref={backHref} viewport={viewport} /></div>
      {pathname === "/add" && <div className="shell-page" key="add"><AddPanel /></div>}
      {pathname === "/settings" && <div className="shell-page" key="settings"><SettingsForm who={state.access.who} names={state.access.memberNames} onPinChanged={notify} /></div>}
      {pathname === "/settings/trash" && <div className="shell-page" key="trash"><TrashPlaces /></div>}
      {notice && <ActionDialog title={notice.message} tone={notice.tone} onClose={() => setNotice(null)} />}
      <Feedback toast={toast} onDismiss={dismissToast} connection={pathname === "/" && state.snapshot ? state.error : ""} onRetry={() => void store.refresh()} map={pathname === "/"} />
    </>}
    {children}
  </Context.Provider>;
}
export function MapEntry({ access }: { access: SyncAccess }) {
  const { store } = useBoardSync(); const state = useBoardState();
  useEffect(() => { void store.authorize(access); }, [store, access.boardId, access.authVersion, access.who, access.expiresAt]);
  return state.access ? null : <main className="map-opening" role="status">우리 지도를 여는 중…</main>;
}
