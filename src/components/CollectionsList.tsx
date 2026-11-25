"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { collectionName, type CollectionCommand, type CollectionResult, type CollectionView } from "@/lib/collections";
import { PALETTE_LABEL, collectionEmoji, duplicateNote } from "@/lib/palette";
import { FREQUENT_EMOJI } from "@/lib/emoji";
import type { FoldersResponse } from "@/lib/folders";
import { friendlyMessage, requestJson, RequestError, ConnectionError } from "@/lib/client-request";
import { VerifiedWrite, CHECKING_SAVE } from "@/lib/verified-write";
import { collectionUndo } from "@/lib/collection-undo";
import { distanceM, placeMeta, type PlaceView } from "@/lib/place-view";
import { categoryIcon } from "@/lib/place-presentation";
import { STATUS_LABEL } from "@/lib/types";
import { PLACE_STATUS_ENABLED } from "@/lib/features";
import { useBoardState, useBoardSync } from "./BoardProvider";
import Icon from "./Icon";
import Modal from "./Modal";
import ActionDialog from "./ActionDialog";
import SwipeablePlaceRow from "./SwipeablePlaceRow";
import PlaceDeleteDialog from "./PlaceDeleteDialog";
import PlacesDeleteDialog from "./PlacesDeleteDialog";
import FolderTransferDialog from "./FolderTransferDialog";
import { canDeletePlace } from "@/lib/place-view";
import SelectedPlacesBar from "./SelectedPlacesBar";
import EmojiPicker from "./EmojiPicker";
import { CollectionCover, ColorSwatches, Emoji, FieldLabel, RoomBand, toneStyle } from "./Palette";
import styles from "./CollectionsList.module.css";

const EMPTY: CollectionView[] = [];
type Editor = { id: string; version?: number; name: string; description: string; color: CollectionView["color"]; icon: CollectionView["icon"] };
type Dialog = "editor" | "picker" | "places" | "delete" | "remove" | null;
export default function CollectionsList({ places, visible, collections = EMPTY, currentId, mode, loaded, tools, onNavigate, onOpen, onMap, onReset, newPlaceIds, distanceOrigin, who }: {
  who: string; places: PlaceView[]; visible: PlaceView[]; collections?: CollectionView[]; currentId: string | null;
  mode: "all" | "collections"; loaded: boolean; tools: ReactNode; distanceOrigin?: { lat: number; lng: number } | null;
  onNavigate: (mode: "all" | "collections", id?: string) => void; onOpen: (id: string) => void;
  onMap: (id: string) => void; onReset: () => void; newPlaceIds: Set<string>;
}) {
  const { store, notify, lock } = useBoardSync();
  const boardState = useBoardState(), access = boardState.access;
  const deletable = (p: PlaceView) => canDeletePlace(p, access?.who ?? "", access?.memberNames ?? [], { userId: access?.userId, memberIds: access?.memberIds });
  const navigation = useSearchParams().toString();
  const current = collections.find((c) => c.id === currentId);
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [revealedId, setRevealedId] = useState<string | null>(null), [deletingPlace, setDeletingPlace] = useState<PlaceView | null>(null);
  const [deletingPlaces, setDeletingPlaces] = useState<PlaceView[] | null>(null);
  const [transferIds, setTransferIds] = useState<string[] | null>(null);
  const workspace = useRef<HTMLElement>(null), selectionButton = useRef<HTMLButtonElement>(null);
  const [unfiled, setUnfiled] = useState(false), [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null), [editor, setEditor] = useState<Editor | null>(null);
  const [destinations, setDestinations] = useState<string[]>([]), [placeQuery, setPlaceQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [discard, setDiscard] = useState(false), [conflict, setConflict] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false), [roomColor, setRoomColor] = useState<string | null>(null);
  const [write, setWrite] = useState(() => new VerifiedWrite<CollectionResult>());
  const pendingWrite = useRef<{ id: string; command: CollectionCommand } | null>(null);
  const initialEditor = useRef(""), returnToPicker = useRef(false), flight = useRef(false);
  const activeIds = useMemo(() => new Set(places.map((p) => p.id)), [places]);
  const memberships = useMemo(() => {
    const result = new Map<string, CollectionView[]>();
    for (const c of collections) for (const id of c.place_ids) { const list = result.get(id) ?? []; list.push(c); result.set(id, list); }
    return result;
  }, [collections]);
  const wishCounts = useMemo(() => {
    const wishes = new Set(places.filter((p) => p.status === "wish").map((p) => p.id));
    return new Map(collections.map((c) => [c.id, c.place_ids.filter((id) => wishes.has(id)).length]));
  }, [places, collections]);
  const chosen = selected.filter((id) => activeIds.has(id));
  const rows = unfiled && !current ? visible.filter((p) => !memberships.has(p.id)) : visible;
  const showCollections = mode === "collections" && !currentId;
  const dirty = !!editor && JSON.stringify(editor) !== initialEditor.current;
  const frozen = busy || write.pending;
  useEffect(() => { setRevealedId(null); }, [mode, currentId, selecting, navigation, dialog]);
  useEffect(() => { setSelected([]); setSelecting(false); setUnfiled(false); setQuery(""); }, [mode, currentId]);
  useEffect(() => {
    const id = new URLSearchParams(navigation).get("organize");
    if (!loaded || !id) return;
    if (activeIds.has(id)) { setSelected([id]); setDestinations([]); setDialog("picker"); resetWrite(); }
    const url = new URL(window.location.href); url.searchParams.delete("organize"); history.replaceState(history.state, "", url.pathname + url.search);
  }, [navigation, loaded, activeIds]);
  useEffect(() => {
    if (!current && (dialog === "places" || dialog === "remove")) { setDialog(null); setSelected([]); }
  }, [current, dialog]);
  useEffect(() => {
    if (dialog !== "editor" || roomColor) return;
    let alive = true;
    requestJson<FoldersResponse>("/api/folders", { cache: "no-store", notifyBoardChange: false })
      .then((data) => { if (alive) setRoomColor(data.folders.find((f) => f.id === (data.current ?? access?.boardId))?.color ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [dialog, roomColor, access?.boardId]);
  useEffect(() => { setRoomColor(null); }, [access?.boardId]);
  useEffect(() => {
    if (!dirty && !write.pending) return;
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, busy, write.pending]);
  function resetWrite() { pendingWrite.current = null; setWrite(new VerifiedWrite()); setError(""); setConflict(false); }
  function beginEditor(c?: CollectionView, fromPicker = false) {
    resetWrite(); returnToPicker.current = fromPicker;
    const value: Editor = c ? { id: c.id, version: c.version, name: c.name, description: c.description, color: c.color, icon: c.icon } : { id: crypto.randomUUID(), name: "", description: "", color: "red", icon: "💞" };
    setEditor(value); initialEditor.current = JSON.stringify(value); setDialog("editor");
  }
  function dismiss() {
    if (busy) return;
    if (write.pending || (dialog === "editor" && dirty)) { setDiscard(true); return; }
    finishClose();
  }
  function finishClose() {
    setDiscard(false); setEmojiOpen(false); setEditor(null); resetWrite();
    if (dialog === "editor" && returnToPicker.current) { returnToPicker.current = false; setDialog("picker"); }
    else setDialog(null);
  }
  function toggle(id: string, ids: string[], set: (v: string[]) => void, limit = 200) {
    if (frozen) return;
    if (!ids.includes(id) && ids.length >= limit) { setError(`한 번에 ${limit}개까지 고를 수 있어요.`); return; }
    set(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
  }
  async function mutate(command: CollectionCommand, onDone: (r: CollectionResult) => void) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(""); setConflict(false);
    const operation = pendingWrite.current ?? { id: crypto.randomUUID(), command };
    pendingWrite.current = operation;
    try {
      const result = await write.run(
        async () => {
          try { return await requestJson<CollectionResult>("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation_id: operation.id, command: operation.command }) }); }
          catch (e) { if (e instanceof RequestError && e.code === "COLLECTION_UNCONFIRMED") throw new ConnectionError(); throw e; }
        },
        async () => (await requestJson<{ result: CollectionResult | null }>(`/api/collections?operation=${operation.id}`)).result,
        () => setError(CHECKING_SAVE),
      );
      store.invalidate(); await store.refresh();
      pendingWrite.current = null;
      onDone(result); setWrite(new VerifiedWrite());
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) { void lock(); return; }
      if (!write.pending) pendingWrite.current = null;
      if (e instanceof RequestError && ["COLLECTION_CONFLICT", "COLLECTION_NOT_FOUND", "COLLECTION_PLACE_CHANGED"].includes(e.code ?? "")) { store.invalidate(); await store.refresh(); setConflict(true); }
      setError(friendlyMessage(e, "처리 결과를 확인하지 못했어요. 다시 시도해 주세요."));
    } finally { flight.current = false; setBusy(false); }
  }
  function saveEditor() {
    if (!editor) return;
    const fields = { id: editor.id, name: collectionName(editor.name), description: editor.description.trim(), color: editor.color, icon: editor.icon };
    if (!fields.name) { setError("모음 이름을 적어 주세요."); return; }
    void mutate(editor.version ? { ...fields, action: "update", version: editor.version } : { ...fields, action: "create" }, (r) => {
      const picker = returnToPicker.current; returnToPicker.current = false; setEditor(null); setError("");
      if (picker) { setDestinations((ids) => [...new Set([...ids, r.id!])]); setDialog("picker"); }
      else { setDialog(null); if (!editor.version) onNavigate("collections", r.id); }
      notify(editor.version ? "모음을 수정했어요." : "새 모음을 만들었어요.");
    });
  }
  function openPicker() { resetWrite(); setDestinations([]); setDialog("picker"); }
  function completeMembership(r: CollectionResult, text: string) {
    setDialog(null); setSelecting(false); setSelected([]); setError("");
    focusSelectionAction(true);
    if (r.changed) notify(text, "success", { label: "실행 취소", onClick: collectionUndo(r.operation_id, async () => { store.invalidate(); await store.refresh(); }, lock) });
    else notify("이미 모두 담겨 있어요.", "info");
  }
  function reloadEditor() {
    const latest = collections.find((c) => c.id === editor?.id);
    if (latest) beginEditor(latest, returnToPicker.current); else finishClose();
  }
  function closePlaceDeletion(deleted = false) {
    const index = rows.findIndex((p) => p.id === deletingPlace?.id);
    const focusId = deleted ? (rows[index + 1] ?? rows[index - 1])?.id : deletingPlace?.id;
    setDeletingPlace(null); setRevealedId(null);
    requestAnimationFrame(() => {
      const target = focusId ? workspace.current?.querySelector<HTMLButtonElement>(`[data-place-id="${CSS.escape(focusId)}"] .place-row`) : null;
      // The deleted row cannot receive the native dialog's return focus.
      const fallback = selectionButton.current?.disabled ? null : selectionButton.current;
      (target ?? fallback ?? workspace.current?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
    });
  }
  function selectCurrentList() {
    const visibleIds = new Set(rows.map((p) => p.id));
    if (rows.every((p) => chosen.includes(p.id))) setSelected(chosen.filter((id) => !visibleIds.has(id)));
    else {
      const next = [...new Set([...chosen, ...visibleIds])];
      setSelected(next.slice(0, 200));
      if (next.length > 200) setError("한 번에 200개까지 고를 수 있어요.");
    }
  }
  function closePlacesDeletion(deleted: string[] = [], complete = false) {
    setDeletingPlaces(null);
    setSelected((ids) => complete ? [] : ids.filter((id) => !deleted.includes(id)));
    if (complete) setSelecting(false);
    focusSelectionAction(complete);
  }
  function focusSelectionAction(complete: boolean) {
    requestAnimationFrame(() => {
      const root = workspace.current?.closest(".app-root") ?? document.body;
      const action = complete ? null : root.querySelector<HTMLButtonElement>("[data-selection-actions] button:last-child:not(:disabled)");
      const header = selectionButton.current?.disabled ? null : selectionButton.current;
      (action ?? header ?? workspace.current?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
    });
  }
  function placeRow(p: PlaceView, selection: boolean, modal = false) {
    const joined = memberships.get(p.id) ?? [];
    const className = `place-row ${styles.row}${selection && chosen.includes(p.id) ? ` ${styles.checked}` : ""}`;
    const content = <>
      {selection ? <span className={styles.check}><Icon name={chosen.includes(p.id) ? "check" : "plus"} width={18} /></span> : <span className={`category-icon category-${categoryIcon(p.category)}`}><Icon name={categoryIcon(p.category)} width={26} /></span>}
      <span className="row-copy">
        <strong>{p.name} {newPlaceIds.has(p.id) && <span className="new-place-badge">NEW</span>}</strong>
        <span className={styles.metaLine}>
          <span className="row-meta">{placeMeta(p)}{distanceOrigin ? ` · ${(distanceM(distanceOrigin, p) / 1000).toFixed(1)}km` : ""}</span>
          {PLACE_STATUS_ENABLED && <span className={`status-tag ${p.status}`}>{STATUS_LABEL[p.status]}</span>}
        </span>
        <span className={styles.attribution}>
          <small className="row-sharer"><Icon name="user" width={12} height={12} />{p.sharers.length >= 2 ? `${p.sharers.length}명이 저장` : p.sharers[0] ? `${p.sharers[0]}님이 저장` : `${who}님의 장소`}</small>
          {!current && joined.length > 0 && <small className={styles.membership} title={joined.map((c) => c.name).join(", ")}><span className={styles.membershipName}>모음: {joined[0].name}</span>{joined.length > 1 && <span className={styles.membershipCount}>+{joined.length - 1}</span>}</small>}
        </span>
        {current && p.memo && <small className={styles.memo}>{p.memo}</small>}
      </span>
      {!selection && <Icon name="chevron" width={18} />}
    </>;
    if (selection) return <button type="button" key={p.id} className={className} aria-pressed={chosen.includes(p.id)} disabled={modal && frozen} onClick={() => toggle(p.id, chosen, setSelected)}>{content}</button>;
    return <SwipeablePlaceRow key={p.id} placeId={p.id} name={p.name} className={className} open={revealedId === p.id}
      onReveal={(open) => setRevealedId((id) => open ? p.id : id === p.id ? null : id)}
      onOpen={() => onOpen(p.id)} onDelete={() => { if (deletable(p)) setDeletingPlace(p); else { setRevealedId(null); notify(`${p.registrant}님이 등록한 장소라 지울 수 없어요.`, "info"); } }}>{content}</SwipeablePlaceRow>;
  }
  const dialogError = error && <div className={styles.error} role="alert"><p>{error}</p>{conflict && dialog === "editor" && <button className="btn" onClick={reloadEditor}>최신 내용 불러오기</button>}{conflict && dialog !== "editor" && <button className="btn" onClick={finishClose}>목록에서 다시 고르기</button>}</div>;
  const closeButton = <button className="icon-btn sheet-close-btn" aria-label="모음 창 닫기" disabled={busy} onClick={dismiss}><Icon name="close" width={18} /></button>;
  const label = busy ? "처리 확인 중…" : write.pending ? "처리 확인·재시도" : "";
  const roomName = boardState.snapshot?.board ?? "";
  const duplicate = editor ? duplicateNote(editor, collections) : "";
  return <section ref={workspace} data-selecting={selecting} className={`${styles.workspace}${showCollections ? ` ${styles.overview}` : ""}`} aria-label="저장한 장소와 모음">
    {deletingPlace && <PlaceDeleteDialog place={deletingPlace} onClose={() => closePlaceDeletion()} onDeleted={() => closePlaceDeletion(true)} />}
    {transferIds && <FolderTransferDialog ids={transferIds} onClose={() => setTransferIds(null)} onDone={(result) => {
      setTransferIds(null); setSelecting(false); setSelected([]);
      notify(`${transferIds.length}곳을 ‘${result.folder}’ 방에 담았어요.`);
    }} />}
    {deletingPlaces && <PlacesDeleteDialog places={deletingPlaces} onClose={closePlacesDeletion} onDeleted={() => closePlacesDeletion([], true)} />}
    <div className={styles.switch} aria-label="리스트 보기 방식"><button aria-pressed={mode === "all" && !currentId} onClick={() => onNavigate("all")}>전체 장소 <span className="switch-count">{places.length}</span></button><button aria-pressed={mode === "collections" || !!currentId} onClick={() => onNavigate("collections")}>모음 <span className="switch-count">{collections.length}</span></button></div>
    <div className={current ? styles.detailLayout : undefined}>
    {current && <header className={styles.detail} style={toneStyle(current.color)}>
      <div className={styles.detailNav}><button className="text-btn" onClick={() => onNavigate("collections")}><Icon name="back" width={18} />모음</button><button className="text-btn" onClick={() => beginEditor(current)}>편집</button></div>
      <div className={styles.detailTitle}><CollectionCover color={current.color} icon={current.icon} /><div><h2>{current.name}</h2><p className={styles.count}>{current.place_ids.length}곳{PLACE_STATUS_ENABLED && ` · 가고 싶은 곳 ${wishCounts.get(current.id) ?? 0}`}</p></div></div>{current.description && <p className={styles.description}>{current.description}</p>}
      <div className={styles.detailActions}><button className={`btn ${styles.mapButton}`} disabled={!current.place_ids.length} onClick={() => onMap(current.id)}><Icon name="map" width={18} />지도에서 보기</button><button className="btn" disabled={selecting} onClick={() => { resetWrite(); setSelected([]); setPlaceQuery(""); setDialog("places"); }}><Icon name="plus" width={18} />장소 담기</button></div>
    </header>}
    <div className={styles.content}>
    {showCollections ? <>
      <div className={styles.heading}><h2>모음 <small>{collections.length}개</small></h2></div>
      {collections.length > 4 && <label className={styles.search}><Icon name="search" width={18} /><input aria-label="모음 이름 검색" placeholder="모음 이름으로 찾기" value={query} maxLength={40} onChange={(e) => setQuery(e.target.value)} /></label>}
      <div className={styles.grid}>{collections.filter((c) => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((c) => <button className={styles.card} key={c.id} style={toneStyle(c.color)} onClick={() => onNavigate("collections", c.id)}><CollectionCover color={c.color} icon={c.icon} /><strong>{c.name}</strong><span>{c.place_ids.length}곳{PLACE_STATUS_ENABLED && ` · 가고 싶은 곳 ${wishCounts.get(c.id) ?? 0}`}</span></button>)}{loaded && collections.length > 0 && <button className={`${styles.card} ${styles.addCard}`} onClick={() => beginEditor()}><Icon name="plus" width={26} /><span>새 모음</span></button>}</div>
      {loaded && !collections.length && <div className={styles.empty}><Icon name="heart" width={36} /><h3>함께 갈 곳을 모아봐요</h3><p>‘부산 주말’, ‘비 오는 날’처럼<br />다시 찾고 싶은 이름을 붙여보세요.</p><button className="btn primary" onClick={() => beginEditor()}>첫 모음 만들기</button></div>}
      {query && !collections.some((c) => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && <p className={styles.empty}>이 이름의 모음은 없어요.</p>}
    </> : <>
      <div className={styles.heading}><h2 aria-live={selecting ? "polite" : undefined} className={current && !selecting ? styles.subheading : undefined}>{selecting ? `${chosen.length}곳 선택` : current ? `장소 ${rows.length}` : <>저장한 장소 <small>{rows.length}곳</small></>}</h2><div className={styles.tools}>
        
        <button ref={selectionButton} className="text-btn" disabled={!loaded || (!rows.length && !selecting)} onClick={() => { setSelecting(!selecting); setSelected([]); }}>{selecting ? "취소" : "선택"}</button>
      </div></div>
      <div className={styles.filters}>{tools}{!current && <button className="chip" aria-pressed={unfiled} onClick={() => setUnfiled(!unfiled)}>미분류 {places.filter((p) => !memberships.has(p.id)).length}</button>}</div>
      {selecting && <div className={styles.selectionHint}><button className="text-btn" disabled={!rows.length} onClick={selectCurrentList}>{rows.length > 0 && rows.every((p) => chosen.includes(p.id)) ? "현재 목록 해제" : "현재 목록 선택"}{rows.length > 200 ? " (최대 200곳)" : ""}</button>{current && <button className="text-btn" disabled={!chosen.length} onClick={() => { resetWrite(); setDialog("remove"); }}>이 모음에서 빼기</button>}{chosen.some((id) => !rows.some((p) => p.id === id)) && <span>숨겨진 선택 {chosen.filter((id) => !rows.some((p) => p.id === id)).length}곳 포함</span>}</div>}
      {rows.map((p) => placeRow(p, selecting))}
      {loaded && !rows.length && <div className={styles.empty}>{current ? <CollectionCover color={current.color} icon={current.icon} size={56} className={styles.emptyCover} /> : <Icon name="heart" width={32} />}<h3>{current && !current.place_ids.length ? "이 모음에 장소를 담아봐요" : unfiled ? "미분류 장소가 없어요" : places.length ? "조건에 맞는 장소가 없어요" : "첫 장소를 담아 봐요"}</h3><p>{current && !current.place_ids.length ? "이미 저장한 장소에서 골라 담을 수 있어요." : "저장한 장소는 여기에서 함께 볼 수 있어요."}</p>{current && !current.place_ids.length ? <button className="btn" onClick={() => { resetWrite(); setSelected([]); setPlaceQuery(""); setDialog("places"); }}>장소 담기</button> : places.length > 0 && <button className="text-btn" onClick={() => { setUnfiled(false); onReset(); }}>전체 장소 보기</button>}</div>}
      {selecting && <SelectedPlacesBar workspace={workspace} count={chosen.length} onCollect={openPicker} onTransfer={() => setTransferIds(chosen)} onDelete={() => {
        const picked = places.filter((p) => chosen.includes(p.id)), mine = picked.filter(deletable);
        if (!mine.length) { notify("내가 등록한 장소만 지울 수 있어요.", "info"); return; }
        if (mine.length < picked.length) notify(`다른 사람이 등록한 ${picked.length - mine.length}곳은 빼고 지울게요.`, "info");
        setDeletingPlaces(mine);
      }} />}
    </>}
    </div></div>
    {!dialog && dialogError}
    {dialog === "editor" && editor && <Modal title={editor.version ? "모음 수정" : "새 모음"} initialStop={2} fullScreenAtMax className={`${styles.modal} ${styles.editorModal}`} headerActions={closeButton} onClose={() => { if (!emojiOpen) dismiss(); }} footer={<div className="actions"><button className="btn primary" form="collection-editor" disabled={busy || conflict || !collectionName(editor.name)}>{label || (editor.version ? "저장" : "만들기")}</button></div>}>
      <form id="collection-editor" onSubmit={(e) => { e.preventDefault(); saveEditor(); }} className={styles.editor}>
        {roomName && <p className={styles.inRoom}>{roomColor && <RoomBand color={roomColor} shape="square" />}<span>‘<b>{roomName}</b>’ {editor.version ? "안의 모음이에요" : "안에 만들어요"}</span></p>}
        <div className={styles.coverWrap}>
          <button type="button" className={styles.coverButton} disabled={frozen} aria-haspopup="dialog" aria-label={`표지 이모지 바꾸기, 지금 ${collectionEmoji(editor.icon)}`} onClick={() => setEmojiOpen(true)}>
            <CollectionCover color={editor.color} icon={editor.icon} size={120} />
            <span className={styles.editBadge} aria-hidden="true"><Icon name="edit" width={18} /></span>
          </button>
          <span className={styles.coverHint}>이모지를 탭해서 변경</span>
        </div>
        <FieldLabel htmlFor="collection-name" aside={<small>{editor.name.length}/40</small>}>모음 이름</FieldLabel>
        <input id="collection-name" className={styles.nameField} autoFocus={!editor.version} disabled={frozen} value={editor.name} maxLength={40} placeholder="예: 성수 카페 투어" enterKeyHint="done" onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
        <FieldLabel aside={<b>{PALETTE_LABEL[editor.color]}</b>}>색</FieldLabel>
        <ColorSwatches value={editor.color} disabled={frozen} label="모음 색" onChange={(color) => setEditor({ ...editor, color })} />
        {duplicate && <p className={styles.dupNote} role="status">{duplicate}</p>}
        <FieldLabel>자주 쓰는 이모지</FieldLabel>
        <div className={styles.frequent} role="group" aria-label="자주 쓰는 이모지">
          {FREQUENT_EMOJI.map((emoji) => <button key={emoji} type="button" disabled={frozen} aria-pressed={collectionEmoji(editor.icon) === emoji} aria-label={`${emoji} 표지로 쓰기`} onClick={() => setEditor({ ...editor, icon: emoji })}><Emoji value={emoji} /></button>)}
        </div>
        <FieldLabel htmlFor="collection-description" aside={<small>선택</small>}>한 줄 소개</FieldLabel>
        <textarea id="collection-description" className={styles.nameField} disabled={frozen} value={editor.description} maxLength={120} rows={2} placeholder="어떤 날 함께 가고 싶나요?" onChange={(e) => setEditor({ ...editor, description: e.target.value })} />
        {dialogError}
        {editor.version && <button type="button" className={styles.delete} disabled={frozen} onClick={() => { resetWrite(); setDialog("delete"); }}><Icon name="trash" width={18} />모음 삭제</button>}
      </form>
      {emojiOpen && <EmojiPicker value={collectionEmoji(editor.icon)} suggestions={collections.map((c) => collectionEmoji(c.icon))}
        onPick={(icon) => { setEditor((value) => value && { ...value, icon }); setEmojiOpen(false); }} onClose={() => setEmojiOpen(false)} />}
    </Modal>}
    {dialog === "picker" && <Modal title="모음에 담기" initialStop={2} fullScreenAtMax className={styles.modal} headerActions={closeButton} onClose={dismiss} footer={<div className="actions"><button className="btn" disabled={busy} onClick={dismiss}>취소</button><button className="btn primary" disabled={busy || !chosen.length || !destinations.length || conflict} onClick={() => void mutate({ action: "add", collection_ids: destinations, place_ids: chosen }, (r) => completeMembership(r, "모음에 담았어요."))}>{label || `${chosen.length}곳 담기`}</button></div>}>
      <p className={styles.lead}>여러 모음에 함께 담을 수 있어요.<br />원래 모음에서도 그대로 볼 수 있어요.</p>
      {collections.map((c) => { const count = chosen.filter((id) => c.place_ids.includes(id)).length; return <button key={c.id} className={styles.pickRow} disabled={frozen} aria-pressed={destinations.includes(c.id)} onClick={() => toggle(c.id, destinations, setDestinations, 50)}><span className={styles.check}><Icon name={destinations.includes(c.id) ? "check" : "plus"} width={18} /></span><CollectionCover color={c.color} icon={c.icon} size={40} /><span><strong>{c.name}</strong><small>{count === chosen.length && count ? "모두 담겨 있음" : count ? `${count}곳 이미 담김` : `${c.place_ids.length}곳`}</small></span></button>; })}
      <button className={`text-btn ${styles.createInPicker}`} disabled={frozen} onClick={() => beginEditor(undefined, true)}><Icon name="plus" />새 모음 만들기</button>{dialogError}
    </Modal>}
    {dialog === "places" && current && <Modal title="저장한 장소에서 담기" initialStop={2} fullScreenAtMax className={styles.modal} headerActions={closeButton} onClose={dismiss} footer={<div className="actions"><button className="btn" disabled={busy} onClick={dismiss}>취소</button><button className="btn primary" disabled={busy || !chosen.length || conflict} onClick={() => void mutate({ action: "add", collection_ids: [current.id], place_ids: chosen }, (r) => completeMembership(r, "모음에 담았어요."))}>{label || `${chosen.length}곳 담기`}</button></div>}>
      <label className={styles.search}><Icon name="search" width={18} /><input disabled={frozen} aria-label="담을 장소 검색" placeholder="장소 이름, 지역으로 찾기" value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} /></label><p className={styles.lead}>이미 담긴 장소는 제외했어요. {chosen.length}곳 선택</p>
      {places.filter((p) => !current.place_ids.includes(p.id) && `${p.name} ${p.address}`.includes(placeQuery.trim())).map((p) => placeRow(p, true, true))}
      {!places.some((p) => !current.place_ids.includes(p.id) && `${p.name} ${p.address}`.includes(placeQuery.trim())) && <p className={styles.empty}>담을 장소가 없어요.<br />검색어를 바꾸거나 새 장소를 저장해 주세요.</p>}{dialogError}
    </Modal>}
    {dialog === "delete" && editor && <ActionDialog title="이 모음을 삭제할까요?" message={`‘${editor.name}’ 모음만 삭제해요. 담겨 있던 장소와 메모는 전체 장소에 그대로 남아요.`} destructive cancelLabel="취소" confirmLabel={label || "모음 삭제"} busy={busy} onClose={() => { if (write.pending) dismiss(); else if (!busy) { resetWrite(); setDialog("editor"); } }} onConfirm={() => mutate({ action: "delete", id: editor.id, version: editor.version! }, () => { setDialog(null); setEditor(null); onNavigate("collections"); notify("모음을 삭제했어요."); })}>{dialogError}</ActionDialog>}
    {dialog === "remove" && current && <ActionDialog title={`${chosen.length}곳을 이 모음에서 뺄까요?`} message="전체 장소와 다른 모음에는 그대로 남아요." cancelLabel="취소" confirmLabel={label || "이 모음에서 빼기"} busy={busy} onClose={dismiss} onConfirm={() => mutate({ action: "remove", collection_ids: [current.id], place_ids: chosen }, (r) => completeMembership(r, "모음에서 뺐어요."))}>{dialogError}</ActionDialog>}
    {discard && <ActionDialog title={write.pending ? "처리 확인을 그만할까요?" : "작성 중인 내용을 닫을까요?"} message={write.pending ? "요청이 이미 처리되었을 수 있어요. 닫은 뒤 목록을 새로 확인해 주세요." : "저장하지 않은 변경 내용은 사라져요."} cancelLabel="계속하기" confirmLabel="닫기" onClose={() => setDiscard(false)} onConfirm={() => { store.invalidate(); finishClose(); }} />}
  </section>;
}

