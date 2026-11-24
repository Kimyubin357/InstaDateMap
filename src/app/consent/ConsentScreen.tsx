"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import TermsDocument from "@/components/TermsDocument";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { marketingResultNotice, TERMS, TERMS_ORDER, type TermsKey } from "@/lib/terms";
import styles from "@/components/Terms.module.css";

/** 레퍼런스 구성: 안내 → 전체 동의 상자 → 필수 3개·선택 1개 → 동의하고 시작하기. ›를 누르면 본문을 전체 화면으로 봅니다. */
export default function ConsentScreen({ next }: { next: string }) {
  const [checked, setChecked] = useState<Record<TermsKey, boolean>>({ service: false, privacy: false, location: false, marketing: false });
  const [reading, setReading] = useState<TermsKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reader = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const all = TERMS_ORDER.every((k) => checked[k]);
  const required = TERMS_ORDER.filter((k) => TERMS[k].required).every((k) => checked[k]);
  useEffect(() => { if (reading) reader.current?.showModal(); else if (reader.current?.open) reader.current.close(); }, [reading]);

  async function submit() {
    if (!required || busy) return;
    setBusy(true); setError("");
    try {
      await requestJson("/api/terms", { method: "POST", notifyBoardChange: false, headers: { "Content-Type": "application/json" }, body: JSON.stringify(checked) });
      // 광고성 정보 수신에 동의했으면 처리 결과(전송자·날짜·결과)를 보여 준 뒤 이동합니다(정보통신망법 제50조 제7항).
      if (checked.marketing) { setNotice(marketingResultNotice(true)); await new Promise((r) => setTimeout(r, 1800)); }
      window.location.assign(next);
    }
    catch (e) { setError(friendlyMessage(e, "동의를 저장하지 못했어요. 다시 시도해 주세요.")); setBusy(false); }
  }
  async function leave() {
    // 동의하지 않고 나가면 로그인을 끝내고 로그인 화면으로 돌아갑니다.
    try { await requestJson("/api/access/lock", { method: "POST", notifyBoardChange: false, headers: { "Content-Type": "application/json" }, body: "{}" }); } catch { /* 이미 끝난 로그인 */ }
    window.location.assign("/login");
  }
  return <main className={styles.consent}>
    <header className={styles.consentHeader}><button type="button" className="icon-btn" aria-label="동의하지 않고 로그인 화면으로" disabled={busy} onClick={() => { void leave(); }}><Icon name="back" /></button><h1>약관 동의</h1><span /></header>
    <div className={styles.consentBody}>
      <section className={styles.intro}><span className={styles.mark} aria-hidden="true"><Icon name="map" width={30} /></span><h2>{"이용을 위해\n서비스 약관 동의가 필요해요"}</h2></section>
      <section className={styles.side} aria-label="약관 동의">
        <div className={styles.choices}>
          <label className={styles.all}><input type="checkbox" className={styles.box} checked={all} disabled={busy} onChange={(e) => setChecked({ service: e.target.checked, privacy: e.target.checked, location: e.target.checked, marketing: e.target.checked })} />전체 동의 (선택 항목 포함)</label>
          {TERMS_ORDER.map((k) => <div key={k} className={styles.row}>
            <label><input type="checkbox" className={styles.box} checked={checked[k]} disabled={busy} onChange={(e) => setChecked({ ...checked, [k]: e.target.checked })} /><span><span className={`${styles.tag}${TERMS[k].required ? "" : ` ${styles.optional}`}`}>[{TERMS[k].required ? "필수" : "선택"}]</span> {TERMS[k].title}</span></label>
            <button type="button" className={styles.view} aria-label={`${TERMS[k].title} 전문 보기`} onClick={(e) => { opener.current = e.currentTarget; setReading(k); }}><Icon name="chevron" width="20" /></button>
          </div>)}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="hint" role="status">{notice}</p>}
        <button type="button" className={`btn primary large ${styles.submit}`} disabled={!required || busy} onClick={() => { void submit(); }}>{busy ? "시작하는 중…" : "동의하고 시작하기"}</button>
      </section>
    </div>
    <dialog ref={reader} className={styles.reader} aria-labelledby="terms-reader-title" onClose={() => { setReading(null); opener.current?.focus(); }}>
      {reading && <div className={styles.readerInner}><div>
        <header className="page-header"><button type="button" className="icon-btn" aria-label="닫기" onClick={() => setReading(null)}><Icon name="back" /></button><h1 id="terms-reader-title">{TERMS[reading].title}</h1><span className="header-spacer" /></header>
        <TermsDocument doc={reading} headingId="terms-reader-title" />
        {!checked[reading] && <button type="button" className="btn primary large" onClick={() => { setChecked({ ...checked, [reading]: true }); setReading(null); }}>동의하기</button>}
      </div></div>}
    </dialog>
  </main>;
}
