"use client";
import { useState, type CSSProperties } from "react";
import Icon from "@/components/Icon";
import { ProviderButtons } from "@/app/login/LoginScreen";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { InvitePreview } from "@/lib/folders";
import styles from "@/app/login/Login.module.css";
import invite from "./Invite.module.css";

/** 초대 링크 화면: 폴더 미리보기 → (로그인) → 참여하고 그 폴더 열기 */
export default function InviteScreen({ token, preview, loggedIn }: { token: string; preview: InvitePreview | null; loggedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = `/invite/${token}`;
  async function join() {
    if (busy) return;
    setBusy(true); setError("");
    try { await requestJson(`/api/invites/${token}`, { method: "POST", notifyBoardChange: false }); window.location.assign("/"); }
    catch (e) { setError(friendlyMessage(e, "방에 참여하지 못했어요. 다시 시도해 주세요.")); setBusy(false); }
  }
  const valid = preview && preview.code !== "INVITE_INVALID";
  const title = !preview ? "초대 정보를 불러오지 못했어요" : !valid ? "쓸 수 없는 초대 링크예요" : `‘${preview.name}’ 방에\n초대받았어요`;
  const subtitle = !preview ? "잠시 후 다시 열어 주세요." : !valid ? "링크가 만료됐거나 끊겼어요. 방장에게 새 링크를 받아 주세요."
    : `${preview.owner ? `${preview.owner}님의 방 · ` : ""}멤버 ${preview.member_count}/${preview.member_limit}명`;
  return <main className={styles.page}>
    <section className={styles.hero}>
      <div className={invite.cover} style={{ "--folder-color": `var(--folder-${valid ? preview.color : "forest"})` } as CSSProperties} aria-hidden="true"><Icon name={valid ? preview.icon! : "link"} width={56} /></div>
      <h1 className={`${styles.title} ${invite.title}`}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>
    </section>
    <section className={styles.actions} aria-label="참여하기">
      {error && <p className={styles.error} role="alert">{error}</p>}
      {valid && preview.code === "FOLDER_FULL" && <p className={styles.error} role="alert">이 방은 인원이 가득 찼어요.</p>}
      {valid && preview.code !== "FOLDER_FULL" && (loggedIn
        ? <button type="button" className={`btn primary large ${invite.join}`} disabled={busy} onClick={() => { void join(); }}>{busy ? "여는 중…" : preview.code === "ALREADY_MEMBER" ? "방 열기" : "참여하기"}</button>
        : <><p className={invite.hint}>로그인하면 바로 참여해요</p><ProviderButtons next={next} /></>)}
      {(!valid || preview?.code === "FOLDER_FULL") && <a className={`btn large ${invite.join}`} href={loggedIn ? "/" : "/login"}>{loggedIn ? "내 지도 열기" : "로그인 화면으로"}</a>}
    </section>
  </main>;
}
