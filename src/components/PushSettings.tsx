"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { requestJson } from "@/lib/client-request";
import { useBoardSync, useBoardState } from "./BoardProvider";
type Config = { configured: boolean; publicKey?: string; subscribed: boolean };
function serverKey(value: string) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export default function PushSettings() {
  const { notify } = useBoardSync();
  const { access } = useBoardState();
  const [config, setConfig] = useState<Config>(); const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [subscribed, setSubscribed] = useState(false); const [busy, setBusy] = useState(false); const [checking, setChecking] = useState(true);
  const [hint, setHint] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    setChecking(true); setHint(""); setConfig(undefined); setRegistration(undefined); setSubscribed(false);
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (ios && !installed) { setHint("아이폰에서는 홈 화면에 추가한 데이트맵을 열어 알림을 켜 주세요."); setChecking(false); return; }
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setHint("이 브라우저에서는 알림을 받을 수 없어요. 홈 화면 앱이나 알림을 지원하는 브라우저에서 열어 주세요."); setChecking(false); return;
    }
    async function prepare() {
      try {
        const value = await requestJson<Config>("/api/push", { signal: AbortSignal.timeout(12000) });
        if (!alive) return;
        setConfig(value);
        if (!value.configured) { setHint("알림 기능을 준비 중이에요. 준비되면 여기에서 켤 수 있어요."); return; }
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const ready = await Promise.race([navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("알림 준비가 늦어지고 있어요. 다시 확인해 주세요.")), 12000); })]);
        const subscription = await ready.pushManager.getSubscription();
        if (!alive) return;
        setRegistration(ready); setSubscribed(!!subscription && value.subscribed && Notification.permission === "granted");
        if (Notification.permission === "denied") setHint("기기 설정에서 데이트맵 알림을 허용한 뒤 다시 확인해 주세요.");
      } catch (e) { if (alive) setHint(e instanceof Error ? e.message : "알림 설정을 확인하지 못했어요."); }
      finally { clearTimeout(timer); if (alive) setChecking(false); }
    }
    void prepare();
    return () => { alive = false; clearTimeout(timer); };
  }, [retry, access?.authVersion, access?.who]);
  async function enable() {
    if (!registration || !config?.publicKey) return;
    // Request permission directly in the tap, before network/worker awaits (iOS).
    const permission = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    setBusy(true); let created: PushSubscription | undefined;
    try {
      if (await permission !== "granted") { setHint("기기 설정에서 데이트맵 알림을 허용해 주세요."); return; }
      let subscription = await registration.pushManager.getSubscription();
      if (subscription?.options.applicationServerKey) {
        const old = new Uint8Array(subscription.options.applicationServerKey), next = serverKey(config.publicKey);
        if (old.length !== next.length || old.some((b, i) => b !== next[i])) { await subscription.unsubscribe(); subscription = null; }
      }
      if (!subscription) { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey(config.publicKey) }); created = subscription; }
      await requestJson("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()), signal: AbortSignal.timeout(12000) });
      setSubscribed(true); setHint(""); notify("상대방이 담은 새 장소를 알려드릴게요.");
    } catch (e) { await created?.unsubscribe().catch(() => {}); notify(e instanceof Error ? e.message : "알림을 켜지 못했어요. 다시 시도해 주세요.", "error"); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (!registration) return;
    setBusy(true);
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await requestJson("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }), signal: AbortSignal.timeout(12000) });
        await subscription.unsubscribe().catch(() => {});
      }
      setSubscribed(false); notify("이 기기의 장소 알림을 껐어요.");
    } catch (e) { notify(e instanceof Error ? e.message : "알림을 끄지 못했어요.", "error"); }
    finally { setBusy(false); }
  }
  return <section className="settings-section push-settings" aria-busy={busy || checking}>
    <h2><Icon name="bell" /> 새 장소 알림</h2><p className="lead">상대방이 우리 지도에 장소를 담으면 알려드려요.</p>
    {checking ? <p className="hint" role="status">알림 설정을 확인하고 있어요…</p> : <>
      <p className="hint" role="status">{hint || (subscribed ? "이 기기에서 알림을 받고 있어요." : "이 기기의 알림이 꺼져 있어요.")}</p>
      {registration && config?.configured && <button className={`btn${subscribed ? "" : " primary"}`} disabled={busy} onClick={subscribed ? disable : enable}>
        {busy ? "설정 중…" : subscribed ? "이 기기 알림 끄기" : "이 기기에서 알림 받기"}</button>}
      {hint && <button className="text-btn" disabled={busy} onClick={() => setRetry((v) => v + 1)}>다시 확인</button>}
      <p className="hint">기기를 잠그거나 PIN을 바꾸면 알림도 멈춰요. 다시 입장한 뒤 여기에서 켜 주세요.</p>
    </>}
  </section>;
}
