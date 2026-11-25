"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { MAX_AVATAR_LENGTH, PROVIDER_LABEL, type AvatarMode, type Profile } from "@/lib/profile";
import styles from "./Profile.module.css";

/** 고른 사진을 가운데 기준 256px 정사각형으로 줄여 저장합니다(원본은 올리지 않음). */
async function toAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("사진 파일을 골라 주세요.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("이 사진을 열지 못했어요. 다른 사진을 골라 주세요.")); img.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("이 사진을 열지 못했어요. 다른 사진을 골라 주세요.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    canvas.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    for (const [type, quality] of [["image/webp", .85], ["image/jpeg", .85], ["image/jpeg", .65]] as const) {
      const data = canvas.toDataURL(type, quality);
      if (data.startsWith(`data:${type}`) && data.length <= MAX_AVATAR_LENGTH * .95) return data;
    }
    throw new Error("사진이 너무 커요. 다른 사진을 골라 주세요.");
  } finally { URL.revokeObjectURL(url); }
}

/** 사진을 탭하면 여는 선택 창: 앨범에서 고르기 / 카카오·구글 사진 / 사진 없이 */
function PhotoMenu({ providerLabel, hasProvider, hasPhoto, onPick, onClose }: {
  providerLabel: string | null; hasProvider: boolean; hasPhoto: boolean; onPick: (choice: "upload" | "provider" | "none") => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  return createPortal(<dialog ref={ref} className={styles.menu} aria-labelledby="profile-photo-menu"
    onCancel={(e) => { e.preventDefault(); onClose(); }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <h2 id="profile-photo-menu">프로필 사진</h2>
    <button type="button" onClick={() => onPick("upload")}><Icon name="image" width="20" />앨범에서 고르기</button>
    {hasProvider && providerLabel && <button type="button" onClick={() => onPick("provider")}><Icon name="user" width="20" />{providerLabel} 사진으로</button>}
    {hasPhoto && <button type="button" className={styles.menuDanger} onClick={() => onPick("none")}><Icon name="trash" width="20" />사진 없이</button>}
    <button type="button" className={styles.menuCancel} onClick={onClose} autoFocus>취소</button>
  </dialog>, document.body);
}

/**
 * 프로필 수정(레퍼런스: 가운데 큰 사진 + 카메라 표시, 닉네임 칸, 아래 저장 버튼).
 * 사진을 탭하면 앨범·카카오/구글 사진·사진 없이 중에서 고릅니다. 짧은 가로 화면은 왼쪽 사진 / 오른쪽 이름·저장입니다.
 */
export default function ProfileEditor({ initial, submitLabel, busyLabel = "저장하는 중…", onSaved, requireChange = false }: {
  initial: Profile; submitLabel: string; busyLabel?: string; onSaved: (profile: Profile) => void | Promise<void>; requireChange?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [mode, setMode] = useState<AvatarMode>("keep");
  const [custom, setCustom] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const photoButton = useRef<HTMLButtonElement>(null);
  const preview = mode === "keep" ? initial.avatar : mode === "provider" ? initial.provider_avatar : mode === "custom" ? custom : null;
  const trimmed = name.replace(/\s+/g, " ").trim();
  const unchanged = trimmed === initial.name && mode === "keep";
  const providerLabel = initial.provider ? PROVIDER_LABEL[initial.provider] : null;

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setError("");
    try { setCustom(await toAvatar(chosen)); setMode("custom"); }
    catch (e) { setError(e instanceof Error ? e.message : "사진을 열지 못했어요."); }
  }
  function choose(choice: "upload" | "provider" | "none") {
    setMenu(false);
    if (choice === "upload") file.current?.click();
    else { setMode(choice); photoButton.current?.focus({ preventScroll: true }); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !trimmed || (requireChange && unchanged)) return;
    setBusy(true); setError("");
    try {
      const saved = await requestJson<Profile>("/api/profile", { method: "PATCH", notifyBoardChange: false, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, avatar_mode: mode, avatar: mode === "custom" ? custom : null }) });
      await onSaved(saved);
      setMode("keep"); setCustom(null);
    } catch (e) { setError(friendlyMessage(e, "저장하지 못했어요. 다시 시도해 주세요.")); }
    finally { setBusy(false); }
  }

  return <form className={styles.editor} onSubmit={submit} aria-busy={busy}>
    <div className={styles.photo}>
      <button ref={photoButton} type="button" className={styles.photoButton} disabled={busy} onClick={() => setMenu(true)} aria-haspopup="dialog" aria-label={preview ? "프로필 사진 바꾸기" : "프로필 사진 넣기"}>
        <Avatar src={preview} size={112} />
        <span className={styles.cameraBadge} aria-hidden="true"><Icon name="camera" width="18" /></span>
      </button>
      <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
    </div>
    <div className={styles.fields}>
      {/* 설정 리디자인(시안 design-lab/settings 2번): 라벨 "이름" + 글자 수, 설명 문장 없이. 로그인 계정은 아래 한 줄. */}
      <label className={styles.name}><span className={styles.nameLabel}><span>이름</span><small>{name.length}/20</small></span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="예: 유빈" autoComplete="nickname" enterKeyHint="done" disabled={busy} />
      </label>
      {providerLabel && <div className={styles.account}><span className={styles.accountLabel}>로그인 계정</span><div className="set-group"><div className="set-row"><span className={`${styles.providerMark} ${styles[initial.provider ?? "kakao"]}`} aria-hidden="true" /><span className="set-title">{providerLabel}</span></div></div></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className={styles.saveBar}><button className="btn primary green large" disabled={busy || !trimmed || (requireChange && unchanged)}>{busy ? busyLabel : submitLabel}</button></div>
    </div>
    {menu && <PhotoMenu providerLabel={providerLabel} hasProvider={!!initial.provider_avatar && preview !== initial.provider_avatar} hasPhoto={!!preview}
      onPick={choose} onClose={() => { setMenu(false); photoButton.current?.focus({ preventScroll: true }); }} />}
  </form>;
}
