"use client";
import ClientReady from "@/components/ClientReady";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PinInput from "@/components/PinInput";
import { requestJson } from "@/lib/client-request";
export default function SetupForm({ names, next }: { names: string[]; next: string }) {
  const router = useRouter();
  const [date, setDate] = useState(""); const [first, setFirst] = useState(names[0] || ""); const [second, setSecond] = useState(names[1] || "");
  const [confirmPin, setConfirmPin] = useState(""); const [remember, setRemember] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const pin = date.length === 10 ? date.slice(2).replaceAll("-", "") : "";
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const res = await requestJson<{ next: string }>("/api/access/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, confirmPin, names: [first, second], remember, next }) }); router.replace(res.next); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "설정하지 못했어요."); } finally { setBusy(false); }
  }
  return <main className="form-page"><ClientReady><div className="wordmark small">데이트맵<span>♥</span></div><h1>우리 지도에 이름을 붙여요</h1><p className="lead">사귄 날의 여섯 자리로 둘만의 지도를 열어요.</p>
    <form onSubmit={submit} className="stack"><label className="form-label">우리가 사귀기 시작한 날<input className="field" type="date" value={date} onChange={(e) => { setDate(e.target.value); setConfirmPin(""); }} required /></label>
    {pin && <div className="notice">우리의 첫 PIN은 <strong className="generated-pin">{pin}</strong>이에요.<small>설정에서 다른 여섯 자리로 바꿀 수 있어요.</small></div>}
    <div className="name-fields"><label className="form-label">한 사람의 이름<input className="field" aria-label="한 사람의 이름" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={20} required /></label>
    <label className="form-label">다른 사람의 이름<input className="field" aria-label="다른 사람의 이름" value={second} onChange={(e) => setSecond(e.target.value)} maxLength={20} required /></label></div>
    <p className="hint">두 사람의 이름으로 고칠 수 있어요. 예전 장소의 저장자 기록은 그대로 남아요.</p>
    <PinInput label="우리 PIN 한 번 더 확인" value={confirmPin} onChange={setConfirmPin} />
    <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />이 기기에서 기억하기</label>
    {error && <p role="alert" className="error">{error}</p>}<button className="btn primary large" disabled={busy || !pin || pin !== confirmPin || !first.trim() || !second.trim()}>{busy ? "우리 지도 만드는 중…" : "우리 지도 시작하기"}</button></form></ClientReady></main>;
}
