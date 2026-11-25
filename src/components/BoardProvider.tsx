"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BoardStore, EMPTY_BOARD_STATE } from "@/lib/board-store";
import { connectBoardSync } from "@/lib/sync-connection";
import { accessSender, announceAccess, type AccessMessage } from "@/lib/board-events";
import { cacheScope, type SyncAccess } from "@/lib/sync-types";
import { refreshAccess } from "@/lib/access-refresh";
import { RoomsStore, EMPTY_ROOMS_STATE } from "@/lib/rooms-store";
import { requestJson } from "@/lib/client-request";
import MapApp from "@/app/MapApp";
import SearchApp from "./SearchApp";
import useKeyboardViewport from "./useKeyboardViewport";
import LoginScreen from "@/app/login/LoginScreen";
import AddForm from "@/app/add/AddForm";
import SettingsForm from "@/app/settings/SettingsForm";
import FoldersPanel from "@/app/folders/FoldersPanel";
import ProfilePanel from "@/app/settings/profile/ProfilePanel";
import NotificationsPanel from "@/app/settings/notifications/NotificationsPanel";
import TrashPlaces from "./TrashPlaces";
import ActionDialog from "./ActionDialog";
import Feedback, { type ToastNotice, type ToastAction } from "./Feedback";

function AddPanel() {
  const params = useSearchParams(); const url = params.get("url") || "";
  return <AddForm key={url} initialUrl={url} initialRetry={params.get("retry") === "1"} />;
}

interface BoardContext { store: BoardStore; rooms: RoomsStore;
  /** 보는 범위 바꾸기: "all" = 전체, 방 id = 그 방(이 기기가 연 방이 아니면 그 방을 열고 다시 접속합니다). */
  chooseScope: (target: "all" | string) => Promise<boolean>;
  homeHref: string; suspended: boolean; accessError: string; checkingAccess: boolean; suspend: () => void; resume: () => void; resetAccess: (broadcast?: boolean) => Promise<boolean>; lock: () => Promise<void>; notify: (message: string, tone?: "success" | "error" | "info", action?: ToastAction) => void }
const Context = createContext<BoardContext | null>(null);
export function useBoardSync() { const context = useContext(Context); if (!context) throw new Error("BoardProvider missing"); return context; }
export function useBoardState() { const { store } = useBoardSync(); return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_BOARD_STATE); }
/** 방 고르기·전체 보기 상태(범위·방 목록·전체 장소·본 장소) */
export function useRooms() { const { rooms } = useBoardSync(); return useSyncExternalStore(rooms.subscribe, rooms.getSnapshot, () => EMPTY_ROOMS_STATE); }
export default function BoardProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new BoardStore()); const [suspended, setSuspended] = useState(false);
  const [rooms] = useState(() => new RoomsStore());
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
    if (pathname === "/enter" || pathname === "/login") { setLockScreen(null); locking.current = false; setSuspended(false); }
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
  const toastId = useRef(0);
  const dismissToast = useCallback((notice: ToastNotice) => setToast((current) => current === notice ? null : current), []);
  const completeToastAction = useCallback((notice: ToastNotice, message: string) => {
    const next: ToastNotice = { id: ++toastId.current, message, tone: "success" };
    setToast((current) => current === notice ? next : current);
  }, []);
  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "success", action?: ToastAction) => {
    if (tone === "error") { setToast(null); setNotice({ message, tone }); }
    else { setNotice(null); setToast({ id: ++toastId.current, message, tone, action }); }
  }, []);
  useEffect(() => { if (pathname === "/") setHomeHref(backHref); else if (pathname === "/search") setHomeHref("/search"); }, [pathname, backHref]);
  const suspend = () => { setSuspended(true); store.suspend(); };
  const resume = () => { setSuspended(false); store.resume(); };
  const lock = async (broadcast = true) => {
    if (locking.current) return;
    locking.current = true;
    accessRequest.current?.abort(); accessRequest.current = null; accessFlight.current = null;
    setAccessError(""); setCheckingAccess(false);
    const next = ["/enter", "/login"].includes(window.location.pathname) ? "/" : window.location.pathname + window.location.search;
    // Cover the old route before clearing access, so its MapEntry cannot flash during navigation.
    setLockScreen(next); setNotice(null); setToast(null); suspend();
    const forgotten = store.forget(); rooms.forget();
    try { sessionStorage.removeItem("datemap-view"); } catch {}
    if (broadcast) announceAccess("locked");
    router.replace(`/login?next=${encodeURIComponent(next)}`);
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
  // 뒤로 가기로 예전 화면의 옛 방 입장 정보가 되살아나면, 서버에서 지금 입장 정보를 다시 받아 맞춥니다.
  store.onStaleAccess = () => { void resetAccess(); };
  const chooseScope = async (target: "all" | string) => {
    if (target === "all") { rooms.setScope("all"); return true; }
    if (target === store.getSnapshot().access?.boardId) { rooms.setScope("room"); return true; }
    await requestJson(`/api/folders/${encodeURIComponent(target)}/open`, { method: "POST", notifyBoardChange: false, headers: { "Content-Type": "application/json" }, body: "{}" });
    rooms.setScope("room");
    return resetAccess();
  };
  const userId = state.access?.userId ?? null, openRoom = state.access?.boardId ?? null;
  useEffect(() => { if (!suspended) rooms.bind(userId); }, [rooms, userId, openRoom, suspended]);
  // 열린 방의 변경(실시간)·화면 복귀·30초마다 전체 보기도 맞춥니다(변경이 없으면 304).
  const revision = state.snapshot?.revision;
  useEffect(() => { if (revision) rooms.schedule(); }, [rooms, revision]);
  useEffect(() => {
    if (!userId) return;
    const visible = () => document.visibilityState !== "hidden";
    const back = () => { if (visible()) rooms.schedule(0); };
    const timer = setInterval(() => { if (visible() && rooms.getSnapshot().scope === "all") void rooms.loadAll(); }, 30000);
    document.addEventListener("visibilitychange", back); window.addEventListener("online", back);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", back); window.removeEventListener("online", back); };
  }, [rooms, userId]);
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
    if (["/enter", "/login"].includes(pathname)) {
      accessRequest.current?.abort(); accessRequest.current = null; accessFlight.current = null;
      setAccessError(""); setCheckingAccess(false); void store.forget(); rooms.forget();
    }
  }, [pathname, store]);
  useEffect(() => {
    const change = () => { store.invalidate(); rooms.schedule(); };
    const seen = new Set<number>();
    const receive = (event: { type?: AccessMessage; nonce?: number; sender?: string }) => {
      if (event?.sender === accessSender || typeof event?.nonce !== "number" || seen.has(event.nonce)) return;
      seen.add(event.nonce); if (seen.size > 20) seen.delete(seen.values().next().value!);
      if (event.type === "locked") { if (!["/enter", "/login"].includes(window.location.pathname)) void lock(false); } else if (event.type === "changed") void resetAccess(false);
    };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("datemap-access"); channel.onmessage = (e) => receive(e.data); } catch {}
    const storage = (event: StorageEvent) => { if (event.key === "datemap-access-event" && event.newValue) { try { receive(JSON.parse(event.newValue)); } catch {} } };
    window.addEventListener("datemap:changed", change); window.addEventListener("storage", storage);
    return () => { channel?.close(); window.removeEventListener("datemap:changed", change); window.removeEventListener("storage", storage); };
  }, [store, rooms]);
  return <Context.Provider value={{ store, rooms, chooseScope, homeHref, suspended, accessError, checkingAccess, suspend, resume, resetAccess, lock, notify }}>
    {lockScreen !== null ? <LoginScreen next={lockScreen} disabled /> : <>
    {state.access && <><div ref={(element) => { if (element) element.inert = pathname !== "/"; }} className={`persistent-map${pathname === "/" ? "" : " is-away"}`} aria-hidden={pathname !== "/"} data-sync-status={state.connected ? "connected" : "reconnecting"}><MapApp key={scope} who={state.access.who} kakaoKey={state.access.kakaoKey} active={pathname === "/"} keyboard={viewport.keyboard} onViewChange={setBackHref} /></div>
      <div className={`persistent-search${onMap ? "" : " is-away"}${pathname === "/search" ? " is-covering" : ""}`} aria-hidden={!onMap}><SearchApp key={scope} active={pathname === "/search"} backHref={backHref} viewport={viewport} /></div>
      {pathname === "/add" && <div className="shell-page" key="add"><AddPanel /></div>}
      {pathname === "/settings" && <div className="shell-page" key="settings"><SettingsForm who={state.access.who} /></div>}
      {pathname === "/folders" && <div className="shell-page" key="folders"><FoldersPanel /></div>}
      {pathname === "/settings/profile" && <div className="shell-page" key="profile"><ProfilePanel /></div>}
      {pathname === "/settings/notifications" && <div className="shell-page" key="notifications"><NotificationsPanel /></div>}
      {pathname === "/settings/trash" && <div className="shell-page" key="trash"><TrashPlaces /></div>}
      {notice && <ActionDialog title={notice.message} tone={notice.tone} onClose={() => setNotice(null)} />}
      {accessError && pathname !== "/settings" && <ActionDialog title="입장 정보를 다시 확인해 주세요" message={accessError} tone="error" confirmLabel="입장 정보 다시 확인" onClose={() => { void resetAccess(false); }} />}
      <Feedback toast={toast} onDismiss={dismissToast} onActionComplete={completeToastAction} connection={pathname === "/" && state.snapshot ? state.error : ""} onRetry={() => void store.refresh()} map={pathname === "/"} />
    </>}
    {children}</> }
  </Context.Provider>;
}
export function MapEntry({ access }: { access: SyncAccess }) {
  const { store } = useBoardSync(); const state = useBoardState();
  useEffect(() => { void store.authorize(access); }, [store, access.boardId, access.authVersion, access.who, access.expiresAt, String(access.memberIds)]);
  return state.access ? null : <main className="map-opening" role="status">지도를 여는 중…</main>;
}
