"use client";
import ClientReady from "@/components/ClientReady";
import { useRef, useState, type CSSProperties } from "react";
import useKeyboardViewport from "@/components/useKeyboardViewport";
import { useRouter } from "next/navigation";
import Image from "next/image";
import PinInput from "@/components/PinInput";
import { requestJson } from "@/lib/client-request";
import pinCouple from "../../../public/illustrations/pin-couple.png";
export default function EnterForm({ configured, next, disabled = false }: { configured: boolean; next: string; disabled?: boolean }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const touchingForm = useRef(false);
  const viewport = useKeyboardViewport();
  const compact = focused || viewport.keyboard;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const data = await requestJson<{ next: string }>("/api/access/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, remember, next }) }); router.replace(data.next); router.refresh(); }
    // On success keep the button disabled until navigation replaces this screen.
    catch (e) { setError(e instanceof Error ? e.message : "다시 시도해 주세요."); setPin(""); setBusy(false); }
  }
  return <main className={`entry-page${compact ? " is-pin-editing" : ""}`} style={viewport.keyboard ? { "--entry-height": `${viewport.height}px`, "--entry-top": `${viewport.top}px` } as CSSProperties : undefined}><ClientReady><div className="wordmark" role="heading" aria-level={1}>데이트맵<span aria-hidden="true">♥</span></div>
    <div className="mascot entry-art"><Image src={pinCouple} alt="서로를 안고 있는 두 캐릭터" sizes="(max-height: 740px) 160px, 240px" priority /></div>
    {configured ? <form ref={form} onSubmit={submit} className="entry-form"
      onFocusCapture={(event) => { if (event.target instanceof HTMLInputElement && event.target.type === "password") setFocused(window.innerWidth < 760); }}
      onBlurCapture={(event) => { if (!touchingForm.current && !event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onPointerDownCapture={() => { touchingForm.current = true; }}
      onPointerUpCapture={() => {
        touchingForm.current = false;
        // Safari may not focus tapped buttons: retain geometry until their click has run.
        requestAnimationFrame(() => { if (!form.current?.contains(document.activeElement)) setFocused(false); });
      }}
      onPointerCancel={() => { touchingForm.current = false; if (!form.current?.contains(document.activeElement)) setFocused(false); }}>
      <PinInput value={pin} onChange={setPin} disabled={disabled} />
      <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />이 기기에서 기억하기</label>
      {error && <p className="error" role="alert">{error}</p>}<button className="btn primary large" disabled={disabled || busy || pin.length !== 6}>{busy ? "지도 여는 중…" : "우리 지도 열기"}</button>
    </form> : <div className="notice entry-notice"><b>우리만의 PIN을 정할 차례예요</b><p>처음 받은 지도 주소로 열면 사귄 날짜로 PIN을 만들 수 있어요.</p></div>}
  </ClientReady></main>;
}
