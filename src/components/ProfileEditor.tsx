"use client";
import { useRef, useState, type FormEvent } from "react";
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

/**
 * 이름·사진 편집. 가입 직후 화면과 설정의 프로필 화면이 함께 씁니다.
 * 사진: 카카오·구글 사진 / 직접 올리기 / 사진 없이.
 */
export default function ProfileEditor({ initial, submitLabel, busyLabel = "저장하는 중…", onSaved, requireChange = false }: {
  initial: Profile; submitLabel: string; busyLabel?: string; onSaved: (profile: Profile) => void | Promise<void>; requireChange?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [mode, setMode] = useState<AvatarMode>("keep");
  const [custom, setCustom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const preview = mode === "keep" ? initial.avatar : mode === "provider" ? initial.provider_avatar : mode === "custom" ? custom : null;
  const trimmed = name.replace(/\s+/g, " ").trim();
  const unchanged = trimmed === initial.name && mode === "keep";
  const providerLabel = initial.provider ? PROVIDER_LABEL[initial.provider] : null;
  const usingProvider = !!initial.provider_avatar && preview === initial.provider_avatar;

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setError("");
    try { setCustom(await toAvatar(chosen)); setMode("custom"); }
    catch (e) { setError(e instanceof Error ? e.message : "사진을 열지 못했어요."); }
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

  return <div className={styles.wrap}><form className={styles.editor} onSubmit={submit} aria-busy={busy}>
    <div className={styles.photo}>
      <Avatar src={preview} size={104} label={preview ? "선택한 프로필 사진" : "프로필 사진 없음"} />
      <div className={styles.photoActions} role="group" aria-label="프로필 사진">
        {initial.provider_avatar && providerLabel && <button type="button" className={styles.choice} aria-pressed={usingProvider} disabled={busy} onClick={() => setMode("provider")}>{providerLabel} 사진</button>}
        <button type="button" className={styles.choice} aria-pressed={mode === "custom"} disabled={busy} onClick={() => file.current?.click()}><Icon name="image" width="18" />사진 올리기</button>
        <button type="button" className={styles.choice} aria-pressed={!preview} disabled={busy} onClick={() => setMode("none")}>사진 없이</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
      </div>
    </div>
    <label className={styles.name}>이름
      <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="예: 유빈" autoComplete="nickname" enterKeyHint="done" disabled={busy} />
      <small>장소를 저장하거나 메모를 남기면 폴더 멤버에게 이 이름으로 보여요.{initial.provider_name && providerLabel && trimmed !== initial.provider_name ? ` ${providerLabel} 이름: ${initial.provider_name}` : ""}</small>
    </label>
    {initial.provider_name && providerLabel && trimmed !== initial.provider_name && <button type="button" className={`text-btn ${styles.useProviderName}`} disabled={busy} onClick={() => setName(initial.provider_name!.slice(0, 20))}>{providerLabel} 이름으로 바꾸기</button>}
    {error && <p className="error" role="alert">{error}</p>}
    <button className="btn primary large" disabled={busy || !trimmed || (requireChange && unchanged)}>{busy ? busyLabel : submitLabel}</button>
  </form></div>;
}
