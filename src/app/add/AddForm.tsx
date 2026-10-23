"use client";
import { useSourceSession } from "@/components/useSourceSession";
import { workId } from "@/lib/work-id";
import ClientReady from "@/components/ClientReady";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import PageHeader from "@/components/PageHeader";
import ManualPlaceSearch from "@/components/ManualPlaceSearch";
import { requestShare, type ShareResult } from "@/lib/share-stream";
import { CHECKING_SAVE, VerifiedWrite } from "@/lib/verified-write";
import { verifySharedLink } from "@/lib/save-recovery";
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
  const [tab, setTab] = useState("link"); const [text, setText] = useState(initialUrl);
  const [result, setResult] = useState<ShareResult | null>(null); const [running, setBusy] = useState(false); const [leaving, setLeaving] = useState(false); const busy = running || leaving; const [stage, setStage] = useState("caption");
  const sourceSession = useSourceSession(result?.source_id, result?.source_version);
  const sourceReady = !result?.source_id || sourceSession.ready;
  const started = useRef(false);
  const [write] = useState(() => new VerifiedWrite<ShareResult>());
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function complete(data: ShareResult) {
    store.acceptSavedPlace(data.saved_place);
    boardChanged();
    if (!alive.current) {
      if (data.source_id && data.source_version) void fetch(`/api/sources/${data.source_id}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", version: data.source_version, work_id: workId() }), keepalive: true }).catch(() => {});
      return;
    }
    const destination = shareDestination(data);
    if (destination) { setLeaving(true); if (!navigateShell(destination, true)) router.replace(destination); }
    else setResult(data);
  }
  async function submit(value = text, retryPrevious = !!result) {
    if (!value.trim() || busy) return;
    const retry = retryPrevious;
    let retryAfter = 0;
    setBusy(true); setResult(null); setStage("caption"); setChecking(write.pending);
    try {
      const data = await write.run(() => { retryAfter = Date.now() + 65000; return requestShare({ url: value.trim(), retry, stream: true, work_id: workId() }, setStage); }, () => verifySharedLink(value.trim(), retryAfter), () => setChecking(true)); complete(data);
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) { window.location.replace(`/enter?next=${encodeURIComponent(`/add?url=${encodeURIComponent(value)}`)}`); return; }
      setResult({ status: "error", message: e instanceof TypeError ? "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요." : e instanceof Error ? e.message : "연결하지 못했어요. 다시 시도해 주세요." });
    } finally { setBusy(false); setChecking(false); }
  }
  useEffect(() => { if (initialUrl && !started.current) { started.current = true; submit(initialUrl); } }, []);
  return <main className="form-page"><ClientReady><PageHeader title="장소 저장" />
    <div className="seg two save-tabs" role="group" aria-label="장소 등록 방법"><button disabled={busy || write.pending} aria-pressed={tab === "link"} onClick={() => setTab("link")}>인스타 주소</button><button disabled={busy || write.pending} aria-pressed={tab === "search"} onClick={() => setTab("search")}>직접 검색</button></div>
    <section className="add-intro"><h2>{tab === "link" ? "발견한 곳, 여기 담아둘까요?" : "이미 아는 좋은 곳도 담아요"}</h2><p>{tab === "link" ? "인스타에서 복사한 링크를 넣으면 장소를 찾아드려요." : "가보고 싶은 장소를 검색하고 지점을 골라 주세요."}</p></section>
    {leaving ? <p className="notice" role="status">{stage === "save" ? "우리 지도를 여는 중…" : "다음 화면을 여는 중…"}</p> : tab === "search" ? <ManualPlaceSearch sourceId={result?.source_id} version={result?.source_version} sourceReady={sourceReady} onSaved={complete} /> : <>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="search-row"><input className="field" aria-label="인스타그램 링크" inputMode="url" autoCapitalize="none" autoCorrect="off" value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} placeholder="https://www.instagram.com/…" disabled={busy || write.pending} /><button className="btn primary" disabled={busy || !text.trim()} style={{ fontSize: 15 }}>{busy ? "확인 중…" : write.pending ? "확인·재시도" : "찾기"}</button></form>
      {checking ? <p className="notice" role="status">{CHECKING_SAVE}</p> : busy && <ol className="save-progress" aria-label="링크 저장 진행 상태" aria-live="polite">{stages.map((s, i) => <li key={s} className={i < stages.indexOf(stage) ? "done" : s === stage ? "current" : ""}><i>{i < stages.indexOf(stage) ? <Icon name="check" width="13" height="13" /> : s === stage ? "" : i + 1}</i>{stageLabels[i]}</li>)}</ol>}
      {result && <><div className="notice" role={result.status === "error" ? "alert" : "status"} style={{ marginTop: 24 }}><b>{write.pending ? "저장 결과를 확인해 주세요" : result.code?.startsWith("gemini_") ? "AI 분석을 완료하지 못했어요" : "조금만 더 알려주세요"}</b><p>{result.message}</p></div>
      {!write.pending && result.status !== "busy" && <LinkRecovery reason={result.code} busy={busy || !sourceReady} onRetry={() => submit()} onSearch={() => setTab("search")}>
        {sourceSession.error && <p className="error">{sourceSession.error}</p>}
        {result.confirm_url && <Link className="return-link" href={result.confirm_url.replace(/^https?:\/\/[^/]+/, "")}>확인 화면 이어서 열기</Link>}
      </LinkRecovery>}</>}
    </>}
    </ClientReady></main>;
}
