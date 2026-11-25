"use client";
import Link from "next/link";
import ClientReady from "@/components/ClientReady";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/Icon";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { useBoardSync, useRooms } from "@/components/BoardProvider";
import type { Profile } from "@/lib/profile";
import ActionDialog from "@/components/ActionDialog";
import ShellLink from "@/components/ShellLink";
import Avatar from "@/components/Avatar";
import { requestOnboardingReplay } from "@/lib/onboarding";
import { navigateShell } from "@/lib/shell-navigation";

export default function SettingsForm({ who }: { who: string }) {
  const sync = useBoardSync();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [locking, setLocking] = useState(false);
  const acting = useRef(false);
  const accessRetry = useRef<HTMLButtonElement>(null);
  const [profile, setProfile] = useState<Pick<Profile, "avatar" | "provider"> | null>(null);
  useEffect(() => {
    let alive = true;
    requestJson<Profile>("/api/profile", { cache: "no-store", notifyBoardChange: false })
      .then((p) => { if (alive) setProfile(p); }).catch(() => {});
    return () => { alive = false; };
  }, [who]);
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
  const rooms = useRooms().rooms;
  const providerText = profile?.provider === "kakao" ? "카카오로 로그인" : profile?.provider === "google" ? "구글로 로그인" : "";
  const chevron = <Icon name="chevron" width="18" className="set-chevron" />;
  // 설정(시안 design-lab/settings 1번): 프로필 카드 → 방·장소 → 알림 → 도움, 로그아웃·회원 탈퇴는 맨 아래 작은 글자.
  return <main className="form-page settings-page"><PageHeader title="설정" /><ClientReady>
    {(sync.checkingAccess || sync.accessError) && <section className="settings-notice" aria-busy={sync.checkingAccess}><p className="hint" role="status">{sync.checkingAccess ? "로그인 정보를 확인하고 있어요…" : sync.accessError}</p>{sync.accessError && <button ref={accessRetry} className="btn" onClick={() => { void sync.resetAccess(); }}>다시 확인</button>}</section>}
    <ShellLink className="set-me" href="/settings/profile" aria-label={`프로필: ${who}`}><Avatar src={profile?.avatar ?? null} size={56} /><span className="set-me-copy"><strong>{who}</strong>{providerText && <small>{providerText}</small>}</span>{chevron}</ShellLink>
    <h2 className="set-label">방 · 장소</h2>
    <section className="set-group" aria-label="방 · 장소">
      <ShellLink className="set-row" href="/folders"><span className="set-tile"><Icon name="rooms" /></span><span className="set-title">내 방</span>{rooms && <span className="set-value">{rooms.length}개</span>}{chevron}</ShellLink>
      <ShellLink className="set-row" href="/settings/trash"><span className="set-tile is-red"><Icon name="trash" /></span><span className="set-title">삭제한 장소</span>{chevron}</ShellLink>
    </section>
    <h2 className="set-label">알림</h2>
    <section className="set-group" aria-label="알림">
      <ShellLink className="set-row" href="/settings/notifications"><span className="set-tile is-gold"><Icon name="bell" /></span><span className="set-title">알림</span>{chevron}</ShellLink>
    </section>
    <h2 className="set-label">도움</h2>
    <section className="set-group" aria-label="도움">
      <button type="button" className="set-row" onClick={() => { requestOnboardingReplay(); navigateShell("/"); }}><span className="set-tile is-navy"><Icon name="book" /></span><span className="set-title">사용법 다시 보기</span>{chevron}</button>
      <Link className="set-row" href="/terms"><span className="set-tile is-navy"><Icon name="list" /></span><span className="set-title">약관 및 정책</span>{chevron}</Link>
    </section>
    <div className="set-foot"><button type="button" disabled={busy} onClick={() => { setError(""); setLocking(true); }}>로그아웃</button><span aria-hidden="true">·</span><ShellLink href="/settings/leave">회원 탈퇴</ShellLink></div>
    {error && !locking && <p role="alert" className="error">{error}</p>}
    {locking && <ActionDialog title="로그아웃할까요?" message="다음에 지도를 열 때 카카오·구글로 다시 로그인해요." tone="info" cancelLabel="취소" confirmLabel="로그아웃" busy={busy} busyLabel="로그아웃하는 중…" onClose={() => { if (!busy) { setLocking(false); setError(""); } }} onConfirm={() => signOut("/api/access/lock", "POST")}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}
    </ClientReady></main>;
}
