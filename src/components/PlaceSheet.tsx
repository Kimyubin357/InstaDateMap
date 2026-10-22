"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { STATUS_ORDER, type PlaceView, placeMeta } from "@/lib/place-view";
import { requestJson } from "@/lib/client-request";
import { loadScript } from "@/lib/scripts";
import MapCanvas from "./MapCanvas";
import ActionDialog from "./ActionDialog";
import { useBoardSync } from "./BoardProvider";
import { categoryIcon, placeCopyContent } from "@/lib/place-presentation";
import { StatusSelection } from "@/lib/status-selection";
const ignore = () => {};
export default function PlaceSheet({ place, kakaoKey, onClose, onShowMap, onPatch, onDelete }: { place: PlaceView; kakaoKey: string; onClose: () => void; onShowMap: () => void; onPatch: (patch: { status?: PlaceStatus; memo?: string }) => void; onDelete: () => void }) {
  const { notify } = useBoardSync();
  const copy = placeCopyContent(place);
  const [statusSelection] = useState(() => new StatusSelection(place.status, async (status) => {
    await requestJson(`/api/places/${place.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }), signal: AbortSignal.timeout(15000) });
    onPatch({ status });
  }, () => notify("상태를 바꿨어요."), (error) => notify(error instanceof Error ? error.message : "상태를 저장하지 못했어요.", "error")));
  const status = useSyncExternalStore(statusSelection.subscribe, statusSelection.getSnapshot, statusSelection.getSnapshot);
  useEffect(() => { statusSelection.receive(place.status); }, [place.status, status.pending, statusSelection]);
  const [memo, setMemo] = useState(place.memo || ""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const deleteRequest = useRef(false);
  const lastMemo = useRef(place.memo || "");
  useEffect(() => { const incoming = place.memo || "", previous = lastMemo.current; setMemo((draft) => draft === previous ? incoming : draft); lastMemo.current = incoming; }, [place.memo]);
  const [more, setMore] = useState(false); const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState<"close" | "map" | null>(null);
  const menu = useRef<HTMLDivElement>(null); const moreButton = useRef<HTMLButtonElement>(null);
  const detailScroll = useRef(0); const wasDeleting = useRef(false);
  useEffect(() => {
    if (!more) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: globalThis.PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) setMore(false); };
    // WebKit can focus the containing sheet before a touch click. Only a new control outside the menu closes it.
    const focusOutside = (event: FocusEvent) => {
      const popup = menu.current?.querySelector('[role="menu"]');
      if (event.target instanceof Node && popup && !popup.contains(event.target) && !event.target.contains(popup)) setMore(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[data-app-dialog][open]")) { event.preventDefault(); event.stopPropagation(); setMore(false); moreButton.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape, true); document.addEventListener("focusin", focusOutside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); document.removeEventListener("focusin", focusOutside); };
  }, [more]);
  useEffect(() => {
    if (deleting) { wasDeleting.current = true; }
    else if (wasDeleting.current) {
      wasDeleting.current = false;
      const body = moreButton.current?.closest(".sheet")?.querySelector(".sheet-body");
      if (body) body.scrollTop = detailScroll.current;
      moreButton.current?.focus({ preventScroll: true });
    }
  }, [deleting]);
  const preview = useMemo(() => [{ ...place, status: status.status }], [place, status.status]);
  function requestLeave(destination: "close" | "map") {
    if (memo !== (place.memo || "")) setLeaving(destination);
    else if (destination === "map") onShowMap(); else onClose();
  }
  async function saveMemo() {
    const value = { memo };
    setBusy(true); setError("");
    try { await requestJson(`/api/places/${place.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); onPatch(value); notify("메모를 저장했어요."); }
    catch (e) { notify(e instanceof Error ? e.message : "저장하지 못했어요.", "error"); } finally { setBusy(false); }
  }
  function requestDelete() {
    detailScroll.current = moreButton.current?.closest(".sheet")?.querySelector(".sheet-body")?.scrollTop || 0;
    setMore(false); setError(""); setDeleting(true);
  }
  function dismissDelete() { if (!busy) { setDeleting(false); setError(""); } }
  async function remove() {
    if (busy || deleteRequest.current) return;
    deleteRequest.current = true; setBusy(true); setError("");
    try {
      const result = await requestJson<{ ok: boolean; deleted_id: string }>(`/api/places/${place.id}`, { method: "DELETE", signal: AbortSignal.timeout(15000) });
      if (result.ok !== true || result.deleted_id !== place.id) throw new Error("삭제 결과를 확인하지 못했어요. 다시 시도해 주세요.");
      onDelete(); notify("장소를 삭제했어요.");
    }
    catch (e) { setError(e instanceof Error ? e.message : "삭제하지 못했어요. 다시 시도해 주세요."); }
    finally { deleteRequest.current = false; setBusy(false); }
  }
  return <><Modal title={place.name} className="sheet-place" initialStop={2} dragFromContent onClose={busy || deleting || leaving ? () => {} : () => requestLeave("close")}
    headerActions={<div ref={menu} className="place-options">
      <button ref={moreButton} className="icon-btn" aria-label="장소 더 보기" aria-haspopup="menu" aria-expanded={more} disabled={busy || status.pending} onClick={() => setMore(!more)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMore(true); } }}><Icon name="more" /></button>
      {more && <div className="place-options-menu" role="menu" aria-label="장소 관리"><button role="menuitem" className="place-delete-option" onClick={requestDelete}><Icon name="trash" width="19" /><span>장소 삭제</span></button></div>}
    </div>}
    footer={<div className="detail-actions"><a className="btn primary" href={place.kakao_url || `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`} target="_blank" rel="noreferrer"><Icon name="external" />카카오맵 열기</a>
      <button className="btn" disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(copy.text); notify(`${copy.object} 복사했어요.`); } catch { notify(`${copy.object} 복사하지 못했어요. ${copy.object} 길게 눌러 복사해 주세요.`, "error"); } }}><Icon name="copy" />{copy.label} 복사</button>
    </div>}>
    <div className="detail-map"><MapCanvas places={preview} selectedId={place.id} apiKey={kakaoKey} active initialPosition={{ lat: place.lat, lng: place.lng, level: 4 }} onPosition={ignore} onPick={ignore} location={null} viewRequest={null} interactive={false} /><button className="preview-map-button" disabled={busy} onClick={() => requestLeave("map")}><Icon name="pin" width="15" />지도에서 보기<Icon name="arrow" width="15" /></button></div>
    <div className="detail-title"><h2>{place.name}</h2><span className={`status-tag ${status.status}`}>{STATUS_LABEL[status.status]}</span></div><p className="addr">{place.address}</p>
    <div className="detail-facts"><div><Icon name={categoryIcon(place.category)} width="20" /><strong>{placeMeta(place) || "저장한 장소"}</strong><span>함께 가볼 곳</span></div><div><Icon name="user" width="20" /><strong>{place.sharers.length >= 2 ? "둘 다 저장함" : place.sharers[0] || "우리"}</strong><span>발견한 사람</span></div></div>
    <div className="detail-section-heading"><span className="section-label">우리에게 어떤 곳인가요?</span></div>
    <div className="seg four" role="group" aria-label="장소 상태" aria-busy={status.pending}>{STATUS_ORDER.map((s) => <button key={s} disabled={busy} aria-pressed={status.status === s} onClick={() => statusSelection.select(s)}>{STATUS_LABEL[s]}</button>)}</div>
    <label className="section-label" htmlFor="place-memo">둘만의 메모</label><textarea id="place-memo" className="memo" placeholder="다음에 같이 가면 좋을 시간, 먹고 싶은 메뉴…" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} /><div className="memo-footer"><small>{memo.length}/500</small><button className="text-btn" disabled={busy || status.pending || memo === (place.memo || "")} onClick={saveMemo}>메모 저장</button></div>
    {place.sources.length > 0 ? <details className="source-details" onToggle={(e) => { if (e.currentTarget.open) loadScript("https://www.instagram.com/embed.js", "ig-embed").then(() => window.instgrm?.Embeds.process()).catch(() => undefined); }}><summary>발견했던 인스타 게시물 <span>{place.sources.length}개</span></summary><div className="embeds">{place.sources.map((source) => <blockquote key={source.url} className="instagram-media" data-instgrm-permalink={source.url} data-instgrm-version="14"><a href={source.url} target="_blank" rel="noreferrer" className="embed-fallback">인스타그램에서 {source.media_type === "reel" ? "릴스" : "게시물"} 보기 <Icon name="external" /></a></blockquote>)}</div></details> : <p className="hint">장소를 직접 찾아 저장했어요.</p>}
    </Modal>{leaving && <ActionDialog title="메모를 저장하지 않고 나갈까요?" message="작성 중인 메모는 사라져요." tone="info" cancelLabel="계속 작성" confirmLabel="저장하지 않고 나가기" onClose={() => setLeaving(null)} onConfirm={() => { const destination = leaving; setLeaving(null); if (destination === "map") onShowMap(); else onClose(); }} />}
    {deleting && <ActionDialog title="이 장소를 삭제할까요?" destructive cancelLabel="취소" confirmLabel="삭제하기" busy={busy} busyLabel="삭제 중…" onClose={dismissDelete} onConfirm={remove}>
      <strong className="delete-dialog-name">{place.name}</strong>{place.address && <p className="delete-dialog-address">{place.address}</p>}<p>두 사람의 지도에서 삭제돼요.<br />이 장소의 메모와 저장 기록도 함께 사라져요.</p>{error && <p className="error" role="alert">{error}</p>}
    </ActionDialog>}</>;
}
