"use client";
import ClientReady from "@/components/ClientReady";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PinInput from "@/components/PinInput";
import Icon from "@/components/Icon";
import { requestJson } from "@/lib/client-request";
import { useBoardSync } from "@/components/BoardProvider";
import ActionDialog from "@/components/ActionDialog";
export default function SettingsForm({ who, names, onPinChanged }: { who: string; names: string[]; onPinChanged: (message: string) => void }) {
  const sync = useBoardSync();
  const [name, setName] = useState(who); const [currentPin, setCurrent] = useState(""); const [newPin, setNew] = useState(""); const [confirmPin, setConfirm] = useState("");
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [locking, setLocking] = useState(false);
  useEffect(() => { setName(who); }, [who]);
  async function action(path: string, body: unknown) {
    setBusy(true); setError("");
    const rotates = path.endsWith("/pin") || path.endsWith("/lock"); if (rotates) sync.suspend();
    try {
      const data = await requestJson<{ next?: string; message?: string }>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (path.endsWith("/lock")) await sync.lock();
      else if (path.endsWith("/pin")) { await sync.resetAccess(); onPinChanged(data.message || "PIN을 바꿨어요."); }
      else if (path.endsWith("/identity")) { const access = sync.store.getSnapshot().access; if (access) await sync.store.authorize({ ...access, who: (body as { name: string }).name }); }
      return data;
    }
    catch (e) { if (rotates) sync.resume(); setError(e instanceof Error ? e.message : "저장하지 못했어요."); return null; } finally { setBusy(false); }
  }
  return <main className="form-page"><ClientReady><PageHeader title="우리 설정" /><section className="settings-section"><h2>이 기기의 주인</h2><p className="lead">장소를 저장할 때 이 이름으로 남겨요.</p><div className="seg two">{names.map((n) => <button key={n} disabled={busy} aria-pressed={name === n} onClick={async () => { const res = await action("/api/access/identity", { name: n }); if (res) { setName(n); sync.notify(`${n}님의 기기로 기억할게요.`); } }}>{n}</button>)}</div></section>
    <section className="settings-section"><button className="settings-row" disabled={busy} onClick={() => setEditing(!editing)} aria-expanded={editing} aria-controls="pin-change-form"><Icon name="lock" /><span>둘만의 PIN 바꾸기</span><Icon name="chevron" /></button>
    {editing && <form id="pin-change-form" className="stack" aria-busy={busy} onSubmit={async (e) => { e.preventDefault(); const res = await action("/api/access/pin", { currentPin, newPin, confirmPin }); if (res) { setCurrent(""); setNew(""); setConfirm(""); setEditing(false); } }}><p className="hint">다른 기기에서는 새 PIN으로 다시 열어 주세요.</p><PinInput label="현재 PIN" value={currentPin} onChange={setCurrent} /><PinInput label="새 PIN" value={newPin} onChange={setNew} /><PinInput label="새 PIN 한 번 더" value={confirmPin} onChange={setConfirm} /><button className="btn primary" disabled={busy || currentPin.length !== 6 || newPin.length !== 6 || newPin !== confirmPin}>{busy ? "바꾸는 중…" : "새 PIN으로 바꾸기"}</button></form>}</section>
    <section className="settings-section"><button className="settings-row" disabled={busy} onClick={() => { setError(""); setLocking(true); }}><Icon name="lock" /><span>이 기기 잠그기</span></button><p className="hint">다음에 열 때 PIN을 다시 입력해요.</p></section>
    <section className="settings-section"><h2>인스타에서 더 쉽게 저장하기</h2><p className="hint">공유 단축어에서 인스타 링크를 받아 이 앱의 <code>/add?url=공유링크</code> 주소를 열어 주세요. 예전 단축어는 새 방식으로 바꿔야 해요.</p></section>
    {error && !locking && <p role="alert" className="error">{error}</p>}
    {locking && <ActionDialog title="이 기기를 잠글까요?" message="다음에 지도를 열 때 PIN을 다시 입력해야 해요." tone="info" cancelLabel="취소" confirmLabel="잠그기" busy={busy} busyLabel="잠그는 중…" onClose={() => { if (!busy) { setLocking(false); setError(""); } }} onConfirm={() => action("/api/access/lock", {}).then(() => undefined)}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}
    </ClientReady></main>;
}
