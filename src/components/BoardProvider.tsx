"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BoardStore, EMPTY_BOARD_STATE } from "@/lib/board-store";
import { connectBoardSync } from "@/lib/sync-connection";
import { accessSender, announceAccess, type AccessMessage } from "@/lib/board-events";
import { cacheScope, type SyncAccess } from "@/lib/sync-types";
import { refreshAccess } from "@/lib/access-refresh";
import MapApp from "@/app/MapApp";
import SearchApp from "./SearchApp";
import useKeyboardViewport from "./useKeyboardViewport";
import EnterForm from "@/app/enter/EnterForm";
import AddForm from "@/app/add/AddForm";
import SettingsForm from "@/app/settings/SettingsForm";
import TrashPlaces from "./TrashPlaces";
import ActionDialog from "./ActionDialog";
import Feedback, { type ToastNotice, type ToastAction } from "./Feedback";

function AddPanel() {
  const url = useSearchParams().get("url") || "";
  return <AddForm key={url} initialUrl={url} />;
}

interface BoardContext { store: BoardStore; homeHref: string; suspended: boolean; accessError: string; checkingAccess: boolean; suspend: () => void; resume: () => void; resetAccess: (broadcast?: boolean) => Promise<boolean>; lock: () => Promise<void>; notify: (message: string, tone?: "success" | "error" | "info", action?: ToastAction) => void }
const Context = createContext<BoardContext | null>(null);
export function useBoardSync() { const context = useContext(Context); if (!context) throw new Error("BoardProvider missing"); return context; }
export function useBoardState() { const { store } = useBoardSync(); return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_BOARD_STATE); }
export default function BoardProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new BoardStore()); const [suspended, setSuspended] = useState(false);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_BOARD_STATE);
  const pathname = usePathname(); const router = useRouter();
  const [lockScreen, setLockScreen] = useState<string | null>(null);
  const locking = useRef(false);
  const [accessError, setAccessError] = useState("");
  const [checkingAccess, setCheckingAccess] = useState(false);
  const accessRequest = useRef<AbortController | null>(null);
  const accessFlight = useRef<Promise<boolean> | null>(null);
  useEffect(() => () => { accessRequest.current?.abort(); }, []);
  useEffect(() => {
    if (pathname === "/enter") { setLockScreen(null); locking.current = false; setSuspended(false); }
  }, [pathname]);
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
  const lock = async (broadcast = true) => {
    if (locking.current) return;
    locking.current = true;
    accessRequest.current?.abort(); accessRequest.current = null; accessFlight.current = null;
    setAccessError(""); setCheckingAccess(false);
    const next = window.location.pathname === "/enter" ? "/" : window.location.pathname + window.location.search;
    // Cover the old route before clearing access, so its MapEntry cannot flash during navigation.
    setLockScreen(next); setNotice(null); setToast(null); suspend();
    const forgotten = store.forget();
    try { sessionStorage.removeItem("datemap-view"); } catch {}
    if (broadcast) announceAccess("locked");
    router.replace(`/enter?next=${encodeURIComponent(next)}`);
    await forgotten;
  };
  const resetAccess = (broadcast = true): Promise<boolean> => {
    if (accessFlight.current) return accessFlight.current;
    const abort = new AbortController(); accessRequest.current = abort;
    setNotice(null); setToast(null); setAccessError(""); setCheckingAccess(true);
    suspend();
    const task = (async () => {
      // Forget clears memory immediately. A slow cache cleanup must not delay the network deadline.
      void store.forget({ keepShell: true });
      if (broadcast) announceAccess("changed");
      try {
        const access = await refreshAccess(abort.signal);
        if (abort.signal.aborted || accessRequest.current !== abort) return false;
        if (!access) { await lock(); return false; }
        await store.authorize(access);
        if (abort.signal.aborted || accessRequest.current !== abort) return false;
        setSuspended(false); return true;
      } catch {
        if (!abort.signal.aborted && accessRequest.current === abort) setAccessError("입장 정보 확인이 늦어지고 있어요. 연결을 확인한 뒤 다시 확인해 주세요.");
        return false;
      } finally {
        if (accessRequest.current === abort) { accessRequest.current = null; accessFlight.current = null; setCheckingAccess(false); }
      }
    })();
    accessFlight.current = task;
    return task;
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
      if (event.type === "locked") { if (window.location.pathname !== "/enter") void lock(false); } else if (event.type === "changed") void resetAccess(false);
    };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("datemap-access"); channel.onmessage = (e) => receive(e.data); } catch {}
    const storage = (event: StorageEvent) => { if (event.key === "datemap-access-event" && event.newValue) { try { receive(JSON.parse(event.newValue)); } catch {} } };
    window.addEventListener("datemap:changed", change); window.addEventListener("storage", storage);
    return () => { channel?.close(); window.removeEventListener("datemap:changed", change); window.removeEventListener("storage", storage); };
  }, [store]);
  return <Context.Provider value={{ store, homeHref, suspended, accessError, checkingAccess, suspend, resume, resetAccess, lock, notify }}>
    {lockScreen !== null ? <EnterForm configured next={lockScreen} disabled /> : <>
    {state.access && <><div ref={(element) => { if (element) element.inert = pathname !== "/"; }} className={`persistent-map${pathname === "/" ? "" : " is-away"}`} aria-hidden={pathname !== "/"} data-sync-status={state.connected ? "connected" : "reconnecting"}><MapApp key={scope} who={state.access.who} kakaoKey={state.access.kakaoKey} active={pathname === "/"} keyboard={viewport.keyboard} onViewChange={setBackHref} /></div>
      <div className={`persistent-search${onMap ? "" : " is-away"}${pathname === "/search" ? " is-covering" : ""}`} aria-hidden={!onMap}><SearchApp key={scope} active={pathname === "/search"} backHref={backHref} viewport={viewport} /></div>
      {pathname === "/add" && <div className="shell-page" key="add"><AddPanel /></div>}
      {pathname === "/settings" && <div className="shell-page" key="settings"><SettingsForm who={state.access.who} names={state.access.memberNames} onPinChanged={notify} /></div>}
      {pathname === "/settings/trash" && <div className="shell-page" key="trash"><TrashPlaces /></div>}
      {notice && <ActionDialog title={notice.message} tone={notice.tone} onClose={() => setNotice(null)} />}
      {accessError && pathname !== "/settings" && <ActionDialog title="입장 정보를 다시 확인해 주세요" message={accessError} tone="error" confirmLabel="입장 정보 다시 확인" onClose={() => { void resetAccess(false); }} />}
      <Feedback toast={toast} onDismiss={dismissToast} connection={pathname === "/" && state.snapshot ? state.error : ""} onRetry={() => void store.refresh()} map={pathname === "/"} />
    </>}
    {children}</> }
  </Context.Provider>;
}
export function MapEntry({ access }: { access: SyncAccess }) {
  const { store } = useBoardSync(); const state = useBoardState();
  useEffect(() => { void store.authorize(access); }, [store, access.boardId, access.authVersion, access.who, access.expiresAt]);
  return state.access ? null : <main className="map-opening" role="status">우리 지도를 여는 중…</main>;
}
