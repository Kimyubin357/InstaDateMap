"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { COLLECTION_COLORS, COLLECTION_ICONS, collectionName, type CollectionCommand, type CollectionResult, type CollectionView } from "@/lib/collections";
import { friendlyMessage, requestJson, RequestError, ConnectionError } from "@/lib/client-request";
import { VerifiedWrite, CHECKING_SAVE } from "@/lib/verified-write";
import { distanceM, placeMeta, type PlaceView } from "@/lib/place-view";
import { categoryIcon } from "@/lib/place-presentation";
import { STATUS_LABEL } from "@/lib/types";
import { useBoardSync } from "./BoardProvider";
import Icon from "./Icon";
import Modal from "./Modal";
import ActionDialog from "./ActionDialog";
import styles from "./CollectionsList.module.css";

const EMPTY: CollectionView[] = [];
const COLOR_LABEL = { red: "빨강", forest: "초록", gold: "겨자", blue: "파랑" };
const ICON_LABEL = { heart: "하트", map: "지도", cup: "카페", food: "맛집", tree: "자연", culture: "문화" };
type Editor = { id: string; version?: number; name: string; description: string; color: CollectionView["color"]; icon: CollectionView["icon"] };
type Dialog = "editor" | "picker" | "places" | "delete" | "remove" | null;
export default function CollectionsList({ places, visible, collections = EMPTY, currentId, mode, loaded, tools, onNavigate, onOpen, onMap, onReset, newPlaceIds, distanceOrigin, who }: {
  who: string; places: PlaceView[]; visible: PlaceView[]; collections?: CollectionView[]; currentId: string | null;
  mode: "all" | "collections"; loaded: boolean; tools: ReactNode; distanceOrigin?: { lat: number; lng: number } | null;
  onNavigate: (mode: "all" | "collections", id?: string) => void; onOpen: (id: string) => void;
  onMap: (id: string) => void; onReset: () => void; newPlaceIds: Set<string>;
}) {
  const { store, notify, lock } = useBoardSync();
  const navigation = useSearchParams().toString();
  const current = collections.find((c) => c.id === currentId);
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [unfiled, setUnfiled] = useState(false), [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null), [editor, setEditor] = useState<Editor | null>(null);
  const [destinations, setDestinations] = useState<string[]>([]), [placeQuery, setPlaceQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [discard, setDiscard] = useState(false), [conflict, setConflict] = useState(false);
  const [undo, setUndo] = useState<{ id: string; text: string } | null>(null);
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
    if (!dirty && !write.pending) return;
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, busy, write.pending]);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 60000); return () => clearTimeout(timer);
  }, [undo]);
  function resetWrite() { pendingWrite.current = null; setWrite(new VerifiedWrite()); setError(""); setConflict(false); }
  function beginEditor(c?: CollectionView, fromPicker = false) {
    resetWrite(); returnToPicker.current = fromPicker;
    const value: Editor = c ? { id: c.id, version: c.version, name: c.name, description: c.description, color: c.color, icon: c.icon } : { id: crypto.randomUUID(), name: "", description: "", color: "red", icon: "heart" };
    setEditor(value); initialEditor.current = JSON.stringify(value); setDialog("editor");
  }
  function dismiss() {
    if (busy) return;
    if (write.pending || (dialog === "editor" && dirty)) { setDiscard(true); return; }
    finishClose();
  }
  function finishClose() {
    setDiscard(false); setEditor(null); resetWrite();
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
    if (r.changed) setUndo({ id: r.operation_id, text });
    else notify("이미 모두 담겨 있어요.", "info");
  }
  function reloadEditor() {
    const latest = collections.find((c) => c.id === editor?.id);
    if (latest) beginEditor(latest, returnToPicker.current); else finishClose();
  }
  function placeRow(p: PlaceView, selection: boolean, modal = false) {
    const joined = memberships.get(p.id) ?? [];
    return <button type="button" key={p.id} className={`place-row ${styles.row}${selection && chosen.includes(p.id) ? ` ${styles.checked}` : ""}`} aria-pressed={selection ? chosen.includes(p.id) : undefined} disabled={modal && frozen}
      onClick={() => selection ? toggle(p.id, chosen, setSelected) : onOpen(p.id)}>
      {selection ? <span className={styles.check}><Icon name={chosen.includes(p.id) ? "check" : "plus"} width={18} /></span> : <span className={`category-icon category-${categoryIcon(p.category)}`}><Icon name={categoryIcon(p.category)} width={26} /></span>}
      <span className="row-copy"><strong>{p.name} {newPlaceIds.has(p.id) && <span className="new-place-badge">NEW</span>}</strong><span className="row-meta">{placeMeta(p)}{distanceOrigin ? ` · ${(distanceM(distanceOrigin, p) / 1000).toFixed(1)}km` : ""}</span><span className={styles.rowBottom}><span className={`status-tag ${p.status}`}>{STATUS_LABEL[p.status]}</span>{!current && joined.length > 0 && <small className={styles.membership}>{joined[0].name}{joined.length > 1 ? ` +${joined.length - 1}` : ""}</small>}</span><small className="row-sharer"><Icon name="user" width={12} height={12} />{p.sharers.length >= 2 ? "둘 다 저장함" : p.sharers[0] ? `${p.sharers[0]}님이 저장` : `${who}님의 장소`}</small>{current && p.memo && <small className={styles.memo}>{p.memo}</small>}</span>
      {!selection && <Icon name="chevron" width={18} />}
    </button>;
  }
  const dialogError = error && <div className={styles.error} role="alert"><p>{error}</p>{conflict && dialog === "editor" && <button className="btn" onClick={reloadEditor}>최신 내용 불러오기</button>}{conflict && dialog !== "editor" && <button className="btn" onClick={finishClose}>목록에서 다시 고르기</button>}</div>;
  const closeButton = <button className="icon-btn sheet-close-btn" aria-label="모음 창 닫기" disabled={busy} onClick={dismiss}><Icon name="close" width={18} /></button>;
  const label = busy ? "처리 확인 중…" : write.pending ? "처리 확인·재시도" : "";
  return <section className={`${styles.workspace}${showCollections ? ` ${styles.overview}` : ""}`} aria-label="저장한 장소와 모음">
    <div className={styles.switch} aria-label="리스트 보기 방식"><button aria-pressed={mode === "all" && !currentId} onClick={() => onNavigate("all")}>전체 장소</button><button aria-pressed={mode === "collections" || !!currentId} onClick={() => onNavigate("collections")}>모음</button></div>
    <div className={current ? styles.detailLayout : undefined}>
    {current && <header className={styles.detail} style={{ "--collection-color": `var(--collection-${current.color})` } as CSSProperties}>
      <div className={styles.detailNav}><button className="text-btn" onClick={() => onNavigate("collections")}><Icon name="back" width={18} />모음</button><button className="text-btn" onClick={() => beginEditor(current)}>편집</button></div>
      <div className={styles.detailTitle}><span className={styles.tile} aria-hidden="true"><Icon name={current.icon} width={24} /></span><div><h2>{current.name}</h2><p className={styles.count}>{current.place_ids.length}곳 · 가고 싶은 곳 {wishCounts.get(current.id) ?? 0}</p></div></div>{current.description && <p className={styles.description}>{current.description}</p>}
      <div className={styles.detailActions}><button className={`btn ${styles.mapButton}`} disabled={!current.place_ids.length} onClick={() => onMap(current.id)}><Icon name="map" width={18} />지도에서 보기</button><button className="btn" disabled={selecting} onClick={() => { resetWrite(); setSelected([]); setPlaceQuery(""); setDialog("places"); }}><Icon name="plus" width={18} />장소 담기</button></div>
    </header>}
    <div className={styles.content}>
    {showCollections ? <>
      <div className={styles.heading}><h2>우리 모음 <small>{collections.length}개</small></h2></div>
      {collections.length > 4 && <label className={styles.search}><Icon name="search" width={18} /><input aria-label="모음 이름 검색" placeholder="모음 이름으로 찾기" value={query} maxLength={40} onChange={(e) => setQuery(e.target.value)} /></label>}
      <div className={styles.grid}>{collections.filter((c) => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((c) => <button className={styles.card} key={c.id} style={{ "--collection-color": `var(--collection-${c.color})` } as CSSProperties} onClick={() => onNavigate("collections", c.id)}><Icon name={c.icon} width={30} /><strong>{c.name}</strong><span>{c.place_ids.length}곳 · 가고 싶은 곳 {wishCounts.get(c.id) ?? 0}</span></button>)}{loaded && collections.length > 0 && <button className={`${styles.card} ${styles.addCard}`} onClick={() => beginEditor()}><Icon name="plus" width={26} /><span>새 모음</span></button>}</div>
      {loaded && !collections.length && <div className={styles.empty}><Icon name="heart" width={36} /><h3>함께 갈 곳을 모아봐요</h3><p>‘부산 주말’, ‘비 오는 날’처럼<br />다시 찾고 싶은 이름을 붙여보세요.</p><button className="btn primary" onClick={() => beginEditor()}>첫 모음 만들기</button></div>}
      {query && !collections.some((c) => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && <p className={styles.empty}>이 이름의 모음은 없어요.</p>}
    </> : <>
      <div className={styles.heading}><h2 className={current && !selecting ? styles.subheading : undefined}>{selecting ? `${chosen.length}곳 선택` : current ? `장소 ${rows.length}` : <>저장한 장소 <small>{rows.length}곳</small></>}</h2><div className={styles.tools}>
        
        <button className="text-btn" disabled={!loaded || (!rows.length && !selecting)} onClick={() => { setSelecting(!selecting); setSelected([]); }}>{selecting ? "취소" : "선택"}</button>
      </div></div>
      <div className={styles.filters}>{tools}{!current && <button className="chip" aria-pressed={unfiled} onClick={() => setUnfiled(!unfiled)}>미분류 {places.filter((p) => !memberships.has(p.id)).length}</button>}</div>
      {selecting && <div className={styles.selectionHint}><button className="text-btn" onClick={() => setSelected(rows.slice(0, 200).map((p) => p.id))}>현재 목록 선택{rows.length > 200 ? " (최대 200곳)" : ""}</button>{chosen.some((id) => !rows.some((p) => p.id === id)) && <span>숨겨진 선택 {chosen.filter((id) => !rows.some((p) => p.id === id)).length}곳 포함</span>}</div>}
      {rows.map((p) => placeRow(p, selecting))}
      {loaded && !rows.length && <div className={styles.empty}><Icon name={current ? current.icon : "heart"} width={32} /><h3>{current && !current.place_ids.length ? "이 모음에 장소를 담아봐요" : unfiled ? "미분류 장소가 없어요" : places.length ? "조건에 맞는 장소가 없어요" : "우리의 첫 장소를 담아봐요"}</h3><p>{current && !current.place_ids.length ? "이미 저장한 장소에서 골라 담을 수 있어요." : "저장한 장소는 여기에서 함께 볼 수 있어요."}</p>{current && !current.place_ids.length ? <button className="btn" onClick={() => { resetWrite(); setSelected([]); setPlaceQuery(""); setDialog("places"); }}>장소 담기</button> : places.length > 0 && <button className="text-btn" onClick={() => { setUnfiled(false); onReset(); }}>전체 장소 보기</button>}</div>}
      {selecting && <div className={styles.selectionBar}><button className="btn primary" disabled={!chosen.length} onClick={openPicker}>모음에 담기 · {chosen.length}</button>{current && <button className="btn" disabled={!chosen.length} onClick={() => { resetWrite(); setDialog("remove"); }}>이 모음에서 빼기</button>}</div>}
    </>}
    </div></div>
    {undo && <div className={styles.undo} role="status"><span>{undo.text}</span><button className="text-btn" disabled={busy} onClick={() => { void mutate({ action: "undo", target: undo.id }, () => { setUndo(null); notify("이번 변경을 되돌렸어요."); }); }}>{busy ? "확인 중…" : "실행 취소"}</button><button className="icon-btn" aria-label="완료 안내 닫기" disabled={busy} onClick={() => setUndo(null)}><Icon name="close" width={18} /></button></div>}
    {!dialog && dialogError}
    {dialog === "editor" && editor && <Modal title={editor.version ? "모음 수정" : "새 모음 만들기"} variant="compact" className={styles.modal} headerActions={closeButton} onClose={dismiss} footer={<div className="actions"><button className="btn" disabled={busy} onClick={dismiss}>취소</button><button className="btn primary" disabled={busy || conflict || !collectionName(editor.name)} onClick={saveEditor}>{label || (editor.version ? "변경 저장" : "모음 만들기")}</button></div>}>
      <form id="collection-editor" onSubmit={(e) => { e.preventDefault(); saveEditor(); }} className={styles.editor}>
        <label>모음 이름 <span>{editor.name.length}/40</span><input autoFocus disabled={frozen} value={editor.name} maxLength={40} placeholder="예: 부산 주말" onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
        <label>한 줄 소개 <small>선택</small><textarea disabled={frozen} value={editor.description} maxLength={120} rows={2} placeholder="어떤 날 함께 가고 싶나요?" onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></label>
        <fieldset disabled={frozen}><legend>표지 색</legend><div className={styles.swatches}>{COLLECTION_COLORS.map((color) => <button type="button" key={color} aria-label={COLOR_LABEL[color]} aria-pressed={editor.color === color} style={{ "--collection-color": `var(--collection-${color})` } as CSSProperties} onClick={() => setEditor({ ...editor, color })}>{editor.color === color && <Icon name="check" width={20} />}</button>)}</div></fieldset>
        <fieldset disabled={frozen}><legend>표지 아이콘</legend><div className={styles.icons}>{COLLECTION_ICONS.map((icon) => <button type="button" key={icon} aria-label={ICON_LABEL[icon]} aria-pressed={editor.icon === icon} onClick={() => setEditor({ ...editor, icon })}><Icon name={icon} /></button>)}</div></fieldset>
        {dialogError}
        {editor.version && <button type="button" className={styles.delete} disabled={frozen} onClick={() => { resetWrite(); setDialog("delete"); }}><Icon name="trash" width={18} />모음 삭제</button>}
      </form>
    </Modal>}
    {dialog === "picker" && <Modal title="모음에 담기" initialStop={2} fullScreenAtMax className={styles.modal} headerActions={closeButton} onClose={dismiss} footer={<div className="actions"><button className="btn" disabled={busy} onClick={dismiss}>취소</button><button className="btn primary" disabled={busy || !chosen.length || !destinations.length || conflict} onClick={() => void mutate({ action: "add", collection_ids: destinations, place_ids: chosen }, (r) => completeMembership(r, "선택한 장소를 모음에 담았어요."))}>{label || `${chosen.length}곳 담기`}</button></div>}>
      <p className={styles.lead}>여러 모음에 함께 담을 수 있어요.<br />원래 모음에서도 그대로 볼 수 있어요.</p>
      {collections.map((c) => { const count = chosen.filter((id) => c.place_ids.includes(id)).length; return <button key={c.id} className={styles.pickRow} disabled={frozen} aria-pressed={destinations.includes(c.id)} onClick={() => toggle(c.id, destinations, setDestinations, 50)}><span className={styles.check}><Icon name={destinations.includes(c.id) ? "check" : "plus"} width={18} /></span><Icon name={c.icon} /><span><strong>{c.name}</strong><small>{count === chosen.length && count ? "모두 담겨 있음" : count ? `${count}곳 이미 담김` : `${c.place_ids.length}곳`}</small></span></button>; })}
      <button className={`text-btn ${styles.createInPicker}`} disabled={frozen} onClick={() => beginEditor(undefined, true)}><Icon name="plus" />새 모음 만들기</button>{dialogError}
    </Modal>}
    {dialog === "places" && current && <Modal title="저장한 장소에서 담기" initialStop={2} fullScreenAtMax className={styles.modal} headerActions={closeButton} onClose={dismiss} footer={<div className="actions"><button className="btn" disabled={busy} onClick={dismiss}>취소</button><button className="btn primary" disabled={busy || !chosen.length || conflict} onClick={() => void mutate({ action: "add", collection_ids: [current.id], place_ids: chosen }, (r) => completeMembership(r, "이 모음에 장소를 담았어요."))}>{label || `${chosen.length}곳 담기`}</button></div>}>
      <label className={styles.search}><Icon name="search" width={18} /><input disabled={frozen} aria-label="담을 장소 검색" placeholder="장소 이름, 지역으로 찾기" value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} /></label><p className={styles.lead}>이미 담긴 장소는 제외했어요. {chosen.length}곳 선택</p>
      {places.filter((p) => !current.place_ids.includes(p.id) && `${p.name} ${p.address}`.includes(placeQuery.trim())).map((p) => placeRow(p, true, true))}
      {!places.some((p) => !current.place_ids.includes(p.id) && `${p.name} ${p.address}`.includes(placeQuery.trim())) && <p className={styles.empty}>담을 장소가 없어요.<br />검색어를 바꾸거나 새 장소를 저장해 주세요.</p>}{dialogError}
    </Modal>}
    {dialog === "delete" && editor && <ActionDialog title="이 모음을 삭제할까요?" message={`‘${editor.name}’ 모음만 삭제해요. 담겨 있던 장소와 메모는 전체 장소에 그대로 남아요.`} destructive cancelLabel="취소" confirmLabel={label || "모음 삭제"} busy={busy} onClose={() => { if (write.pending) dismiss(); else if (!busy) { resetWrite(); setDialog("editor"); } }} onConfirm={() => mutate({ action: "delete", id: editor.id, version: editor.version! }, () => { setDialog(null); setEditor(null); onNavigate("collections"); notify("모음을 삭제했어요. 장소는 그대로 남아 있어요."); })}>{dialogError}</ActionDialog>}
    {dialog === "remove" && current && <ActionDialog title={`${chosen.length}곳을 이 모음에서 뺄까요?`} message="전체 장소와 다른 모음에는 그대로 남아요." cancelLabel="취소" confirmLabel={label || "이 모음에서 빼기"} busy={busy} onClose={dismiss} onConfirm={() => mutate({ action: "remove", collection_ids: [current.id], place_ids: chosen }, (r) => completeMembership(r, "이 모음에서 장소를 뺐어요."))}>{dialogError}</ActionDialog>}
    {discard && <ActionDialog title={write.pending ? "처리 확인을 그만할까요?" : "작성 중인 내용을 닫을까요?"} message={write.pending ? "요청이 이미 처리되었을 수 있어요. 닫은 뒤 목록을 새로 확인해 주세요." : "저장하지 않은 변경 내용은 사라져요."} cancelLabel="계속하기" confirmLabel="닫기" onClose={() => setDiscard(false)} onConfirm={() => { store.invalidate(); finishClose(); }} />}
  </section>;
}
