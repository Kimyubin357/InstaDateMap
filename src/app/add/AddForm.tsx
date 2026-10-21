"use client";

import { useEffect, useRef, useState } from "react";

type Result = { status: string; message: string; confirm_url?: string };

export default function AddForm({ token, who, initialUrl }: { token: string; who: string; initialUrl: string }) {
  const [text, setText] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const started = useRef(false);

  const mapHref = `/?t=${encodeURIComponent(token)}&who=${encodeURIComponent(who)}`;

  async function submit(value: string) {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-board-token": token },
        body: JSON.stringify({ url: v, who: who || "익명" }),
      });
      const data = (await res.json()) as Result;
      if (data.confirm_url) {
        // 여러 곳이거나 애매하면 확인 화면으로 바로 이동
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

  // 단축어로 url이 넘어오면 자동 처리
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

  const ok = result && ["saved", "duplicate"].includes(result.status);

  return (
    <main className="confirm">
      <h1>링크 추가</h1>
      <p className="lead">인스타 게시물에서 공유 → 링크 복사 후 여기에 붙여넣으세요.</p>

      <button className="btn primary" style={{ width: "100%" }} onClick={pasteFromClipboard} disabled={busy}>
        {busy ? "장소 찾는 중…" : "📋 복사한 링크 붙여넣고 저장"}
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
          <b>{ok ? "저장했어요 ✓" : "확인이 필요해요"}</b>
          <p style={{ margin: "6px 0 0" }}>{result.message}</p>
        </div>
      )}

      <div className="actions">
        <a className="btn" href={mapHref}>
          지도로 돌아가기
        </a>
      </div>
    </main>
  );
}
