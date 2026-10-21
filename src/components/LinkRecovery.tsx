"use client";
import { useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";
import { screenshotsAsBase64 } from "@/lib/client-images";

export default function LinkRecovery({ caption, onCaption, busy, shotCount, onRetry, onCaptionSubmit, onScreenshots, onSearch, children }: {
  caption: string; onCaption: (caption: string) => void; busy: boolean; shotCount: number;
  onRetry: () => void; onCaptionSubmit: () => void; onScreenshots: (images: string[]) => Promise<void>;
  onSearch: () => void; children?: ReactNode;
}) {
  const file = useRef<HTMLInputElement>(null); const [preparing, setPreparing] = useState(false); const [error, setError] = useState("");
  const disabled = busy || preparing;
  return <section className="fallback-options"><h3>이렇게도 찾을 수 있어요</h3>
    <button className="btn" disabled={disabled} onClick={onRetry}><Icon name="refresh" width="17" />다시 시도하기</button>
    <label className="form-label">게시물 캡션 붙여넣기<textarea className="caption-box" value={caption} onChange={(e) => onCaption(e.target.value)} placeholder="상호나 주소가 적힌 게시물 글을 붙여넣어 주세요" maxLength={10000} disabled={disabled} /></label>
    <button className="btn" disabled={disabled || !caption.trim()} onClick={onCaptionSubmit}>이 캡션으로 다시 찾기</button>
    <button className="btn" disabled={disabled} onClick={() => file.current?.click()}><Icon name="image" width="19" />{preparing ? "스크린샷 준비 중…" : "스크린샷으로 찾기"}{shotCount ? ` · ${shotCount}장` : ""}</button>
    <button className="btn" disabled={disabled} onClick={onSearch}><Icon name="search" width="19" />장소 이름으로 직접 찾기</button>
    <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="장소 스크린샷" multiple hidden ref={file} disabled={disabled} onChange={async (e) => {
      const picked = Array.from(e.target.files || []); e.target.value = ""; if (!picked.length) return;
      setPreparing(true); setError("");
      try { await onScreenshots(await screenshotsAsBase64(picked)); }
      catch { setError("이미지를 읽지 못했어요. JPG 또는 PNG로 다시 올려 주세요."); }
      finally { setPreparing(false); }
    }} />
    {error && <p className="error" role="alert">{error}</p>}{children}
  </section>;
}
