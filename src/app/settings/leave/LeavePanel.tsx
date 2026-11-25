"use client";
import { useEffect, useRef, useState } from "react";
import ClientReady from "@/components/ClientReady";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/Icon";
import { useBoardSync } from "@/components/BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { FolderSummary, FoldersResponse } from "@/lib/folders";
import type { Profile } from "@/lib/profile";

/**
 * 회원 탈퇴(시안 design-lab/settings 13번): 확인 창 대신 화면 하나로 무엇이 사라지고 남는지 줄로 보여 주고,
 * "확인했어요"를 체크해야 빨간 탈퇴하기가 켜집니다. 혼자 쓰는 방은 삭제, 함께 쓰는 방은 나가기(방장이면 가장 먼저 들어온 멤버에게).
 */
export default function LeavePanel() {
  const sync = useBoardSync();
  const [folders, setFolders] = useState<FolderSummary[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const acting = useRef(false);
  useEffect(() => {
    let alive = true;
    requestJson<FoldersResponse>("/api/folders", { cache: "no-store", notifyBoardChange: false }).then((d) => { if (alive) setFolders(d.folders); })
      .catch((e) => { if (alive) setError(friendlyMessage(e, "탈퇴 정보를 불러오지 못했어요. 다시 시도해 주세요.")); });
    requestJson<Profile>("/api/profile", { cache: "no-store", notifyBoardChange: false }).then((p) => { if (alive) setProfile(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const solo = folders?.filter((f) => f.member_count <= 1) ?? [];
  const shared = folders?.filter((f) => f.member_count > 1) ?? [];
  const owned = shared.filter((f) => f.role === "owner");
  const names = (list: FolderSummary[]) => list.map((f) => f.name).join(" · ");
  async function leave() {
    if (acting.current || !checked || !folders) return;
    acting.current = true; setBusy(true); setError("");
    const resumeOnFailure = !sync.store.isSuspended();
    sync.suspend();
    try {
      await requestJson("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      await sync.lock();
    } catch (e) {
      if (resumeOnFailure) sync.resume();
      setError(friendlyMessage(e, "탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요."));
    } finally { acting.current = false; setBusy(false); }
  }
  const provider = profile?.provider === "kakao" ? "카카오 계정" : profile?.provider === "google" ? "구글 계정" : "";
  return <main className="form-page settings-page has-cta"><PageHeader title="회원 탈퇴" backHref="/settings" /><ClientReady>
    <div className="set-leave-head"><span className="set-leave-icon" aria-hidden="true"><Icon name="trash" width={28} /></span><h2>탈퇴하면 이렇게 돼요</h2>{profile && <p>{profile.name}{provider && ` · ${provider}`}</p>}</div>
    {!folders && !error && <p className="hint" role="status">방 정보를 확인하고 있어요…</p>}
    {folders && <section className="set-group set-leave-list" aria-label="탈퇴하면 바뀌는 것">
      {solo.length > 0 && <div className="set-row"><span className="set-tile is-red"><Icon name="rooms" /></span><span className="set-title">혼자 쓰는 방 {solo.length}곳은 지워져요<small>{names(solo)} · 장소와 메모 포함</small></span></div>}
      {shared.length > 0 && <div className="set-row"><span className="set-tile"><Icon name="user" /></span><span className="set-title">함께 쓰는 방 {shared.length}곳은 남아요<small>{owned.length ? `방장인 방(${names(owned)})은 가장 먼저 들어온 멤버가 방장이 돼요. ` : ""}내가 담은 장소·메모는 그 방에 남아요</small></span></div>}
      <div className="set-row"><span className="set-tile is-gold"><Icon name="lock" /></span><span className="set-title">프로필 · 로그인 연결 · 알림이 지워져요<small>되돌릴 수 없어요</small></span></div>
    </section>}
    {folders && <label className="set-check"><input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} /><span>위 내용을 확인했어요</span></label>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="set-cta"><button type="button" className="btn primary" disabled={!checked || !folders || busy} onClick={() => { void leave(); }}>{busy ? "탈퇴하는 중…" : "탈퇴하기"}</button></div>
  </ClientReady></main>;
}
