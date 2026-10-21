"use client";
import ClientReady from "@/components/ClientReady";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import PageHeader from "@/components/PageHeader";
import ManualPlaceSearch from "@/components/ManualPlaceSearch";
import { readShareResponse, type ShareResult } from "@/lib/share-stream";
import { RequestError } from "@/lib/client-request";
const stages = ["caption", "extract", "search", "save"];
const stageLabels = ["게시물 내용 가져오기", "장소 정보 읽기", "지도에서 위치 확인하기", "우리 지도에 저장하기"];
async function imageBase64(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height)); const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale); canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .82).split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}
export default function AddForm({ initialUrl }: { initialUrl: string }) {
  const [tab, setTab] = useState("link"); const [text, setText] = useState(initialUrl); const [caption, setCaption] = useState("");
  const [result, setResult] = useState<ShareResult | null>(null); const [busy, setBusy] = useState(false); const [stage, setStage] = useState("caption");
  const [shots, setShots] = useState<string[]>([]); const started = useRef(false); const file = useRef<HTMLInputElement>(null);
  const success = result && ["saved", "duplicate"].includes(result.status);
  async function submit(value = text, images = shots) {
    if (!value.trim() || busy) return;
    const retry = !!result || !!caption.trim() || images.length > 0;
    setBusy(true); setResult(null); setStage("caption");
    try {
      const res = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value.trim(), caption: caption.trim() || undefined, images, retry, stream: true }) });
      const data = await readShareResponse(res, setStage); setResult(data);
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) { window.location.replace(`/enter?next=${encodeURIComponent(`/add?url=${encodeURIComponent(value)}`)}`); return; }
      setResult({ status: "error", message: e instanceof TypeError ? "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요." : e instanceof Error ? e.message : "연결하지 못했어요. 다시 시도해 주세요." });
    } finally { setBusy(false); }
  }
  useEffect(() => { if (initialUrl && !started.current) { started.current = true; submit(initialUrl); } }, []);
  async function clipboard() { try { const value = await navigator.clipboard.readText(); if (value.trim()) { setText(value); await submit(value); } } catch { setResult({ status: "error", message: "클립보드를 읽지 못했어요. 입력칸을 길게 눌러 붙여넣어 주세요." }); } }
  return <main className="form-page"><ClientReady><PageHeader title="장소 저장" />
    <div className="seg two save-tabs" role="group" aria-label="저장 방식"><button disabled={busy} aria-pressed={tab === "link"} onClick={() => setTab("link")}><Icon name="link" width="17" /> 인스타 링크</button><button disabled={busy} aria-pressed={tab === "search"} onClick={() => setTab("search")}><Icon name="search" width="17" /> 장소 검색</button></div>
    {!success && <section className="add-intro"><h2>{tab === "link" ? "발견한 곳, 여기 담아둘까요?" : "이미 아는 좋은 곳도 담아요"}</h2><p>{tab === "link" ? "인스타에서 복사한 링크를 넣으면 장소를 찾아드려요." : "가보고 싶은 장소를 검색하고 지점을 골라 주세요."}</p></section>}
    {success ? <section className="save-result" role="status"><Icon name="heart" className="result-heart" width="40" height="40" /><h2>{result.status === "duplicate" ? "이미 담아둔 장소예요" : "우리 지도에 담았어요"}</h2><p className="lead">{result.message}</p><Link className="btn primary large" href={result.place_url || "/"}>저장한 장소 보기</Link><button className="btn" style={{ width: "100%" }} onClick={() => { setResult(null); setText(""); setCaption(""); setShots([]); }}>다른 장소도 저장하기</button></section> : tab === "search" ? <ManualPlaceSearch sourceId={result?.source_id} onSaved={setResult} /> : <>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="search-row"><input className="field" aria-label="인스타그램 링크" inputMode="url" value={text} onChange={(e) => { setText(e.target.value); setResult(null); setShots([]); setCaption(""); }} placeholder="https://www.instagram.com/…" disabled={busy} /><button className="btn primary" disabled={busy || !text.trim()} style={{ fontSize: 15 }}>{busy ? "찾는 중" : "저장"}</button></form>
      <button className="btn clipboard-btn" onClick={clipboard} disabled={busy}><Icon name="copy" width="17" />복사한 링크 붙여넣기</button>
      {busy && <ol className="save-progress" aria-label="링크 저장 진행 상태" aria-live="polite">{stages.map((s, i) => <li key={s} className={i < stages.indexOf(stage) ? "done" : s === stage ? "current" : ""}><i>{i < stages.indexOf(stage) ? <Icon name="check" width="13" height="13" /> : s === stage ? "" : i + 1}</i>{stageLabels[i]}</li>)}</ol>}
      {result && <><div className="notice" role={result.status === "error" ? "alert" : "status"} style={{ marginTop: 24 }}><b>{result.status === "confirm" ? "남길 장소를 골라 주세요" : "조금만 더 알려주세요"}</b><p>{result.message}</p></div>
      {result.status === "confirm" && result.confirm_url && <Link className="btn primary large" style={{ marginTop: 16 }} href={result.confirm_url.replace(/^https?:\/\/[^/]+/, "")}>장소 확인하고 저장하기</Link>}
      {result.status !== "confirm" && <section className="fallback-options"><h3>이렇게도 찾을 수 있어요</h3><button className="btn" disabled={busy} onClick={() => submit()}><Icon name="refresh" width="17" />다시 시도하기</button><label className="form-label">게시물 캡션 붙여넣기<textarea className="caption-box" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="상호나 주소가 적힌 게시물 글을 붙여넣어 주세요" maxLength={10000} /></label><button className="btn" disabled={busy || !caption.trim()} onClick={() => submit()}>이 캡션으로 다시 찾기</button><button className="btn" disabled={busy} onClick={() => file.current?.click()}><Icon name="image" width="19" />스크린샷으로 찾기{shots.length ? ` · ${shots.length}장` : ""}</button><button className="btn" disabled={busy} onClick={() => setTab("search")}><Icon name="search" width="19" />장소 이름으로 직접 찾기</button>{result.confirm_url && <Link className="return-link" href={result.confirm_url.replace(/^https?:\/\/[^/]+/, "")}>확인 화면 이어서 열기</Link>}</section>}</>}
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden ref={file} onChange={async (e) => { const picked = Array.from(e.target.files || []).slice(0, 4); e.target.value = ""; if (!picked.length) return; try { const images = await Promise.all(picked.map(imageBase64)); setShots(images); await submit(text, images); } catch { setResult({ status: "error", message: "이미지를 읽지 못했어요. JPG 또는 PNG로 다시 올려 주세요." }); } }} />
    </>}
    <Link className="return-link" href="/">우리 지도로 돌아가기</Link></ClientReady></main>;
}
