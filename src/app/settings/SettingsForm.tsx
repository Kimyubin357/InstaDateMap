"use client";
import ClientReady from "@/components/ClientReady";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PinInput from "@/components/PinInput";
import Icon from "@/components/Icon";
import { requestJson } from "@/lib/client-request";
import { useBoardState, useBoardSync } from "@/components/BoardProvider";
import ActionDialog from "@/components/ActionDialog";
import ShellLink from "@/components/ShellLink";
import PushSettings from "@/components/PushSettings";
import IdentityOption from "@/components/IdentityOption";
import Avatar from "@/components/Avatar";
import { TERMS } from "@/lib/terms";
export default function SettingsForm({ who, names, account = false, onPinChanged }: { who: string; names: string[]; account?: boolean; onPinChanged: (message: string) => void }) {
  const sync = useBoardSync();
  const folderName = useBoardState().snapshot?.board ?? "";
  const [name, setName] = useState(who); const [currentPin, setCurrent] = useState(""); const [newPin, setNew] = useState(""); const [confirmPin, setConfirm] = useState("");
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [locking, setLocking] = useState(false); const [choosing, setChoosing] = useState(false);
  const acting = useRef(false);
  const accessRetry = useRef<HTMLButtonElement>(null);
  const identityToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setName(who); }, [who]);
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    requestJson<{ avatar: string | null }>("/api/profile", { cache: "no-store", notifyBoardChange: false })
      .then((p) => { if (alive) setAvatar(p.avatar); }).catch(() => {});
    return () => { alive = false; };
  }, [account, who]);
  // 광고성 정보 수신(선택 동의): 계정 세션에서만 켜고 끕니다.
  const [marketing, setMarketing] = useState<boolean | null>(null);
  const [marketingBusy, setMarketingBusy] = useState(false);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    requestJson<{ marketing: boolean }>("/api/terms", { cache: "no-store", notifyBoardChange: false }).then((t) => { if (alive) setMarketing(t.marketing); }).catch(() => {});
    return () => { alive = false; };
  }, [account]);
  async function toggleMarketing() {
    if (marketing === null || marketingBusy) return;
    setMarketingBusy(true); setError("");
    try { const r = await requestJson<{ marketing: boolean }>("/api/terms", { method: "PATCH", notifyBoardChange: false, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketing: !marketing }) }); setMarketing(r.marketing); }
    catch (e) { setError(e instanceof Error ? e.message : "수신 동의를 바꾸지 못했어요."); }
    finally { setMarketingBusy(false); }
  }
  // 계정 세션: 연결할 수 있는 기존 PIN 지도가 있을 때만 "기존 지도 연결"을 보여줍니다.
  const [linkable, setLinkable] = useState(false);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    requestJson<{ available: boolean; linked: string | null; names: string[] }>("/api/auth/link", { cache: "no-store", notifyBoardChange: false })
      .then((data) => { if (alive) setLinkable(data.available && (data.linked !== null || data.names.length > 0)); })
      .catch(() => { if (alive) setLinkable(false); });
    return () => { alive = false; };
  }, [account]);
  useEffect(() => {
    if (sync.accessError) { accessRetry.current?.focus({ preventScroll: true }); accessRetry.current?.scrollIntoView({ block: "center" }); }
  }, [sync.accessError]);
  async function action(path: string, body: unknown) {
    if (acting.current) return null;
    acting.current = true;
    setBusy(true); setError("");
    const rotates = path.endsWith("/pin") || path.endsWith("/lock");
    const resumeOnFailure = !sync.store.isSuspended();
    if (rotates) sync.suspend();
    try {
      const data = await requestJson<{ next?: string; message?: string }>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (path.endsWith("/lock")) await sync.lock();
      else if (path.endsWith("/pin")) {
        // The write succeeded: discard the PINs before the separate, retryable context read.
        setCurrent(""); setNew(""); setConfirm(""); setEditing(false);
        await sync.resetAccess(); onPinChanged("PIN을 바꿨어요.");
      }
      else if (path.endsWith("/identity")) { const access = sync.store.getSnapshot().access; if (access) await sync.store.authorize({ ...access, who: (body as { name: string }).name }); }
      return data;
    }
    catch (e) { if (rotates && resumeOnFailure) sync.resume(); setError(e instanceof Error ? e.message : "저장하지 못했어요."); return null; } finally { acting.current = false; setBusy(false); }
  }
  return <main className="form-page settings-page"><ClientReady><PageHeader title="우리 설정" />
    {(sync.checkingAccess || sync.accessError) && <section className="settings-notice" aria-busy={sync.checkingAccess}><p className="hint" role="status">{sync.checkingAccess ? "입장 정보를 확인하고 있어요…" : sync.accessError}</p>{sync.accessError && <button ref={accessRetry} className="btn" onClick={() => { void sync.resetAccess(false); }}>입장 정보 다시 확인</button>}</section>}
    {account && <section className="settings-group" aria-labelledby="settings-folder"><h2 id="settings-folder" className="settings-label">폴더</h2>
      <ShellLink className="settings-row settings-link" href="/folders"><Icon name="map" /><span className="settings-copy"><span>폴더 바꾸기·관리</span><small>새 폴더 만들기, 초대 링크, 멤버</small></span><span className="settings-value">{folderName}</span><Icon name="chevron" width="18" /></ShellLink>
    </section>}
    <section className="settings-group" aria-labelledby="settings-device"><h2 id="settings-device" className="settings-label">이 기기</h2>
      {account ? <ShellLink className="settings-row settings-link" href="/settings/profile"><Avatar src={avatar} size={28} /><span className="settings-copy"><span>프로필</span><small>이름과 사진을 바꿔요</small></span><span className="settings-value">{name}</span><Icon name="chevron" width="18" /></ShellLink>
      : <button ref={identityToggle} className="settings-row" disabled={busy || sync.suspended} onClick={() => setChoosing(!choosing)} aria-expanded={choosing} aria-controls="settings-identity"><Icon name="user" /><span className="settings-copy"><span>쓰는 사람</span><small>장소를 저장할 때 이 이름으로 남겨요</small></span><span className="settings-value">{name}</span><Icon name="chevron" width="18" /></button>}
      {!account && choosing && <div id="settings-identity" className="settings-expand"><div className="identity-options settings-identity-options" role="group" aria-label="이 기기를 쓰는 사람">{names.map((n) => <IdentityOption key={n} name={n} selected={name === n} disabled={busy || sync.suspended} onChoose={async () => { const res = await action("/api/access/identity", { name: n }); if (res) { setName(n); setChoosing(false); identityToggle.current?.focus({ preventScroll: true }); } }} />)}</div></div>}
      <PushSettings />
    </section>
    {account ? <section className="settings-group" aria-labelledby="settings-account"><h2 id="settings-account" className="settings-label">계정</h2>
      {linkable && <ShellLink className="settings-row settings-link" href="/settings/link"><Icon name="map" /><span className="settings-copy"><span>기존 지도 연결</span><small>둘만의 PIN으로 쓰던 지도를 이 계정에서 열어요</small></span><Icon name="chevron" width="18" /></ShellLink>}
      <button className="settings-row" disabled={busy} onClick={() => { setError(""); setLocking(true); }}><Icon name="lock" /><span className="settings-copy"><span>로그아웃</span><small>다음에 열 때 카카오·구글로 다시 로그인해요</small></span><Icon name="chevron" width="18" /></button>
    </section> : <section className="settings-group" aria-labelledby="settings-security"><h2 id="settings-security" className="settings-label">보안</h2>
      <a className="settings-row settings-link" href={`/login?next=${encodeURIComponent("/settings/link")}`}><Icon name="user" /><span className="settings-copy"><span>카카오·구글 계정으로 옮기기</span><small>로그인한 뒤 이 지도를 계정에 연결해요</small></span><Icon name="chevron" width="18" /></a>
      <button className="settings-row" disabled={busy || sync.suspended} onClick={() => setEditing(!editing)} aria-expanded={editing} aria-controls="pin-change-form"><Icon name="lock" /><span className="settings-copy"><span>둘만의 PIN 바꾸기</span><small>다른 기기는 새 PIN으로 다시 열어요</small></span><Icon name="chevron" width="18" /></button>
      {editing && <form id="pin-change-form" className="stack settings-expand" aria-busy={busy} onSubmit={async (e) => { e.preventDefault(); const res = await action("/api/access/pin", { currentPin, newPin, confirmPin }); if (res) { setCurrent(""); setNew(""); setConfirm(""); setEditing(false); } }}><PinInput label="현재 PIN" value={currentPin} onChange={setCurrent} /><PinInput label="새 PIN" value={newPin} onChange={setNew} /><PinInput label="새 PIN 한 번 더" value={confirmPin} onChange={setConfirm} /><button className="btn primary" disabled={busy || sync.suspended || currentPin.length !== 6 || newPin.length !== 6 || newPin !== confirmPin}>{busy ? "바꾸는 중…" : "새 PIN으로 바꾸기"}</button></form>}
      <button className="settings-row" disabled={busy} onClick={() => { setError(""); setLocking(true); }}><Icon name="lock" /><span className="settings-copy"><span>이 기기 잠그기</span><small>다음에 열 때 PIN을 다시 입력해요</small></span><Icon name="chevron" width="18" /></button>
    </section>}
    {account && <section className="settings-group" aria-labelledby="settings-terms"><h2 id="settings-terms" className="settings-label">약관 및 정책</h2>
      <button type="button" className="settings-row" role="switch" aria-checked={marketing === true} disabled={marketing === null || marketingBusy} onClick={() => { void toggleMarketing(); }}><Icon name="bell" /><span className="settings-copy"><span>광고성 정보 수신 (선택)</span><small>{marketing === null ? "동의 상태를 확인하고 있어요…" : marketing ? "새 기능·이벤트 소식을 받아요" : "받지 않아요. 서비스 알림은 그대로 와요"}</small></span><span className="settings-switch" aria-hidden="true" /></button>
      {(["service", "privacy", "location"] as const).map((k) => <a key={k} className="settings-row settings-link" href={`/terms/${k}`}><Icon name="list" /><span className="settings-copy"><span>{TERMS[k].title}</span></span><Icon name="chevron" width="18" /></a>)}
    </section>}
    <section className="settings-group" aria-labelledby="settings-places"><h2 id="settings-places" className="settings-label">장소</h2>
      <ShellLink className="settings-row settings-link" href="/settings/trash"><Icon name="trash" /><span className="settings-copy"><span>삭제한 장소</span><small>복구하거나 영구 삭제해요</small></span><Icon name="chevron" width="18" /></ShellLink>
    </section>
    {error && !locking && <p role="alert" className="error">{error}</p>}
    {locking && <ActionDialog title={account ? "로그아웃할까요?" : "이 기기를 잠글까요?"} message={account ? "다음에 지도를 열 때 카카오·구글로 다시 로그인해요." : "다음에 지도를 열 때 PIN을 다시 입력해야 해요."} tone="info" cancelLabel="취소" confirmLabel={account ? "로그아웃" : "잠그기"} busy={busy} busyLabel={account ? "로그아웃하는 중…" : "잠그는 중…"} onClose={() => { if (!busy) { setLocking(false); setError(""); } }} onConfirm={() => action("/api/access/lock", {}).then(() => undefined)}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}
    </ClientReady></main>;
}
