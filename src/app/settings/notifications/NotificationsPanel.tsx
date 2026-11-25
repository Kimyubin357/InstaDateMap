"use client";
import { useEffect, useState } from "react";
import ClientReady from "@/components/ClientReady";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/Icon";
import PushSettings from "@/components/PushSettings";
import { useBoardSync } from "@/components/BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { marketingResultNotice } from "@/lib/terms";

type Permission = NotificationPermission | "unsupported";
const PERMISSION_TEXT: Record<Permission, string> = {
  granted: "켜져 있어요. 끄려면 휴대폰 설정에서 바꿔 주세요.",
  denied: "꺼져 있어요. 휴대폰 설정 → 데이트맵 → 알림에서 켜 주세요.",
  default: "아래 알림을 켜면 허용할지 물어봐요.",
  unsupported: "이 브라우저에서는 알림을 받을 수 없어요. 홈 화면에 추가한 앱에서 열어 주세요.",
};

/**
 * 알림 설정(레퍼런스: 알림 항목을 한 화면에 모음, 2026-11-25).
 * 앱 알림(기기 권한) → 새 장소·메모 알림(폴더별) → 광고성 정보 수신.
 */
export default function NotificationsPanel() {
  const { notify } = useBoardSync();
  const [permission, setPermission] = useState<Permission>("default");
  useEffect(() => {
    const read = () => setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    read();
    const onVisible = () => { if (document.visibilityState === "visible") read(); };
    window.addEventListener("focus", read); document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", read); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  // 광고성 정보 수신(선택 동의)
  const [marketing, setMarketing] = useState<boolean | null>(null);
  const [marketingBusy, setMarketingBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    requestJson<{ marketing: boolean }>("/api/terms", { cache: "no-store", notifyBoardChange: false }).then((t) => { if (alive) setMarketing(t.marketing); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  async function toggleMarketing() {
    if (marketing === null || marketingBusy) return;
    setMarketingBusy(true);
    try {
      const r = await requestJson<{ marketing: boolean; updated_at?: string }>("/api/terms", { method: "PATCH", notifyBoardChange: false, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketing: !marketing }) });
      setMarketing(r.marketing);
      // 동의·철회 결과(전송자·처리 날짜·결과)를 바로 알립니다(정보통신망법 제50조 제7항).
      notify(marketingResultNotice(r.marketing, r.updated_at ? new Date(r.updated_at) : new Date()), "info");
    } catch (e) { notify(friendlyMessage(e, "수신 동의를 바꾸지 못했어요."), "error"); }
    finally { setMarketingBusy(false); }
  }
  return <main className="form-page settings-page"><PageHeader title="알림 설정" backHref="/settings" /><ClientReady>
    <section className="settings-group" aria-labelledby="notify-device"><h2 id="notify-device" className="settings-label">이 기기</h2>
      <div className="settings-row notify-permission" role="status"><Icon name="bell" /><span className="settings-copy"><span>앱 알림</span><small>{PERMISSION_TEXT[permission]}</small></span></div>
    </section>
    <section className="settings-group" aria-labelledby="notify-places"><h2 id="notify-places" className="settings-label">장소 소식</h2>
      <PushSettings />
    </section>
    <section className="settings-group" aria-labelledby="notify-ads"><h2 id="notify-ads" className="settings-label">광고</h2>
      <button type="button" className="settings-row" role="switch" aria-checked={marketing === true} disabled={marketing === null || marketingBusy} onClick={() => { void toggleMarketing(); }}><Icon name="bell" /><span className="settings-copy"><span>광고성 정보 수신 (선택)</span><small>{marketing === null ? "동의 상태를 확인하고 있어요…" : marketing ? "새 기능·이벤트 소식을 받아요" : "받지 않아요. 장소 소식 알림은 그대로 와요"}</small></span><span className="settings-switch" aria-hidden="true" /></button>
      <a className="settings-row settings-link" href="/terms/marketing"><Icon name="list" /><span className="settings-copy"><span>광고성 정보 수신 동의 내용</span></span><Icon name="chevron" width="18" /></a>
    </section>
  </ClientReady></main>;
}
