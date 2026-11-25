"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { friendlyMessage, requestJson, withRequestDeadline } from "@/lib/client-request";
import { useBoardSync, useBoardState } from "./BoardProvider";
type FolderPush = { id: string; name: string; on: boolean };
type Config = { configured: boolean; publicKey?: string; subscribed: boolean; folders?: FolderPush[] };
function serverKey(value: string) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export default function PushSettings() {
  const { notify, suspended } = useBoardSync();
  const { access } = useBoardState();
  const [config, setConfig] = useState<Config>(); const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [subscribed, setSubscribed] = useState(false); const [busy, setBusy] = useState(false); const [checking, setChecking] = useState(true);
  const [hint, setHint] = useState("");
  const [folders, setFolders] = useState<FolderPush[]>([]);
  const version = useRef(0), writing = useRef(false), queuedCheck = useRef(false), mounted = useRef(false);
  const [cantUse, setCantUse] = useState(false);
  const recheck = useRef<() => void>(() => {}), cancelCheck = useRef<() => void>(() => {});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let alive = true, flight = false, queued = false;
    let controller: AbortController | undefined, worker: ServiceWorkerRegistration | undefined;
    setChecking(true); setHint(""); setCantUse(false); setConfig(undefined); setRegistration(undefined); setSubscribed(false);
    if (suspended) { setHint("입장 상태를 확인한 뒤 알림을 다시 확인해 주세요."); setChecking(false); return; }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (ios && !installed) { setCantUse(true); setHint("이 기기에서는 아직 켤 수 없어요."); setChecking(false); return; }
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setCantUse(true); setHint("이 기기에서는 아직 켤 수 없어요."); setChecking(false); return;
    }
    async function prepare() {
      if (!alive) return;
      if (writing.current) { queuedCheck.current = true; return; }
      if (flight) { queued = true; return; }
      flight = true;
      const current = ++version.current;
      controller = new AbortController();
      cancelCheck.current = () => controller?.abort();
      setChecking(true); setHint("");
      try {
        // Bound the entire check, including a worker/subscription promise that never settles.
        const { value, ready, subscription } = await withRequestDeadline(async (signal) => {
          const value = await requestJson<Config>("/api/push", { signal, cache: "no-store" });
          if (!value.configured) return { value, ready: undefined, subscription: null };
          if (!worker) {
            await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
            worker = await navigator.serviceWorker.ready;
          }
          const subscription = await worker.pushManager.getSubscription();
          return { value, ready: worker, subscription };
        }, { signal: controller.signal, timeoutMs: 12000 });
        if (!alive || current !== version.current) return;
        setConfig(value);
        if (!value.configured) { setSubscribed(false); setRegistration(undefined); setHint("알림 기능을 준비 중이에요. 준비되면 여기에서 켤 수 있어요."); return; }
        setRegistration(ready); setFolders(value.folders ?? []); setSubscribed(!!subscription && value.subscribed && Notification.permission === "granted");
        if (Notification.permission === "denied") setHint("기기 설정에서 데이트맵 알림을 허용한 뒤 다시 확인해 주세요.");
      } catch (e) { if (alive && current === version.current) { setSubscribed(false); setHint(friendlyMessage(e, "알림 설정을 확인하지 못했어요. 다시 확인해 주세요.")); } }
      finally {
        flight = false;
        if (alive && current === version.current) setChecking(false);
        if (alive && queued) { queued = false; void prepare(); }
      }
    }
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      // Stop claiming delivery immediately; network verification may take longer.
      if (Notification.permission !== "granted") setSubscribed(false);
      void prepare();
    };
    recheck.current = () => { void prepare(); };
    void prepare();
    window.addEventListener("focus", resume); window.addEventListener("pageshow", resume); document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false; ++version.current; controller?.abort(); recheck.current = () => {}; cancelCheck.current = () => {};
      window.removeEventListener("focus", resume); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume);
    };
  }, [suspended, access?.boardId, access?.authVersion, access?.who]);
  function beginChange() {
    writing.current = true;
    const current = ++version.current;
    cancelCheck.current(); setChecking(false); setBusy(true);
    return current;
  }
  function endChange() {
    writing.current = false;
    if (mounted.current) setBusy(false);
    if (queuedCheck.current) { queuedCheck.current = false; recheck.current(); }
  }
  async function enable() {
    if (writing.current || suspended || !registration || !config?.publicKey) return;
    // Request permission directly in the tap, before network/worker awaits (iOS).
    const permission = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    const current = beginChange(); let created: PushSubscription | undefined;
    try {
      const allowed = await permission;
      if (current !== version.current) return;
      if (allowed !== "granted") { setSubscribed(false); setHint("기기 설정에서 데이트맵 알림을 허용해 주세요."); return; }
      let subscription = await registration.pushManager.getSubscription();
      if (current !== version.current) return;
      if (subscription?.options.applicationServerKey) {
        const old = new Uint8Array(subscription.options.applicationServerKey), next = serverKey(config.publicKey);
        if (old.length !== next.length || old.some((b, i) => b !== next[i])) { await subscription.unsubscribe(); subscription = null; }
      }
      if (!subscription) { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey(config.publicKey) }); created = subscription; }
      if (current !== version.current) { await created?.unsubscribe().catch(() => {}); return; }
      // 처음 켤 때는 참여한 모든 폴더의 알림을 켭니다. 아래에서 폴더별로 끌 수 있어요.
      const saved = await requestJson<{ folders?: FolderPush[] }>("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: subscription.toJSON() }), signal: AbortSignal.timeout(12000) });
      if (current !== version.current) return;
      setFolders(saved.folders ?? []);
      const granted = Notification.permission === "granted";
      setSubscribed(granted); setHint(granted ? "" : "기기 설정에서 데이트맵 알림을 허용한 뒤 다시 확인해 주세요.");
    } catch (e) { await created?.unsubscribe().catch(() => {}); if (current === version.current) notify(e instanceof DOMException && e.name === "NotAllowedError" ? "기기 설정에서 데이트맵 알림을 허용해 주세요." : friendlyMessage(e, "알림을 켜지 못했어요. 다시 시도해 주세요."), "error"); }
    finally { endChange(); }
  }
  async function disable() {
    if (writing.current || suspended || !registration) return;
    const current = beginChange();
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (current !== version.current) return;
      if (subscription) {
        await requestJson("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }), signal: AbortSignal.timeout(12000) });
        await subscription.unsubscribe().catch(() => {});
      }
      if (current !== version.current) return;
      setSubscribed(false);
    } catch (e) { if (current === version.current) notify(friendlyMessage(e, "알림을 끄지 못했어요. 다시 시도해 주세요."), "error"); }
    finally { endChange(); }
  }
  /** 폴더 하나의 알림을 켜고 끕니다(이 기기 기준). */
  async function toggleFolder(id: string) {
    if (writing.current || suspended || !registration) return;
    const next = folders.map((f) => f.id === id ? { ...f, on: !f.on } : f);
    const current = beginChange();
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) { setSubscribed(false); return; }
      const saved = await requestJson<{ subscribed: boolean; folders?: FolderPush[] }>("/api/push", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON(), folders: next.filter((f) => f.on).map((f) => f.id) }), signal: AbortSignal.timeout(12000) });
      if (current !== version.current) return;
      setFolders(saved.folders ?? next);
      if (!saved.subscribed) { await subscription.unsubscribe().catch(() => {}); setSubscribed(false); }
    } catch (e) { if (current === version.current) notify(friendlyMessage(e, "알림 설정을 바꾸지 못했어요. 다시 시도해 주세요."), "error"); }
    finally { endChange(); }
  }
  const available = !!registration && !!config?.configured;
  const onCount = folders.filter((f) => f.on).length;
  const status = busy ? "설정 중…" : checking ? "알림 설정을 확인하고 있어요…" : hint || (subscribed ? (folders.length > 1 ? `방 ${onCount}곳의 알림을 이 기기에서 받고 있어요.` : "이 기기에서 알림을 받고 있어요.") : "멤버가 장소를 담거나 메모를 바꾸면 알려드려요.");
  return <div className="push-settings" aria-busy={busy || checking}>
    <button type="button" className="settings-row" role="switch" aria-label="새 장소·메모 알림" aria-checked={subscribed} disabled={checking || busy || suspended || !available} onClick={subscribed ? disable : enable}>
      <Icon name="bell" /><span className="settings-copy"><span>새 장소·메모 알림</span><small>{status}</small></span><span className="settings-switch" aria-hidden="true" /></button>
    {subscribed && !checking && folders.length > 1 && <div className="push-folders" role="group" aria-label="방별 알림">
      {folders.map((f) => <button key={f.id} type="button" className="settings-row push-folder-row" role="switch" aria-checked={f.on} disabled={busy || suspended} onClick={() => void toggleFolder(f.id)}>
        <Icon name="map" width={18} /><span className="settings-copy"><span>{f.name}</span></span><span className="settings-switch" aria-hidden="true" /></button>)}
    </div>}
    <span className="sr-only" role="status">{status}</span>
    {hint && !checking && !cantUse && <button className="text-btn settings-recheck" disabled={busy || suspended} onClick={() => recheck.current()}>다시 확인</button>}
    {!checking && available && !subscribed && <p className="hint settings-hint">로그아웃하면 이 기기의 알림도 멈춰요. 다시 로그인한 뒤 여기에서 켜 주세요.</p>}
  </div>;
}
