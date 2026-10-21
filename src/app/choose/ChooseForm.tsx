"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { requestJson } from "@/lib/client-request";
export default function ChooseForm({ names, next }: { names: string[]; next: string }) {
  const router = useRouter();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function choose(name: string) {
    setBusy(true); setError("");
    try { const data = await requestJson<{ next: string }>("/api/access/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, next }) }); router.replace(data.next); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "다시 골라 주세요."); setBusy(false); }
  }
  return <main className="entry-page choose-page"><div className="wordmark small">데이트맵<span>♥</span></div><div className="mascot"><Image src="/couple.png" alt="함께 있는 두 캐릭터" width={1792} height={875} /></div><h1>이 기기는 누가 쓰나요?</h1><p className="entry-subtitle">누가 발견한 장소인지 기억해 둘게요.</p><div className="identity-options">{names.map((name, i) => <button className={`identity-option person-${i}`} key={name} disabled={busy || !ready} onClick={() => choose(name)}><span className="person-face" aria-hidden="true">{i ? "◡" : "ᴗ"}</span>{name}</button>)}</div>{error && <p role="alert" className="error">{error}</p>}</main>;
}
