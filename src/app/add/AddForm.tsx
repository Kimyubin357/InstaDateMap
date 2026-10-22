"use client";
import ClientReady from "@/components/ClientReady";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import PageHeader from "@/components/PageHeader";
import ManualPlaceSearch from "@/components/ManualPlaceSearch";
import { readShareResponse, type ShareResult } from "@/lib/share-stream";
import { RequestError } from "@/lib/client-request";
import LinkRecovery from "@/components/LinkRecovery";
import { useRouter } from "next/navigation";
import { shareDestination } from "@/lib/share-navigation";
import { boardChanged } from "@/lib/board-events";
import { navigateShell } from "@/lib/shell-navigation";
import { useBoardSync } from "@/components/BoardProvider";
const stages = ["caption", "extract", "search", "save"];
const stageLabels = ["게시물 내용 가져오기", "장소 정보 읽기", "지도에서 위치 확인하기", "우리 지도에 저장하기"];
export default function AddForm({ initialUrl }: { initialUrl: string }) {
  const router = useRouter();
  const { store } = useBoardSync();
  const [tab, setTab] = useState("link"); const [text, setText] = useState(initialUrl); const [caption, setCaption] = useState("");
  const [result, setResult] = useState<ShareResult | null>(null); const [running, setBusy] = useState(false); const [leaving, setLeaving] = useState(false); const busy = running || leaving; const [stage, setStage] = useState("caption");
  const [shots, setShots] = useState<string[]>([]); const started = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function complete(data: ShareResult) {
    store.acceptSavedPlace(data.saved_place);
    boardChanged();
    if (!alive.current) return;
    const destination = shareDestination(data);
    if (destination) { setLeaving(true); if (!navigateShell(destination, true)) router.replace(destination); }
    else setResult(data);
  }
  async function submit(value = text, images = shots, content = caption, retryPrevious = !!result) {
    if (!value.trim() || busy) return;
    const retry = retryPrevious || !!content.trim() || images.length > 0;
    setBusy(true); setResult(null); setStage("caption");
    try {
      const res = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value.trim(), caption: content.trim() || undefined, images, retry, stream: true }) });
      const data = await readShareResponse(res, setStage); complete(data);
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) { window.location.replace(`/enter?next=${encodeURIComponent(`/add?url=${encodeURIComponent(value)}`)}`); return; }
      setResult({ status: "error", message: e instanceof TypeError ? "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요." : e instanceof Error ? e.message : "연결하지 못했어요. 다시 시도해 주세요." });
    } finally { setBusy(false); }
  }
  useEffect(() => { if (initialUrl && !started.current) { started.current = true; submit(initialUrl); } }, []);
  return <main className="form-page"><ClientReady><PageHeader title="장소 저장" />
    {tab === "search" && <button className="text-btn" disabled={busy} onClick={() => setTab("link")}>링크로 다시 찾기</button>}
    <section className="add-intro"><h2>{tab === "link" ? "발견한 곳, 여기 담아둘까요?" : "이미 아는 좋은 곳도 담아요"}</h2><p>{tab === "link" ? "인스타에서 복사한 링크를 넣으면 장소를 찾아드려요." : "가보고 싶은 장소를 검색하고 지점을 골라 주세요."}</p></section>
    {leaving ? <p className="notice" role="status">{stage === "save" ? "우리 지도를 여는 중…" : "다음 화면을 여는 중…"}</p> : tab === "search" ? <ManualPlaceSearch sourceId={result?.source_id} onSaved={complete} /> : <>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="search-row"><input className="field" aria-label="인스타그램 링크" inputMode="url" autoCapitalize="none" autoCorrect="off" value={text} onChange={(e) => { setText(e.target.value); setResult(null); setShots([]); setCaption(""); }} placeholder="https://www.instagram.com/…" disabled={busy} /><button className="btn primary" disabled={busy || !text.trim()} style={{ fontSize: 15 }}>{busy ? "찾는 중…" : "찾기"}</button></form>
      {busy && <ol className="save-progress" aria-label="링크 저장 진행 상태" aria-live="polite">{stages.map((s, i) => <li key={s} className={i < stages.indexOf(stage) ? "done" : s === stage ? "current" : ""}><i>{i < stages.indexOf(stage) ? <Icon name="check" width="13" height="13" /> : s === stage ? "" : i + 1}</i>{stageLabels[i]}</li>)}</ol>}
      {result && <><div className="notice" role={result.status === "error" ? "alert" : "status"} style={{ marginTop: 24 }}><b>조금만 더 알려주세요</b><p>{result.message}</p></div>
      <LinkRecovery caption={caption} onCaption={setCaption} busy={busy} shotCount={shots.length} onRetry={() => submit()} onCaptionSubmit={() => submit()} onScreenshots={async (images) => { setShots(images); await submit(text, images); }} onSearch={() => setTab("search")}>
        {result.confirm_url && <Link className="return-link" href={result.confirm_url.replace(/^https?:\/\/[^/]+/, "")}>확인 화면 이어서 열기</Link>}
      </LinkRecovery></>}
    </>}
    </ClientReady></main>;
}
