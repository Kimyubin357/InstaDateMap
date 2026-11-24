"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ClientReady from "@/components/ClientReady";
import PageHeader from "@/components/PageHeader";
import PinInput from "@/components/PinInput";
import IdentityOption from "@/components/IdentityOption";
import { useBoardSync } from "@/components/BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";

interface LinkState { available: boolean; linked: string | null }

/**
 * 계정 로그인 전의 "둘만의 PIN" 지도를 이 계정에 연결합니다.
 * PIN을 먼저 확인하고, 그 지도의 이름이 여럿 남아 있을 때만 이름을 고릅니다(이름은 PIN을 맞힌 뒤에만 보입니다).
 */
export default function LinkForm() {
  const sync = useBoardSync();
  const router = useRouter();
  const [state, setState] = useState<LinkState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [choices, setChoices] = useState<string[] | null>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => {
    setLoadError(""); setState(null);
    requestJson<LinkState>("/api/auth/link", { cache: "no-store", notifyBoardChange: false })
      .then(setState)
      .catch((e) => setLoadError(friendlyMessage(e, "연결 정보를 불러오지 못했어요. 다시 시도해 주세요.")));
  };
  useEffect(load, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const res = await requestJson<{ next?: string; choose?: string[] }>("/api/auth/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: choices ? name : "", pin }) });
      if (res.choose) { setChoices(res.choose); setName(""); setBusy(false); return; }
      setPin("");
      // 이 기기의 지도가 바뀌었으니 입장 정보를 다시 받아 기존 지도로 엽니다.
      if (await sync.resetAccess()) { sync.notify("기존 지도를 연결했어요."); router.replace("/"); }
      else setBusy(false);
    } catch (e) {
      setError(friendlyMessage(e, "연결하지 못했어요. 다시 시도해 주세요.")); setPin(""); setChoices(null); setName(""); setBusy(false);
    }
  }
  return <main className="form-page settings-page link-page"><ClientReady><PageHeader title="기존 지도 연결" backHref="/settings" />
    {!state && !loadError && <p className="hint" role="status">연결 정보를 확인하고 있어요…</p>}
    {loadError && <section className="settings-notice"><p className="error" role="alert">{loadError}</p><button type="button" className="btn" onClick={load}>다시 확인</button></section>}
    {state && !state.available && <p className="lead">연결할 수 있는 기존 지도가 없어요.</p>}
    {state?.available && <form className="stack" onSubmit={submit} aria-busy={busy}>
      <p className="lead">로그인 전에 둘만의 PIN으로 쓰던 지도를 이 계정에 연결해요. 연결하면 다음부터는 PIN 없이 로그인만으로 열려요.</p>
      {state.linked && <p className="hint">이미 <b>{state.linked}</b>(으)로 연결되어 있어요. PIN을 입력하면 이 기기에서 기존 지도를 열어요.</p>}
      {choices ? <fieldset className="link-names"><legend>저는 이 지도에서</legend><div className="identity-options settings-identity-options">{choices.map((n) => <IdentityOption key={n} name={n} selected={name === n} disabled={busy} onChoose={() => setName(n)} />)}</div></fieldset>
        : <PinInput label="둘만의 PIN" value={pin} onChange={setPin} disabled={busy} />}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary large" disabled={busy || pin.length !== 6 || (!!choices && !name)}>{busy ? (choices ? "연결하는 중…" : "확인하는 중…") : choices ? "이 이름으로 연결하기" : "기존 지도 연결하기"}</button>
    </form>}
  </ClientReady></main>;
}
