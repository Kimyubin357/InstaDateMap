"use client";
import ClientReady from "@/components/ClientReady";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/Icon";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { useBoardState, useBoardSync } from "@/components/BoardProvider";
import ActionDialog from "@/components/ActionDialog";
import ShellLink from "@/components/ShellLink";
import PushSettings from "@/components/PushSettings";
import Avatar from "@/components/Avatar";
import type { FoldersResponse } from "@/lib/folders";
import { marketingResultNotice } from "@/lib/terms";

/** 탈퇴하면 사라지는 것: 혼자 쓰는 폴더는 삭제, 함께 쓰는 폴더는 나가기(방장이면 다음 멤버에게 넘김) */
function leaveSummary(data: FoldersResponse) {
  const solo = data.folders.filter((f) => f.member_count <= 1);
  const shared = data.folders.filter((f) => f.member_count > 1);
  const lines: string[] = [];
  if (solo.length) lines.push(`혼자 쓰는 폴더 ${solo.length}개(${solo.map((f) => f.name).join(", ")})는 장소·메모와 함께 삭제돼요.`);
  if (shared.length) lines.push(`함께 쓰는 폴더 ${shared.length}개(${shared.map((f) => f.name).join(", ")})에서는 나가요. 남긴 장소·메모는 그 폴더에 남아요.`);
  return lines;
}

export default function SettingsForm({ who }: { who: string }) {
  const sync = useBoardSync();
  const folderName = useBoardState().snapshot?.board ?? "";
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [locking, setLocking] = useState(false);
  const [leaving, setLeaving] = useState<string[] | null>(null);
  const acting = useRef(false);
  const accessRetry = useRef<HTMLButtonElement>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    requestJson<{ avatar: string | null }>("/api/profile", { cache: "no-store", notifyBoardChange: false })
      .then((p) => { if (alive) setAvatar(p.avatar); }).catch(() => {});
    return () => { alive = false; };
  }, [who]);
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
    setMarketingBusy(true); setError("");
    try {
      const r = await requestJson<{ marketing: boolean; updated_at?: string }>("/api/terms", { method: "PATCH", notifyBoardChange: false, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketing: !marketing }) });
      setMarketing(r.marketing);
      // 동의·철회 결과(전송자·처리 날짜·결과)를 바로 알립니다(정보통신망법 제50조 제7항).
      sync.notify(marketingResultNotice(r.marketing, r.updated_at ? new Date(r.updated_at) : new Date()), "info");
    }
    catch (e) { setError(e instanceof Error ? e.message : "수신 동의를 바꾸지 못했어요."); }
    finally { setMarketingBusy(false); }
  }
  useEffect(() => {
    if (sync.accessError) { accessRetry.current?.focus({ preventScroll: true }); accessRetry.current?.scrollIntoView({ block: "center" }); }
  }, [sync.accessError]);
  /** 로그아웃·탈퇴: 서버 세션을 지운 뒤 이 기기의 지도 상태도 비우고 로그인 화면으로 갑니다. */
  async function signOut(path: string, method: "POST" | "DELETE") {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError("");
    const resumeOnFailure = !sync.store.isSuspended();
    sync.suspend();
    try {
      await requestJson(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      await sync.lock();
    } catch (e) {
      if (resumeOnFailure) sync.resume();
      setError(friendlyMessage(e, method === "DELETE" ? "탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요." : "로그아웃하지 못했어요. 다시 시도해 주세요."));
    } finally { acting.current = false; setBusy(false); }
  }
  async function openLeave() {
    if (busy) return;
    setError(""); setBusy(true);
    try { setLeaving(leaveSummary(await requestJson<FoldersResponse>("/api/folders", { cache: "no-store", notifyBoardChange: false }))); }
    catch (e) { setError(friendlyMessage(e, "탈퇴 정보를 불러오지 못했어요. 다시 시도해 주세요.")); }
    finally { setBusy(false); }
  }
  return <main className="form-page settings-page"><ClientReady><PageHeader title="우리 설정" />
    {(sync.checkingAccess || sync.accessError) && <section className="settings-notice" aria-busy={sync.checkingAccess}><p className="hint" role="status">{sync.checkingAccess ? "입장 정보를 확인하고 있어요…" : sync.accessError}</p>{sync.accessError && <button ref={accessRetry} className="btn" onClick={() => { void sync.resetAccess(false); }}>입장 정보 다시 확인</button>}</section>}
    <section className="settings-group" aria-labelledby="settings-folder"><h2 id="settings-folder" className="settings-label">폴더</h2>
      <ShellLink className="settings-row settings-link" href="/folders"><Icon name="map" /><span className="settings-copy"><span>폴더 바꾸기·관리</span><small>새 폴더 만들기, 초대 링크, 멤버</small></span><span className="settings-value">{folderName}</span><Icon name="chevron" width="18" /></ShellLink>
    </section>
    <section className="settings-group" aria-labelledby="settings-device"><h2 id="settings-device" className="settings-label">이 기기</h2>
      <ShellLink className="settings-row settings-link" href="/settings/profile"><Avatar src={avatar} size={28} /><span className="settings-copy"><span>프로필</span><small>이름과 사진을 바꿔요</small></span><span className="settings-value">{who}</span><Icon name="chevron" width="18" /></ShellLink>
      <PushSettings />
    </section>
    <section className="settings-group" aria-labelledby="settings-account"><h2 id="settings-account" className="settings-label">계정</h2>
      <button className="settings-row" disabled={busy} onClick={() => { setError(""); setLocking(true); }}><Icon name="lock" /><span className="settings-copy"><span>로그아웃</span><small>다음에 열 때 카카오·구글로 다시 로그인해요</small></span><Icon name="chevron" width="18" /></button>
    </section>
    <section className="settings-group" aria-labelledby="settings-terms"><h2 id="settings-terms" className="settings-label">약관 및 정책</h2>
      <button type="button" className="settings-row" role="switch" aria-checked={marketing === true} disabled={marketing === null || marketingBusy} onClick={() => { void toggleMarketing(); }}><Icon name="bell" /><span className="settings-copy"><span>광고성 정보 수신 (선택)</span><small>{marketing === null ? "동의 상태를 확인하고 있어요…" : marketing ? "새 기능·이벤트 소식을 받아요" : "받지 않아요. 서비스 알림은 그대로 와요"}</small></span><span className="settings-switch" aria-hidden="true" /></button>
      <a className="settings-row settings-link" href="/terms"><Icon name="list" /><span className="settings-copy"><span>약관 보기</span><small>이용약관·개인정보 처리방침·위치기반서비스</small></span><Icon name="chevron" width="18" /></a>
    </section>
    <section className="settings-group" aria-labelledby="settings-places"><h2 id="settings-places" className="settings-label">장소</h2>
      <ShellLink className="settings-row settings-link" href="/settings/trash"><Icon name="trash" /><span className="settings-copy"><span>삭제한 장소</span><small>복구하거나 영구 삭제해요</small></span><Icon name="chevron" width="18" /></ShellLink>
    </section>
    <button type="button" className="text-btn settings-leave" disabled={busy} onClick={() => { void openLeave(); }}>회원 탈퇴</button>
    {error && !locking && !leaving && <p role="alert" className="error">{error}</p>}
    {locking && <ActionDialog title="로그아웃할까요?" message="다음에 지도를 열 때 카카오·구글로 다시 로그인해요." tone="info" cancelLabel="취소" confirmLabel="로그아웃" busy={busy} busyLabel="로그아웃하는 중…" onClose={() => { if (!busy) { setLocking(false); setError(""); } }} onConfirm={() => signOut("/api/access/lock", "POST")}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}
    {leaving && <ActionDialog title="정말 탈퇴할까요?" destructive cancelLabel="취소" confirmLabel="탈퇴하기" busy={busy} busyLabel="탈퇴하는 중…" onClose={() => { if (!busy) { setLeaving(null); setError(""); } }} onConfirm={() => signOut("/api/account", "DELETE")}>
      <div className="settings-leave-detail">
        {leaving.map((line) => <p key={line}>{line}</p>)}
        <p>프로필·로그인 연결·알림 설정이 지워지고 되돌릴 수 없어요.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </ActionDialog>}
    </ClientReady></main>;
}
