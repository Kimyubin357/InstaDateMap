"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { friendlyMessage, requestJson, withRequestDeadline } from "@/lib/client-request";
import { useBoardSync, useBoardState } from "./BoardProvider";
type Config = { configured: boolean; publicKey?: string; subscribed: boolean };
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
  const version = useRef(0), writing = useRef(false), queuedCheck = useRef(false), mounted = useRef(false);
  const recheck = useRef<() => void>(() => {}), cancelCheck = useRef<() => void>(() => {});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let alive = true, flight = false, queued = false;
    let controller: AbortController | undefined, worker: ServiceWorkerRegistration | undefined;
    setChecking(true); setHint(""); setConfig(undefined); setRegistration(undefined); setSubscribed(false);
    if (suspended) { setHint("입장 상태를 확인한 뒤 알림을 다시 확인해 주세요."); setChecking(false); return; }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (ios && !installed) { setHint("아이폰에서는 홈 화면에 추가한 데이트맵을 열어 알림을 켜 주세요."); setChecking(false); return; }
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setHint("이 브라우저에서는 알림을 받을 수 없어요. 홈 화면 앱이나 알림을 지원하는 브라우저에서 열어 주세요."); setChecking(false); return;
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
        setRegistration(ready); setSubscribed(!!subscription && value.subscribed && Notification.permission === "granted");
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
      await requestJson("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()), signal: AbortSignal.timeout(12000) });
      if (current !== version.current) return;
      const granted = Notification.permission === "granted";
      setSubscribed(granted); setHint(granted ? "" : "기기 설정에서 데이트맵 알림을 허용한 뒤 다시 확인해 주세요.");
      if (granted) notify("상대방의 새 장소와 메모 소식을 알려드릴게요.");
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
      setSubscribed(false); notify("이 기기의 장소 알림을 껐어요.");
    } catch (e) { if (current === version.current) notify(friendlyMessage(e, "알림을 끄지 못했어요. 다시 시도해 주세요."), "error"); }
    finally { endChange(); }
  }
  return <section className="settings-section push-settings" aria-busy={busy || checking}>
    <h2><Icon name="bell" /> 우리 지도 알림</h2><p className="lead">상대방이 장소를 담거나 메모를 추가·수정하면 알려드려요.</p>
    {checking ? <p className="hint" role="status">알림 설정을 확인하고 있어요…</p> : <>
      <p className="hint" role="status">{hint || (subscribed ? "이 기기에서 알림을 받고 있어요." : "이 기기의 알림이 꺼져 있어요.")}</p>
      {registration && config?.configured && <button className={`btn${subscribed ? "" : " primary"}`} disabled={busy || suspended} onClick={subscribed ? disable : enable}>
        {busy ? "설정 중…" : subscribed ? "이 기기 알림 끄기" : "이 기기에서 알림 받기"}</button>}
      {hint && <button className="text-btn" disabled={busy || suspended} onClick={() => recheck.current()}>다시 확인</button>}
      <p className="hint">기기를 잠그거나 PIN을 바꾸면 알림도 멈춰요. 다시 입장한 뒤 여기에서 켜 주세요.</p>
    </>}
  </section>;
}
