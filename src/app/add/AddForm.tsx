"use client";

import { useEffect, useRef, useState } from "react";

type Result = { status: string; message: string; confirm_url?: string };

/** 스크린샷을 긴 변 1280px JPEG로 줄여 base64로 돌려줍니다(업로드 용량 제한 대비). */
async function toJpegBase64(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function AddForm({ token, who, initialUrl }: { token: string; who: string; initialUrl: string }) {
  const [text, setText] = useState(initialUrl);
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const started = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const mapHref = `/?t=${encodeURIComponent(token)}&who=${encodeURIComponent(who)}`;
  const needShot = result?.status === "needs_caption" || result?.status === "needs_review";

  async function submit(value: string, images: string[] = shots) {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-board-token": token },
        body: JSON.stringify({ url: v, who: who || "익명", images }),
      });
      const data = (await res.json()) as Result;
      // 캡션을 못 가져왔으면 이 화면에서 스크린샷을 받습니다.
      if (data.status === "needs_caption" || (data.status === "needs_review" && images.length === 0)) {
        setResult(data);
        return;
      }
      if (data.confirm_url) {
        window.location.replace(data.confirm_url.replace(/^https?:\/\/[^/]+/, ""));
        return;
      }
      setResult(data);
    } catch {
      setResult({ status: "error", message: "서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요." });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialUrl && !started.current) {
      started.current = true;
      submit(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) {
        setText(t);
        submit(t);
      }
    } catch {
      setResult({ status: "error", message: "클립보드를 읽지 못했어요. 아래 칸을 길게 눌러 붙여넣어 주세요." });
    }
  }

  async function onPickShots(files: FileList | null) {
    if (!files?.length) return;
    const picked = await Promise.all([...files].slice(0, 4).map(toJpegBase64));
    setShots(picked);
    if (text.trim()) submit(text, picked);
  }

  const ok = result && ["saved", "duplicate"].includes(result.status);

  return (
    <main className="confirm">
      <h1>링크 추가</h1>
      <p className="lead">인스타 게시물에서 공유 → 링크 복사 후 여기에 붙여넣으세요.</p>

      <button className="btn primary" style={{ width: "100%" }} onClick={pasteFromClipboard} disabled={busy}>
        {busy ? "장소 찾는 중… (10~20초)" : "📋 복사한 링크 붙여넣고 저장"}
      </button>

      <div className="search-row" style={{ marginTop: 12 }}>
        <input
          className="field"
          placeholder="https://www.instagram.com/p/…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(text)}
          inputMode="url"
        />
        <button className="btn" style={{ flex: "none" }} onClick={() => submit(text)} disabled={busy || !text.trim()}>
          저장
        </button>
      </div>

      {result && (
        <div className="notice" style={{ marginTop: 16 }}>
          <b>{ok ? "저장했어요 ✓" : needShot ? "장소를 아직 못 찾았어요" : "확인이 필요해요"}</b>
          <p style={{ margin: "6px 0 0" }}>
            {result.status === "needs_caption"
              ? "인스타가 게시물 글을 막아 둔 경우예요. 게시물(캡션·간판·자막이 보이게) 스크린샷을 올리면 AI가 읽고 장소를 찾아요."
              : result.status === "needs_review"
                ? "글에서는 장소를 못 찾았어요. 사진 속 간판·자막에 상호가 있다면 스크린샷을 올려 보세요."
                : result.message}
          </p>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onPickShots(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        className={needShot ? "btn primary" : "btn"}
        style={{ width: "100%", marginTop: 12 }}
        onClick={() => fileRef.current?.click()}
        disabled={busy || !text.trim()}
      >
        🖼️ 스크린샷으로 찾기{shots.length ? ` (${shots.length}장 선택됨)` : ""}
      </button>

      {needShot && result?.confirm_url && (
        <p className="lead" style={{ marginTop: 10, fontSize: 14 }}>
          또는{" "}
          <a className="source-link" href={result.confirm_url.replace(/^https?:\/\/[^/]+/, "")}>
            장소 이름 직접 검색하기
          </a>
        </p>
      )}

      <div className="actions">
        <a className="btn" href={mapHref}>
          지도로 돌아가기
        </a>
      </div>
    </main>
  );
}
