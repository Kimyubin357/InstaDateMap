"use client";
import { analysisMessage, analysisRecovery } from "@/lib/analysis-issue";
import { workId } from "@/lib/work-id";
import { useSourceSession } from "@/components/useSourceSession";
import DismissSource from "@/components/DismissSource";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KakaoPlace } from "@/lib/types";
import { requestJson, RequestError } from "@/lib/client-request";
import { CHECKING_SAVE, VerifiedWrite } from "@/lib/verified-write";
import { verifyConfirmation, verifySharedLink, type ConfirmSaved } from "@/lib/save-recovery";
import ManualPlaceSearch from "@/components/ManualPlaceSearch";
import PageHeader from "@/components/PageHeader";
import ClientReady from "@/components/ClientReady";
import Icon from "@/components/Icon";
import { RoomLine } from "@/components/RoomChooser";
import { BranchSheet, NameSearchSheet } from "@/components/PlaceFinderSheets";
import type { ShareResult } from "@/lib/share-stream";
import { savedMapHref, shareDestination } from "@/lib/share-navigation";
import { useBoardSync } from "@/components/BoardProvider";
import { aiIssueCopy, confirmPlan, initialChoice, pickedPlace, rowOptions, rowState, searchSuggestions, selectionsToSend, type RowChoice } from "@/lib/registration";
import { placeIdFrom, rememberJustSaved } from "@/lib/saved-memory";
import type { FolderIcon } from "@/lib/folders";
import styles from "@/components/Registration.module.css";

export interface ExtractionView {
  id: string;
  module: string;
  name: string;
  rawName: string;
  branch: string | null;
  areaHint: string | null;
  candidates: KakaoPlace[];
  excluded?: boolean;
}
export interface ConfirmRoom { id: string; name: string; color?: string | null; icon?: string | null }

type Sheet = { kind: "search" | "branch"; id: string } | null;

/**
 * 장소 확인(시안 4–8번). 장소마다 상태 하나 + 바로 옆의 다음 행동.
 * 아래 버튼은 모두 준비되면 'N곳 담기', 남은 장소가 있으면 남은 일을 말합니다.
 * 0곳 완료는 '이 링크 정리하기' 확인창으로만 합니다(서버도 0곳 확인을 거절).
 */
export default function ConfirmForm({ source, extractions, room }: {
  source: { id: string; url: string; status: string; version: string; recoveryReason?: string | null };
  extractions: ExtractionView[];
  room: ConfirmRoom;
}) {
  const router = useRouter();
  const session = useSourceSession(source.id, source.version);
  const { store } = useBoardSync();
  const [choices, setChoices] = useState<Record<string, RowChoice>>(() => Object.fromEntries(extractions.map((e) => [e.id, initialChoice(e)])));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [recoveryReason, setRecoveryReason] = useState(source.recoveryReason);
  const [manual, setManual] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmationWrite] = useState(() => new VerifiedWrite<ConfirmSaved>());
  const [reprocessWrite] = useState(() => new VerifiedWrite<ShareResult>());
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const pending = confirmationWrite.pending || reprocessWrite.pending;
  const locked = !session.ready || saving || reprocessing || pending || leaving;
  const plan = useMemo(() => confirmPlan(extractions, choices), [extractions, choices]);
  const roomLook = { color: room.color, icon: room.icon as FolderIcon | null | undefined };

  function returnToMap(href: string) { setLeaving(true); router.replace(href); }
  const update = (id: string, patch: Partial<RowChoice>) => setChoices((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  async function save() {
    if ((!session.ready && !confirmationWrite.pending) || saving || reprocessing || leaving || reprocessWrite.pending) return;
    const selections = selectionsToSend(extractions, choices);
    if (!selections) return; // 남은 장소가 있으면 보내지 않습니다(버튼이 남은 일로 바뀌어 있음).
    setSaving(true); setError(null);
    setNotice(confirmationWrite.pending ? CHECKING_SAVE : "");
    try {
      const body = await confirmationWrite.run(() => requestJson<ConfirmSaved>(`/api/sources/${source.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: selections.map(({ place, ...selection }) => selection), version: source.version, work_id: workId() }),
      }), () => verifyConfirmation(source.id, selections), () => setNotice(CHECKING_SAVE));
      store.acceptSavedPlace(body.saved_place);
      const ids = body.place_ids?.length ? body.place_ids : [placeIdFrom(body.place_url)].filter((id): id is string => !!id);
      rememberJustSaved({ boardId: room.id, ids, url: source.url });
      returnToMap(body.saved ? savedMapHref(body.place_url) : "/");
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요."); }
    finally { setSaving(false); setNotice(""); }
  }

  async function reprocess() {
    if ((!session.ready && !reprocessWrite.pending) || saving || reprocessing || leaving || confirmationWrite.pending) return;
    setReprocessing(true); setError(null);
    setNotice(reprocessWrite.pending ? CHECKING_SAVE : "");
    let retryAfter = 0;
    try {
      const body = await reprocessWrite.run(() => { retryAfter = Date.now() + 65000; return requestJson<ShareResult>("/api/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url, retry: true, work_id: workId() }),
      }); }, () => verifySharedLink(source.url, retryAfter), () => setNotice(CHECKING_SAVE));
      if (body.status === "saved" || body.status === "duplicate") {
        store.acceptSavedPlace(body.saved_place);
        const id = placeIdFrom(body.place_url);
        if (body.status === "saved" && id) rememberJustSaved({ boardId: room.id, ids: [id], url: source.url });
        returnToMap(shareDestination(body)!);
      } else { setNotice(body.message); setRecoveryReason(body.code); router.refresh(); }
    } catch (e) {
      setNotice(""); setError(e instanceof Error ? e.message : "다시 찾지 못했어요.");
      if (e instanceof RequestError && analysisMessage(e.code)) setRecoveryReason(e.code);
      if (e instanceof RequestError && e.details?.source_id === source.id && typeof e.details?.source_version === "string") router.refresh();
    } finally { setReprocessing(false); }
  }

  function goTo(id: string, open = false) {
    const row = rowRefs.current.get(id);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.querySelector<HTMLElement>("[data-row-action]")?.focus({ preventScroll: true });
    setFlash(id); setTimeout(() => setFlash((cur) => cur === id ? null : cur), 1300);
    const e = extractions.find((x) => x.id === id);
    if (open && e) setSheet({ kind: rowState(e, choices[id]) === "missing" ? "search" : "branch", id });
  }
  function primary() {
    const next = plan.next;
    if (next.kind === "save") void save();
    else if (next.kind === "find") setSheet({ kind: "search", id: next.id });
    else if (next.kind === "choose") setSheet({ kind: "branch", id: next.id });
    else if (next.kind === "remaining") goTo(next.id);
  }
  const primaryLabel = saving ? "담는 중…" : confirmationWrite.pending ? "저장됐는지 다시 확인" : plan.next.kind === "save" ? `‘${room.name}’에 ${plan.next.count}곳 담기`
    : plan.next.kind === "find" ? `${plan.next.name} 위치 찾기` : plan.next.kind === "choose" ? `${plan.next.name} 지점 고르기`
    : plan.next.kind === "remaining" ? `남은 ${plan.next.count}곳 확인` : "담을 곳이 없어요";
  const primaryIcon = plan.next.kind === "find" ? "search" : plan.next.kind === "choose" ? "pin" : null;
  const names = extractions.filter((e) => rowState(e, choices[e.id]) !== "excluded").map((e) => e.name);
  const sub = plan.remaining === 0 ? (plan.ready ? "위치가 맞는지 보고 담아 주세요." : "모두 빼 뒀어요. 담을 곳은 [담기]로 되돌릴 수 있어요.")
    : extractions.some((e) => rowState(e, choices[e.id]) === "missing") ? "지도에서 위치를 못 찾은 곳이 있어요." : "지점을 골라야 하는 곳이 있어요.";
  const ai = aiIssueCopy(recoveryReason);
  const current = sheet ? extractions.find((e) => e.id === sheet.id) : undefined;

  const dismiss = <DismissSource id={source.id} version={source.version} disabled={locked} names={names} className="" onDone={() => { void store.refresh(); returnToMap("/?saved=0"); }}>이 링크 정리하기</DismissSource>;

  if (leaving) return <main className={`confirm ${styles.page}`}><PageHeader title="장소 확인" /><ClientReady><p className="notice" role="status">지도를 여는 중…</p></ClientReady></main>;

  return (
    <main className={`confirm ${styles.page}`}><PageHeader title="장소 확인" /><ClientReady>
      <RoomLine name={room.name} room={roomLook} />
      {!session.ready && <p className="notice" role="status">{session.error || "링크 상태를 확인하고 있어요…"} {session.error && <button className="text-btn" disabled={session.checking} onClick={() => { void session.retry(); router.refresh(); }}>다시 확인</button>}</p>}

      {extractions.length > 0 ? <>
        <h2 className={styles.title}>{extractions.length}곳을 찾았어요</h2>
        <p className={styles.sub}>{sub} <a className={`source-link ${styles.inlineLink}`} href={source.url} target="_blank" rel="noreferrer">원본 보기</a></p>
        {ai && <p className={styles.why}>{ai.title}. 찾은 곳만 아래에 남겼어요.</p>}
        <div className={styles.places} role="list" aria-label="게시물에서 찾은 장소">
          {extractions.map((e) => {
            const choice = choices[e.id];
            const state = rowState(e, choice);
            const picked = pickedPlace(e, choice);
            const options = rowOptions(e, choice);
            return <section key={e.id} role="listitem" ref={(el) => { if (el) rowRefs.current.set(e.id, el); else rowRefs.current.delete(e.id); }} className={`${styles.place}${state === "excluded" ? ` ${styles.placeOff}` : ""}${flash === e.id ? ` ${styles.focusRow}` : ""}`} aria-label={e.name}>
              <div className={styles.placeHead}>
                <h3 className={styles.placeName}>{e.name}</h3>
                {state === "excluded"
                  ? <button type="button" className={`${styles.toggle} ${styles.toggleAdd}`} disabled={locked} aria-label={`${e.name} 다시 담기`} onClick={() => update(e.id, { excluded: false })}><span><Icon name="plus" width={14} />담기</span></button>
                  : <button type="button" className={styles.toggle} disabled={locked} aria-label={`${e.name} 빼기`} onClick={() => update(e.id, { excluded: true })}><span>빼기</span></button>}
              </div>
              <div className={styles.state}>
                {state === "ready" && <span className={`${styles.badge} ${styles.ok}`}><Icon name="check" width={15} />위치 확인됨</span>}
                {state === "choose" && <><span className={`${styles.badge} ${styles.need}`}>지점을 골라 주세요 · {e.candidates.length}곳</span>
                  <button type="button" data-row-action className={styles.act} disabled={locked} onClick={() => setSheet({ kind: "branch", id: e.id })}><span><Icon name="pin" width={16} />지점 고르기</span></button></>}
                {state === "missing" && <><span className={`${styles.badge} ${styles.need}`}><Icon name="search" width={15} />지도에서 못 찾았어요</span>
                  <button type="button" data-row-action className={styles.act} disabled={locked} onClick={() => setSheet({ kind: "search", id: e.id })}><span><Icon name="search" width={16} />이름으로 찾기</span></button></>}
                {state === "excluded" && <span className={`${styles.badge} ${styles.off}`}>빼 뒀어요</span>}
              </div>
              {state === "ready" && picked && <div className={styles.spot}><Icon name="pin" width={16} /><span>{picked.name} <small>· {picked.address}</small></span>
                <button type="button" data-row-action className={styles.textLink} disabled={locked} aria-label={`${e.name} 지점 바꾸기`} onClick={() => setSheet({ kind: options.length > 1 ? "branch" : "search", id: e.id })}>바꾸기</button></div>}
              {state === "missing" && <p className={styles.why}>카카오 지도 검색에서 이 이름을 찾지 못했어요. 이름이나 지점을 바꿔 찾아보세요.</p>}
            </section>;
          })}
        </div>
        <div className={styles.exitRow}>저장할 곳이 없나요? {dismiss}</div>
      </> : <NoNames reason={recoveryReason} busy={locked} manual={manual} onManual={() => setManual(true)} onRetry={() => void reprocess()} dismiss={dismiss}>
        {manual && !pending && <ManualPlaceSearch sourceId={source.id} version={source.version} sourceReady={session.ready} saveLabel={`‘${room.name}’에 담기`} onSaved={(result) => {
          store.acceptSavedPlace(result.saved_place);
          const id = placeIdFrom(result.place_url);
          if (id && result.status !== "duplicate") rememberJustSaved({ boardId: room.id, ids: [id], url: source.url });
          returnToMap(savedMapHref(result.place_url));
        }} />}
      </NoNames>}

      {reprocessing && <p className="hint" role="status">인스타 게시물을 다시 분석하고 있어요…</p>}
      {reprocessWrite.pending && !reprocessing && <button className="btn" disabled={saving} onClick={() => void reprocess()}>분석 결과 다시 확인</button>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {extractions.length > 0 && <div className={styles.bar}>
        {plan.remaining > 0 && <p className={styles.barNote}><Icon name="clock" width={16} />확인이 남은 {plan.remaining}곳은 아직 담기지 않아요</p>}
        <button type="button" className={`btn primary ${styles.ellipsis}`} disabled={(!session.ready && !confirmationWrite.pending) || saving || reprocessing || reprocessWrite.pending || plan.next.kind === "empty"} onClick={primary}>
          {primaryIcon && <Icon name={primaryIcon} width={18} />}<span className={styles.ellipsis}>{primaryLabel}</span>
        </button>
      </div>}

      {sheet?.kind === "search" && current && <NameSearchSheet name={current.name} initial={searchQuery(current)}
        suggestions={searchSuggestions(current.rawName, current.branch, current.areaHint, searchQuery(current))}
        onClose={() => setSheet(null)}
        onExclude={() => { update(current.id, { excluded: true }); setSheet(null); }}
        onPick={(place, query) => {
          const c = choices[current.id];
          update(current.id, { extra: [...c.extra.filter((x) => x.kakao_place_id !== place.kakao_place_id), place], pickedId: place.kakao_place_id, queries: { ...c.queries, [place.kakao_place_id]: query }, excluded: false });
          setSheet(null);
        }} />}
      {sheet?.kind === "branch" && current && <BranchSheet name={current.name} options={rowOptions(current, choices[current.id])} pickedId={choices[current.id].pickedId}
        onClose={() => setSheet(null)} onSearch={() => setSheet({ kind: "search", id: current.id })}
        onPick={(place) => { update(current.id, { pickedId: place.kakao_place_id, excluded: false }); setSheet(null); }} />}
    </ClientReady></main>
  );
}

/** 이름으로 찾기의 첫 검색어: 읽은 이름(+이름에 없는 지역) */
function searchQuery(e: ExtractionView) {
  return e.areaHint && !e.name.includes(e.areaHint) ? `${e.areaHint} ${e.name}` : e.name;
}

/** 게시물에서 장소 이름을 하나도 읽지 못했을 때: 다시 분석하거나, 이름을 알면 직접 찾아 담기 */
function NoNames({ reason, busy, manual, onManual, onRetry, dismiss, children }: { reason?: string | null; busy: boolean; manual: boolean; onManual: () => void; onRetry: () => void; dismiss: React.ReactNode; children: React.ReactNode }) {
  const ai = aiIssueCopy(reason);
  const retryFirst = analysisRecovery(reason) === "retry";
  return <>
    <div className={styles.fail}>
      <span className={styles.failIcon}><Icon name={ai ? "clock" : "search"} width={36} /></span>
      <h2>{ai ? ai.title : reason === "interrupted" ? "분석이 중간에 멈췄어요" : "게시물에서 장소 이름을 못 찾았어요"}</h2>
      <p>{ai ? ai.body : reason === "interrupted" ? "다시 분석하면 이어서 찾아요." : "캡션에 가게 이름이 없을 수 있어요. 다시 분석하거나, 이름을 알면 직접 찾아 담을 수 있어요."}</p>
    </div>
    <div className={styles.row2} style={{ marginTop: 20 }}>
      <button type="button" className={`btn${retryFirst ? " primary" : ""}`} disabled={busy} onClick={onRetry}><Icon name="refresh" width={18} />다시 분석</button>
      <button type="button" className={`btn${!retryFirst && !manual ? " primary" : ""}`} disabled={busy || manual} onClick={onManual}><Icon name="search" width={18} />이름으로 찾기</button>
    </div>
    {manual && <section style={{ marginTop: 20 }}>{children}</section>}
    <div className={styles.exitRow}>저장할 곳이 없나요? {dismiss}</div>
  </>;
}
