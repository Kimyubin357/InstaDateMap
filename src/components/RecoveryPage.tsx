"use client";

import { useEffect, useRef } from "react";
import Icon from "./Icon";
import "@/app/recovery.css";

/** No board or router dependency: this must work even when the app shell fails. */
export default function RecoveryPage({ missing = false }: { missing?: boolean }) {
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    // Native dialogs live above every z-index and keep the rest of the document inert.
    document.querySelectorAll<HTMLDialogElement>("dialog[data-app-dialog][open]").forEach((dialog) => dialog.close());
    main.current?.focus({ preventScroll: true });
  }, []);

  return <main ref={main} className="app-recovery" tabIndex={-1}>
    <section className="recovery-content" aria-labelledby="recovery-title">
      <div className="recovery-brand"><Icon name="map" /><span>데이트맵</span></div>
      <div className="recovery-message">
        <span className="recovery-symbol"><Icon name={missing ? "link" : "pin"} width="24" /></span>
        <div>
          <h1 id="recovery-title">{missing ? "이 페이지를 찾을 수 없어요" : "잠시 화면을 열지 못했어요"}</h1>
          <p>{missing ? "주소가 바뀌었거나 더 이상 없는 페이지예요. 우리 지도에서 다시 찾아볼까요?" : "연결을 확인한 뒤 다시 시도해 주세요. 우리 지도로 돌아가 다시 시작할 수도 있어요."}</p>
        </div>
      </div>
      <div className="recovery-actions">
        {!missing && <button className="btn primary" onClick={() => window.location.reload()}><Icon name="refresh" width="20" />다시 시도</button>}
        <a className={`btn${missing ? " primary" : ""}`} href="/"><Icon name="map" width="20" />우리 지도 열기</a>
      </div>
    </section>
  </main>;
}
