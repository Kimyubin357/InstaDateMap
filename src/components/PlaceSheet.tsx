"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import MapPlaceSheet from "./MapPlaceSheet";
import Icon from "./Icon";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { STATUS_ORDER, type PlaceView, placeMeta, canDeletePlace } from "@/lib/place-view";
import { requestJson, RequestError } from "@/lib/client-request";
import { CHECKING_SAVE, VerifiedWrite, UnconfirmedWriteError } from "@/lib/verified-write";
import { verifyDeletedPlace, verifyPlacePatch, verifyMemoSave, placeUrl } from "@/lib/save-recovery";
import MapCanvas from "./MapCanvas";
import { OpenChip, PlaceBooking, PlaceInfo, PlaceMenus, PlacePhotos, usePlaceDetails } from "./PlaceDetailParts";
import { distanceLabel } from "@/lib/place-brief";
import { distanceM } from "@/lib/place-view";
import { toneStyle } from "./Palette";
import styles from "./PlaceSheet.module.css";
import ActionDialog from "./ActionDialog";
import { useBoardState, useBoardSync } from "./BoardProvider";
import { placeCopyContent } from "@/lib/place-presentation";
import { StatusSelection } from "@/lib/status-selection";
import { PLACE_STATUS_ENABLED } from "@/lib/features";
import ShellLink from "./ShellLink";
import { navigateShell } from "@/lib/shell-navigation";
import FolderTransferDialog from "./FolderTransferDialog";
const ignore = () => {};
/** 전체 보기에서 이 기기가 연 방이 아닌 다른 방의 장소: 그 방에서의 내 이름과 지금 멤버(삭제 권한), 요청은 ?room= 으로 그 방에. */
export interface PlaceRoom { id: string; who: string; memberNames: string[]; memberIds: string[] }
/** Share mutations and draft protection; map/list components own their UI independently. */
export default function PlaceSheet({ place, kakaoKey, onClose, onShowMap, onPatch, onDelete, room, rooms, origin, faceOf, onOrganize }: { place: PlaceView; kakaoKey: string; view: "map" | "list"; onClose: () => void; onShowMap: () => void; onPatch: (patch: { status?: PlaceStatus; memo?: string; memo_version?: number }) => void; onDelete: () => void;
  room?: PlaceRoom;
  /** 이 장소가 있는 방(이름 밑 방 칩). 전체 보기에서는 여러 개일 수 있습니다. */
  rooms?: readonly { id: string; name: string; color?: string | null }[];
  /** 현재 위치(거리 표시). 없으면 거리를 숨깁니다. */
  origin?: { lat: number; lng: number } | null;
  /** 저장한 사람 이름 → 프로필 사진 */
  faceOf?: (name: string) => string | null | undefined;
  /** 전체 보기: 모음 정리는 그 방에 들어가서 합니다. */
  onOrganize?: () => void }) {
  const { notify, store, lock } = useBoardSync();
  const [transferring, setTransferring] = useState(false);
  const access = useBoardState().access;
  const deletable = room ? canDeletePlace(place, room.who, room.memberNames, { userId: access?.userId, memberIds: room.memberIds })
    : canDeletePlace(place, access?.who ?? "", access?.memberNames ?? [], { userId: access?.userId, memberIds: access?.memberIds });
  const url = placeUrl(place.id, room?.id);
  const copy = placeCopyContent(place);
  const organizeHref = `/?view=list&organize=${encodeURIComponent(place.id)}`;
  const [memoWrite] = useState(() => new VerifiedWrite<{ memo: string; memo_version: number }>());
  const [statusWrite] = useState(() => new VerifiedWrite<{ status: PlaceStatus }>());
  const [deletion] = useState(() => new VerifiedWrite<{ ok: boolean; deleted_id: string }>());
  const [memoPending, setMemoPending] = useState(false), [statusPending, setStatusPending] = useState(false);
  const [activity, setActivity] = useState("");
  function mutationError(error: unknown) {
    if (error instanceof RequestError && error.code === "MEMO_CONFLICT") {
      const current = error.details!;
      memoBase.current = Number(current.memo_version);
      setMemoConflict({ memo: String(current.memo || ""), who: typeof current.memo_updated_by === "string" ? current.memo_updated_by : "상대방" });
      setActivity(""); return;
    }
    if (error instanceof RequestError && [401, 409].includes(error.status)) { void lock(); return; }
    if (error instanceof RequestError && error.status === 404 && error.code === "PLACE_NOT_FOUND") {
      onDelete(); void store.refresh(); notify("이미 삭제된 장소예요.", "error"); return;
    }
    if (error instanceof UnconfirmedWriteError) setActivity(error.message);
    else { setActivity(""); notify(error instanceof Error ? error.message : "저장하지 못했어요.", "error"); }
  }
  const checking = () => setActivity(CHECKING_SAVE);
  const [statusSelection] = useState(() => new StatusSelection(place.status, async (status) => {
    const patch = await statusWrite.run(async () => { await requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); return { status }; }, () => verifyPlacePatch(place.id, { status }, room?.id), checking);
    onPatch(patch); setActivity("");
  }, ignore, (error) => { setStatusPending(statusWrite.pending); mutationError(error); }));
  const status = useSyncExternalStore(statusSelection.subscribe, statusSelection.getSnapshot, statusSelection.getSnapshot);
  useEffect(() => { statusSelection.receive(place.status); }, [place.status, status.pending, statusSelection]);
  const [memo, setMemo] = useState(place.memo || ""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [savedEarlierMemo, setSavedEarlierMemo] = useState(false);
  const memoDirty = memo !== (place.memo || "");
  const memoDraft = useRef(memo); memoDraft.current = memo;
  const deleteRequest = useRef(false);
  const lastMemo = useRef(place.memo || "");
  const memoBase = useRef(place.memo_version ?? 0);
  const [memoConflict, setMemoConflict] = useState<{ memo: string; who: string } | null>(null);
  useEffect(() => {
    const incoming = place.memo || "", previous = lastMemo.current;
    if (memoDraft.current === previous && !memoConflict) { setMemo(incoming); memoBase.current = place.memo_version ?? 0; }
    lastMemo.current = incoming;
  }, [place.memo, place.memo_version, memoConflict]);
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState<"close" | "map" | "organize" | null>(null);
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
  const info = usePlaceDetails(place.id, room?.id);
  function leave(destination: "close" | "map" | "organize") {
    if (destination === "map") onShowMap();
    else if (destination === "organize") { if (onOrganize) onOrganize(); else navigateShell(organizeHref); }
    else onClose();
  }
  function requestLeave(destination: "close" | "map" | "organize") {
    if (memoDirty) setLeaving(destination);
    else leave(destination);
  }
  /** 저장이 끝나면 true(나가기 확인 창의 '저장하고 닫기'가 이어서 닫습니다). */
  async function saveMemo(): Promise<boolean> {
    if (busy) return false;
    const value = { memo };
    const expected = memoBase.current;
    setBusy(true); setError("");
    try {
      const saved = await memoWrite.run(async () => { const result = await requestJson<{ memo_version: number }>(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, memo_version: expected }) }); return { ...value, memo_version: result.memo_version }; }, () => verifyMemoSave(place.id, value.memo, expected, room?.id), checking);
      memoBase.current = saved.memo_version; setMemoConflict(null); lastMemo.current = saved.memo;
      setSavedEarlierMemo(saved.memo !== memoDraft.current);
      onPatch(saved); setActivity("");
      if (saved.memo === memoDraft.current) notify("메모를 저장했어요.");
      return true;
    } catch (e) { mutationError(e); return false; } finally { setMemoPending(memoWrite.pending); setBusy(false); }
  }
  async function retryStatus() {
    if (busy || !statusWrite.pending) return;
    setBusy(true);
    try {
      const patch = await statusWrite.run(async () => { throw new Error("확인할 상태가 없어요."); }, async () => null, checking);
      onPatch(patch); setActivity("");
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
      const result = await deletion.run(() => requestJson<{ ok: boolean; deleted_id: string }>(url, { method: "DELETE" }), () => verifyDeletedPlace(place.id, room?.id), () => setError("응답이 늦어지고 있어요. 삭제 여부를 확인할게요."));
      if (result.ok !== true || result.deleted_id !== place.id) throw new Error("삭제 결과를 확인하지 못했어요. 다시 시도해 주세요.");
      onDelete(); notify("삭제한 장소로 옮겼어요.");
    }
    catch (e) { if (e instanceof RequestError && [401, 409].includes(e.status)) { void lock(); return; } setError(e instanceof Error ? e.message : "삭제하지 못했어요. 다시 시도해 주세요."); }
    finally { deleteRequest.current = false; setBusy(false); }
  }
  const closeSheet = busy || deleting || leaving ? () => {} : () => requestLeave("close");
  const meta = [placeMeta(place), origin ? distanceLabel(distanceM(origin, place)) : ""].filter(Boolean).join(" · ");
  const saver = place.sharers.length >= 2 ? `${place.sharers.length}명이 저장` : place.sharers[0] ? `${place.sharers[0]}님이 저장` : "";
  const savedOn = new Date(place.created_at).toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" });
  const route = `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
  async function copyAddress() {
    try { await navigator.clipboard.writeText(copy.text); notify(`${copy.object} 복사했어요.`); }
    catch { notify(`${copy.object} 복사하지 못했어요. ${copy.object} 길게 눌러 복사해 주세요.`, "error"); }
  }
  // 끝까지 올린 창: 본문 맨 위 이름이 머리에 가려지면 ‹ 옆으로 이름을 올립니다(네이버 상세처럼).
  const bodyTitle = useRef<HTMLHeadingElement>(null);
  const [titleUp, setTitleUp] = useState(false);
  useEffect(() => {
    const el = bodyTitle.current, root = el?.closest(".sheet-body");
    if (!el || !root) return;
    // 이름 글자가 머리 밑으로 조금이라도 들어가면 바로 올립니다(본문 영역 = 머리 바로 아래부터).
    const observer = new IntersectionObserver(([entry]) => setTitleUp(entry.intersectionRatio < 1 && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) + 1), { root, threshold: [0, 1] });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const titleBlock = (body: boolean) => <>
    <h2 ref={body ? bodyTitle : undefined} className={styles.name}>{place.name}{PLACE_STATUS_ENABLED && <span className={`status-tag ${status.status}`}>{STATUS_LABEL[status.status]}</span>}</h2>
    {meta && <p className={styles.meta}>{meta}</p>}
    <div className={styles.chips}>
      <OpenChip details={info.details} />
      {(rooms ?? []).map((r) => <span key={r.id} className={styles.roomChip} style={toneStyle(r.color)}><i aria-hidden="true" />{r.name}</span>)}
    </div>
    {body && null}
  </>;
  const actions = <div className={styles.actions}>
    <a className={`btn primary ${styles.route}`} href={route} target="_blank" rel="noreferrer"><Icon name="arrow" width="18" />길찾기</a>
    <ShellLink className={`btn ${styles.act}`} href={organizeHref} aria-disabled={busy || status.pending} onClick={(event) => {
      if (busy || status.pending) { event.preventDefault(); return; }
      if (memoDirty && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { event.preventDefault(); setLeaving("organize"); }
      else if (onOrganize) { event.preventDefault(); onOrganize(); }
    }}><Icon name="collection" width="18" />모음에 담기</ShellLink>
    {deletable && <button type="button" className={`btn ${styles.act}`} disabled={busy || status.pending} onClick={() => setTransferring(true)}><Icon name="moveRoom" width="18" />옮기기</button>}
  </div>;
  return <><MapPlaceSheet title={place.name} onClose={closeSheet}
    summary={<div className={`detail-title ${styles.summary}${titleUp ? ` ${styles.titleUp}` : ""}`}>
      <div className={styles.full}>{titleBlock(false)}</div>
      <strong className={styles.compact} aria-hidden="true">{place.name}</strong>
    </div>}
    closeAction={<button type="button" className="icon-btn sheet-close-btn" aria-label="닫기" disabled={busy} onClick={closeSheet}><Icon name="close" width="18" /></button>}
    footer={actions}
    overview={<>
      {/* 끝까지 올린 창에서만 보이는 본문 머리(이름·분류·칩). 시트일 때는 머리의 요약이 같은 내용을 보여 줍니다. */}
      <div className={styles.bodyTitle}>{titleBlock(true)}</div>
      <PlacePhotos details={info.details} loading={info.loading} />
    </>}
    details={<>
    {statusPending && <button className="text-btn" disabled={busy} onClick={retryStatus}>상태 저장 확인·재시도</button>}
    {activity && <p className="notice" role="status">{activity}</p>}
    {memoConflict && <section className="memo-conflict" role="alert"><p>{memoConflict.who}님이 메모를 먼저 바꿨어요. 위 내용을 참고해 아래 초안을 정리한 뒤 저장해 주세요.</p><strong>현재 저장된 메모</strong><p className="memo-conflict-current">{memoConflict.memo || "(빈 메모)"}</p></section>}
    {PLACE_STATUS_ENABLED && <><div className="detail-section-heading"><span className="section-label">어떤 곳인가요?</span></div>
    <div className="seg four place-status" role="group" aria-label="장소 상태" aria-busy={status.pending}>{STATUS_ORDER.map((s) => <button key={s} className={`place-status-${s}`} disabled={busy || statusPending || memoPending} aria-pressed={status.status === s} onClick={() => statusSelection.select(s)}>{STATUS_LABEL[s]}</button>)}</div></>}
    <div className={styles.memo}>
      {memoConflict && <label className="section-label" htmlFor="place-memo">내 초안 · 수정해서 저장</label>}
      <textarea id="place-memo" className="memo" aria-label="메모" aria-describedby={savedEarlierMemo && memoDirty ? "memo-unsaved-hint" : undefined} placeholder="메모를 남겨 보세요" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} rows={2} />
      {(memoDirty || memoPending || memoConflict) && <div className="memo-footer"><small>{memo.length}/500</small><button className="text-btn" disabled={busy || status.pending || statusPending || (!memoPending && !memoConflict && !memoDirty)} onClick={saveMemo}>{busy ? "저장 확인 중…" : memoPending ? "메모 저장 확인·재시도" : "메모 저장"}</button></div>}
      {savedEarlierMemo && memoDirty && <p id="memo-unsaved-hint" className="hint" role="status">새로 쓴 내용은 아직 저장되지 않았어요.</p>}
    </div>
    <PlaceInfo details={info.details} address={place.address} onCopyAddress={() => void copyAddress()} error={info.error} onRetry={info.retry} />
    <PlaceMenus details={info.details} />
    <PlaceBooking details={info.details} />
    {place.sources.map((source, index) => <a key={source.url} className={styles.insta} href={source.url} target="_blank" rel="noreferrer">
      <span className={styles.instaIcon} aria-hidden="true"><Icon name="instagram" width="22" /></span>
      <span className={styles.instaText}><b>원본 인스타{place.sources.length > 1 ? ` ${index + 1}` : ""}</b><span>{source.media_type === "reel" ? "릴스" : "게시물"} 보러 가기</span></span>
      <Icon name="chevron" width="18" />
    </a>)}
    {saver && <p className={styles.byline}>{place.sharers.slice(0, 2).map((n, i) => { const src = faceOf?.(n);
      // eslint-disable-next-line @next/next/no-img-element
      return src ? <img key={`${n}-${i}`} src={src} alt="" referrerPolicy="no-referrer" /> : <i key={`${n}-${i}`} aria-hidden="true"><Icon name="user" width="12" /></i>; })}<span>{saver} · {savedOn}</span></p>}
    {!place.sources.length && <p className="hint">장소를 직접 찾아 저장했어요.</p>}
    <div className={`detail-map ${styles.mini}`}><MapCanvas places={preview} selectedId={place.id} apiKey={kakaoKey} active initialPosition={{ lat: place.lat, lng: place.lng, level: 4 }} onPosition={ignore} onPick={ignore} location={null} viewRequest={null} interactive={false} /><button className="preview-map-button" disabled={busy} onClick={() => requestLeave("map")}><Icon name="pin" width="15" />지도에서 보기<Icon name="arrow" width="15" /></button></div>
    {deletable ? <button ref={deleteButton} className={styles.delete} disabled={busy || status.pending} onClick={requestDelete}><Icon name="trash" width="19" />장소 삭제</button>
      : <p className="hint place-delete-hint">옮기기·삭제는 처음 등록한 {place.registrant}님만 할 수 있어요.</p>}
    </>} />{leaving && <ActionDialog title="메모를 저장할까요?" message="저장하지 않으면 쓴 내용은 사라져요." tone="info" icon="edit" confirmTone="green" cancelLabel="저장 안 함" confirmLabel="저장하고 닫기" busy={busy} busyLabel="저장 중…"
      // 바깥을 누르거나 Esc = 계속 쓰기. 저장에 실패하면(충돌 등) 창을 닫아 상세의 안내를 보여 줍니다.
      onClose={() => setLeaving(null)}
      onCancel={() => { const destination = leaving; setLeaving(null); leave(destination); }}
      onConfirm={async () => { const destination = leaving; const saved = await saveMemo(); setLeaving(null); if (saved) leave(destination); }} />}
    {transferring && <FolderTransferDialog ids={[place.id]} from={room?.id} onClose={() => setTransferring(false)} onDone={(result) => {
      // 지금 방에서는 빠졌으니 상세를 닫고 목록·지도에서 바로 뺍니다(서버 확인은 변경 알림으로 다시 받음).
      setTransferring(false); onDelete(); notify(`‘${result.folder}’ 방으로 옮겼어요.`);
    }} />}
    {deleting && <ActionDialog title="이 장소를 삭제할까요?" destructive cancelLabel="취소" confirmLabel="삭제하기" busy={busy} busyLabel="삭제 중…" onClose={dismissDelete} onConfirm={remove}>
      <strong className="delete-dialog-name">{place.name}</strong>{place.address && <p className="delete-dialog-address">{place.address}</p>}<p>이 방에서 바로 빠져요.<br />설정의 ‘삭제한 장소’(나만 보는 기록)에서 메모와 원본 링크까지 되돌릴 수 있어요.</p>{error && <p className="error" role="alert">{error}</p>}
    </ActionDialog>}</>;
}
