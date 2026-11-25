"use client";
import { useEffect, useState } from "react";
import ClientReady from "@/components/ClientReady";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/Icon";
import PushSettings from "@/components/PushSettings";
import { useBoardSync } from "@/components/BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { marketingResultNotice } from "@/lib/terms";

/**
 * 알림 설정(레퍼런스: 알림 항목을 한 화면에 모음, 2026-11-25).
 * 앱 알림(기기 권한) → 새 장소·메모 알림(폴더별) → 광고성 정보 수신.
 */
export default function NotificationsPanel() {
  const { notify } = useBoardSync();
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
  // 알림(시안 design-lab/settings 7·8번): 알림 받기 스위치 하나 → 방별 스위치 → 광고는 맨 아래 따로.
  return <main className="form-page settings-page"><PageHeader title="알림" backHref="/settings" /><ClientReady>
    <PushSettings />
    <h2 className="set-label">광고</h2>
    <section className="set-group" aria-label="광고">
      <button type="button" className="set-row" role="switch" aria-checked={marketing === true} disabled={marketing === null || marketingBusy} onClick={() => { void toggleMarketing(); }}><span className="set-title">광고성 정보 받기 <small>선택</small></span><span className="set-switch" aria-hidden="true" /></button>
      <a className="set-row" href="/terms/marketing"><span className="set-title">동의 내용 보기</span><Icon name="chevron" width="18" className="set-chevron" /></a>
    </section>
  </ClientReady></main>;
}
