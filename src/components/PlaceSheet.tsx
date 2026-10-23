"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { STATUS_ORDER, type PlaceView, placeMeta } from "@/lib/place-view";
import { requestJson, RequestError } from "@/lib/client-request";
import { CHECKING_SAVE, VerifiedWrite, UnconfirmedWriteError } from "@/lib/verified-write";
import { verifyDeletedPlace, verifyPlacePatch } from "@/lib/save-recovery";
import MapCanvas from "./MapCanvas";
import ActionDialog from "./ActionDialog";
import { useBoardSync } from "./BoardProvider";
import { categoryIcon, placeCopyContent } from "@/lib/place-presentation";
import { StatusSelection } from "@/lib/status-selection";
const ignore = () => {};
export default function PlaceSheet({ place, kakaoKey, onClose, onShowMap, onPatch, onDelete }: { place: PlaceView; kakaoKey: string; onClose: () => void; onShowMap: () => void; onPatch: (patch: { status?: PlaceStatus; memo?: string }) => void; onDelete: () => void }) {
  const { notify, store, lock } = useBoardSync();
  const copy = placeCopyContent(place);
  const [memoWrite] = useState(() => new VerifiedWrite<{ memo: string }>());
  const [statusWrite] = useState(() => new VerifiedWrite<{ status: PlaceStatus }>());
  const [deletion] = useState(() => new VerifiedWrite<{ ok: boolean; deleted_id: string }>());
  const [memoPending, setMemoPending] = useState(false), [statusPending, setStatusPending] = useState(false);
  const [activity, setActivity] = useState("");
  function mutationError(error: unknown) {
    if (error instanceof RequestError && [401, 409].includes(error.status)) { void lock(); return; }
    if (error instanceof RequestError && error.status === 404 && error.code === "PLACE_NOT_FOUND") {
      onDelete(); void store.refresh(); notify("이미 삭제된 장소예요.", "error"); return;
    }
    if (error instanceof UnconfirmedWriteError) setActivity(error.message);
    else { setActivity(""); notify(error instanceof Error ? error.message : "저장하지 못했어요.", "error"); }
  }
  const checking = () => setActivity(CHECKING_SAVE);
  const [statusSelection] = useState(() => new StatusSelection(place.status, async (status) => {
    const patch = await statusWrite.run(async () => { await requestJson(`/api/places/${place.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); return { status }; }, () => verifyPlacePatch(place.id, { status }), checking);
    onPatch(patch); setActivity("");
  }, () => notify("상태를 바꿨어요."), (error) => { setStatusPending(statusWrite.pending); mutationError(error); }));
  const status = useSyncExternalStore(statusSelection.subscribe, statusSelection.getSnapshot, statusSelection.getSnapshot);
  useEffect(() => { statusSelection.receive(place.status); }, [place.status, status.pending, statusSelection]);
  const [memo, setMemo] = useState(place.memo || ""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const memoDraft = useRef(memo); memoDraft.current = memo;
  const deleteRequest = useRef(false);
  const lastMemo = useRef(place.memo || "");
  useEffect(() => { const incoming = place.memo || "", previous = lastMemo.current; setMemo((draft) => draft === previous ? incoming : draft); lastMemo.current = incoming; }, [place.memo]);
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState<"close" | "map" | null>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const detailScroll = useRef(0); const wasDeleting = useRef(false);
  useEffect(() => {
    if (deleting) { wasDeleting.current = true; }
    else if (wasDeleting.current) {
      wasDeleting.current = false;
      const body = deleteButton.current?.closest(".sheet")?.querySelector(".sheet-body");
      if (body) body.scrollTop = detailScroll.current;
      deleteButton.current?.focus({ preventScroll: true });
    }
  }, [deleting]);
  const preview = useMemo(() => [{ ...place, status: status.status }], [place, status.status]);
  function requestLeave(destination: "close" | "map") {
    if (memo !== (place.memo || "")) setLeaving(destination);
    else if (destination === "map") onShowMap(); else onClose();
  }
  async function saveMemo() {
    if (busy) return;
    const value = { memo };
    setBusy(true); setError("");
    try {
      const saved = await memoWrite.run(async () => { await requestJson(`/api/places/${place.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); return value; }, () => verifyPlacePatch(place.id, value), checking);
      onPatch(saved); setActivity(""); notify(saved.memo === memoDraft.current ? "메모를 저장했어요." : "이전에 요청한 메모를 저장했어요. 새로 쓴 내용은 아직 저장 전이에요.");
    } catch (e) { mutationError(e); } finally { setMemoPending(memoWrite.pending); setBusy(false); }
  }
  async function retryStatus() {
    if (busy || !statusWrite.pending) return;
    setBusy(true);
    try {
      const patch = await statusWrite.run(async () => { throw new Error("확인할 상태가 없어요."); }, async () => null, checking);
      onPatch(patch); setActivity(""); notify("상태를 바꿨어요.");
    } catch (e) { mutationError(e); } finally { setStatusPending(statusWrite.pending); setBusy(false); }
  }
  function requestDelete() {
    detailScroll.current = deleteButton.current?.closest(".sheet")?.querySelector(".sheet-body")?.scrollTop || 0;
    setError(""); setDeleting(true);
  }
  function dismissDelete() { if (!busy) { setDeleting(false); setError(""); } }
  async function remove() {
    if (busy || deleteRequest.current) return;
    deleteRequest.current = true; setBusy(true); setError("");
    try {
      const result = await deletion.run(() => requestJson<{ ok: boolean; deleted_id: string }>(`/api/places/${place.id}`, { method: "DELETE" }), () => verifyDeletedPlace(place.id), () => setError("응답이 늦어지고 있어요. 삭제 여부를 확인할게요."));
      if (result.ok !== true || result.deleted_id !== place.id) throw new Error("삭제 결과를 확인하지 못했어요. 다시 시도해 주세요.");
      onDelete(); notify("장소를 삭제했어요.");
    }
    catch (e) { if (e instanceof RequestError && [401, 409].includes(e.status)) { void lock(); return; } setError(e instanceof Error ? e.message : "삭제하지 못했어요. 다시 시도해 주세요."); }
    finally { deleteRequest.current = false; setBusy(false); }
  }
  return <><Modal title={place.name} className="sheet-place" initialStop={1} dragFromContent onClose={busy || deleting || leaving ? () => {} : () => requestLeave("close")}
    footer={<div className="detail-actions"><a className="btn primary" href={place.kakao_url || `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`} target="_blank" rel="noreferrer"><Icon name="external" />카카오맵 열기</a>
      <button className="btn" disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(copy.text); notify(`${copy.object} 복사했어요.`); } catch { notify(`${copy.object} 복사하지 못했어요. ${copy.object} 길게 눌러 복사해 주세요.`, "error"); } }}><Icon name="copy" />{copy.label} 복사</button>
    </div>}>
    <div className="detail-map"><MapCanvas places={preview} selectedId={place.id} apiKey={kakaoKey} active initialPosition={{ lat: place.lat, lng: place.lng, level: 4 }} onPosition={ignore} onPick={ignore} location={null} viewRequest={null} interactive={false} /><button className="preview-map-button" disabled={busy} onClick={() => requestLeave("map")}><Icon name="pin" width="15" />지도에서 보기<Icon name="arrow" width="15" /></button></div>
    <div className="detail-title"><h2>{place.name}</h2><span className={`status-tag ${status.status}`}>{STATUS_LABEL[status.status]}</span></div><p className="addr">{place.address}</p>
    <div className="detail-facts"><div><Icon name={categoryIcon(place.category)} width="20" /><strong>{placeMeta(place) || "저장한 장소"}</strong><span>함께 가볼 곳</span></div><div><Icon name="user" width="20" /><strong>{place.sharers.length >= 2 ? "둘 다 저장함" : place.sharers[0] || "우리"}</strong><span>발견한 사람</span></div></div>
    <div className="detail-section-heading"><span className="section-label">우리에게 어떤 곳인가요?</span></div>
    <div className="seg four place-status" role="group" aria-label="장소 상태" aria-busy={status.pending}>{STATUS_ORDER.map((s) => <button key={s} className={`place-status-${s}`} disabled={busy || statusPending || memoPending} aria-pressed={status.status === s} onClick={() => statusSelection.select(s)}>{STATUS_LABEL[s]}</button>)}</div>
    {statusPending && <button className="text-btn" disabled={busy} onClick={retryStatus}>상태 저장 확인·재시도</button>}
    {activity && <p className="notice" role="status">{activity}</p>}
    <label className="section-label" htmlFor="place-memo">둘만의 메모</label><textarea id="place-memo" className="memo" placeholder="다음에 같이 가면 좋을 시간, 먹고 싶은 메뉴…" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} /><div className="memo-footer"><small>{memo.length}/500</small><button className="text-btn" disabled={busy || status.pending || statusPending || (!memoPending && memo === (place.memo || ""))} onClick={saveMemo}>{busy ? "저장 확인 중…" : memoPending ? "메모 저장 확인·재시도" : "메모 저장"}</button></div>
    <div className="place-source-actions">
      {place.sources.length > 0 ? place.sources.map((source, index) => <a key={source.url} className="btn instagram-source-btn" href={source.url} target="_blank" rel="noreferrer"><Icon name="instagram" /><span>원본 인스타 보러가기{place.sources.length > 1 ? ` ${index + 1}` : ""}</span><Icon name="external" width="18" /></a>) : <p className="hint">장소를 직접 찾아 저장했어요.</p>}
      <button ref={deleteButton} className="btn place-delete-btn" disabled={busy || status.pending} onClick={requestDelete}><Icon name="trash" width="20" />장소 삭제</button>
    </div>
    </Modal>{leaving && <ActionDialog title="메모를 저장하지 않고 나갈까요?" message="작성 중인 메모는 사라져요." tone="info" cancelLabel="계속 작성" confirmLabel="저장하지 않고 나가기" onClose={() => setLeaving(null)} onConfirm={() => { const destination = leaving; setLeaving(null); if (destination === "map") onShowMap(); else onClose(); }} />}
    {deleting && <ActionDialog title="이 장소를 삭제할까요?" destructive cancelLabel="취소" confirmLabel="삭제하기" busy={busy} busyLabel="삭제 중…" onClose={dismissDelete} onConfirm={remove}>
      <strong className="delete-dialog-name">{place.name}</strong>{place.address && <p className="delete-dialog-address">{place.address}</p>}<p>두 사람의 지도에서 삭제돼요.<br />이 장소의 메모와 저장 기록도 함께 사라져요.</p>{error && <p className="error" role="alert">{error}</p>}
    </ActionDialog>}</>;
}
