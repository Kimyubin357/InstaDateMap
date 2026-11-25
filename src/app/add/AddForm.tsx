"use client";
import { useSourceSession } from "@/components/useSourceSession";
import { workId } from "@/lib/work-id";
import ClientReady from "@/components/ClientReady";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/Icon";
import PageHeader from "@/components/PageHeader";
import ShellLink from "@/components/ShellLink";
import DismissSource from "@/components/DismissSource";
import RoomChooser, { RoomLine, type RoomLook } from "@/components/RoomChooser";
import { requestShare, type ShareResult } from "@/lib/share-stream";
import { VerifiedWrite } from "@/lib/verified-write";
import { verifySharedLink } from "@/lib/save-recovery";
import { RequestError } from "@/lib/client-request";
import { useRouter } from "next/navigation";
import { reviewDestination, shareDestination } from "@/lib/share-navigation";
import { boardChanged } from "@/lib/board-events";
import { navigateShell } from "@/lib/shell-navigation";
import { useBoardState, useBoardSync } from "@/components/BoardProvider";
import { addFailure, aiIssueCopy, instagramLinkIn, linkKind, linkTail, type AddFailure } from "@/lib/registration";
import { placeIdFrom, rememberJustSaved, rememberSavedRoom } from "@/lib/saved-memory";
import styles from "@/components/Registration.module.css";

/** 분석 단계(서버 진행 신호와 같은 순서). 읽은 내용은 따로 보여 주지 않고 지금 단계만 보여 줍니다. */
const STAGES = [
  { key: "caption", label: "게시물 내용 가져오기", doing: "가져오는 중…" },
  { key: "extract", label: "장소 이름 읽기", doing: "읽는 중…" },
  { key: "search", label: "지도에서 위치 찾기", doing: "찾는 중…" },
  { key: "save", label: "확인하고 방에 담기", doing: "담는 중…" },
];

/**
 * 장소 추가(시안 1–3·10–12번). 인스타 링크 하나로만 들어옵니다.
 * 맨 위의 방(지금 연 방 = 저장할 방)을 크게 보여 주고, 단축어로 온 링크(/add?url=)는 바로 분석을 시작합니다.
 */
export default function AddForm({ initialUrl, initialRetry = false }: { initialUrl: string; initialRetry?: boolean }) {
  const router = useRouter();
  const { store } = useBoardSync();
  const board = useBoardState();
  const [text, setText] = useState(initialUrl);
  const [sent, setSent] = useState(initialUrl);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [running, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const busy = running || !!leaving;
  const [stage, setStage] = useState("caption");
  const [hint, setHint] = useState("");
  const [room, setRoom] = useState<RoomLook | null>(null);
  const sourceSession = useSourceSession(result?.source_id, result?.source_version);
  const started = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [write] = useState(() => new VerifiedWrite<ShareResult>());
  const [checking, setChecking] = useState(false);
  const [offline, setOffline] = useState(false);
  const alive = useRef(true);
  const roomName = board.snapshot?.board ?? "";
  const pendingCount = board.snapshot?.pending.length ?? 0;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const update = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  function complete(data: ShareResult, link: string) {
    store.acceptSavedPlace(data.saved_place);
    boardChanged();
    const boardId = store.getSnapshot().access?.boardId;
    if (data.status === "saved" || data.status === "duplicate") rememberSavedRoom(boardId);
    if (!alive.current) {
      if (data.source_id && data.source_version) void fetch(`/api/sources/${data.source_id}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", version: data.source_version, work_id: workId() }), keepalive: true }).catch(() => {});
      return;
    }
    const id = placeIdFrom(data.place_url);
    if (data.status === "saved" && boardId && id) rememberJustSaved({ boardId, ids: [id], url: instagramLinkIn(link) });
    const destination = shareDestination(data) ?? reviewDestination(data);
    if (destination) { setLeaving(destination); if (!navigateShell(destination, true)) router.replace(destination); }
    else setResult(data);
  }
  async function submit(value = text, retry = false) {
    const link = value.trim();
    if (!link || busy) return;
    let retryAfter = 0;
    setBusy(true); setResult(null); setStage("caption"); setChecking(write.pending); setHint("");
    if (!write.pending) { setSent(link); setSentAt(new Date()); }
    try {
      const data = await write.run(() => { retryAfter = Date.now() + 65000; return requestShare({ url: link, retry, stream: true, work_id: workId() }, setStage); }, () => verifySharedLink(link, retryAfter), () => setChecking(true));
      complete(data, link);
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) { window.location.replace(`/login?next=${encodeURIComponent(`/add?url=${encodeURIComponent(link)}`)}`); return; }
      setResult({ status: "error", message: e instanceof TypeError ? "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요." : e instanceof Error ? e.message : "연결하지 못했어요. 다시 시도해 주세요." });
    } finally { setBusy(false); setChecking(false); }
  }
  useEffect(() => { if (initialUrl && !started.current) { started.current = true; void submit(initialUrl, initialRetry); } }, []);

  async function paste() {
    setHint("");
    try {
      if (!navigator.clipboard?.readText) throw new Error("clipboard unavailable");
      const link = instagramLinkIn(await navigator.clipboard.readText());
      if (!link) { setHint("복사한 인스타 링크가 없어요. 인스타에서 ‘링크 복사’를 누른 뒤 다시 눌러 주세요."); return; }
      setText(link); void submit(link);
    } catch {
      input.current?.focus();
      setHint("여기서는 바로 붙여넣을 수 없어요. 입력칸을 길게 눌러 붙여넣어 주세요.");
    }
  }
  function another() { setResult(null); setText(""); setHint(""); requestAnimationFrame(() => input.current?.focus()); }

  const source = sent && instagramLinkIn(sent) ? <div className={styles.source}>
    <span className={`${styles.thumb}${result?.status === "needs_caption" ? ` ${styles.thumbMuted}` : ""}`} aria-hidden="true"><Icon name={result?.status === "needs_caption" ? "lock" : "instagram"} width={20} /></span>
    <span><strong>{linkKind(sent)}</strong><small>{linkTail(sent)}</small></span>
    <a className={styles.original} href={instagramLinkIn(sent)!} target="_blank" rel="noreferrer">원본<Icon name="external" width={15} /></a>
  </div> : null;
  const roomLine = roomName ? <RoomLine name={roomName} room={room} /> : null;
  const failure: AddFailure | null = result && !write.pending ? addFailure(result) ?? "failed" : null;
  const unconfirmed = write.pending && !running && !!result;

  let body: ReactNode;
  if (leaving) body = <p className="notice" role="status">{leaving.startsWith("/confirm") ? "찾은 장소를 여는 중…" : "지도를 여는 중…"}</p>;
  else if (checking || unconfirmed) body = <>
    {roomLine}
    {offline && <div className={styles.offline} role="status"><Icon name="refresh" width={16} /><span>인터넷 연결이 끊겼어요</span></div>}
    <div className={styles.fail} role="status" aria-live="polite">
      {checking ? <span className={styles.spinner} aria-hidden="true" /> : <span className={styles.failIcon}><Icon name="refresh" width={36} /></span>}
      <h2>{checking ? "저장됐는지 확인하고 있어요" : "저장됐는지 아직 확인하지 못했어요"}</h2>
      <p>결과를 받기 전에 연결이 끊겼어요. 이미 저장됐을 수도 있어서, 확인될 때까지 같은 링크를 다시 저장하지 않아요.</p>
      <ul className={styles.checks}>
        <li><span className={styles.checkDot}><Icon name="check" width={14} /></span>링크 보냄{sentAt && <small>{sentAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}</small>}</li>
        <li><span className={`${styles.checkDot} ${checking ? styles.checkDotBusy : styles.checkDotIdle}`}>{!checking && "?"}</span>저장 결과 확인<small>{checking ? "확인 중" : "다시 확인 필요"}</small></li>
      </ul>
    </div>
    {!checking && <div className={styles.bar}><p className={styles.barSum}>저장된 것이 확인되면 지도로 가고, 저장되지 않았으면 그때 이어서 저장해요.</p>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void submit(sent, true)}><Icon name="refresh" width={18} />지금 다시 확인</button></div>}
  </>;
  else if (running) body = <>
    {roomLine}
    {source}
    <h2 className={styles.title}>게시물을 읽고 있어요</h2>
    <p className={styles.sub}>길어도 1분쯤 걸려요.</p>
    <ol className={styles.progress} aria-label="장소 찾는 단계" aria-live="polite">{STAGES.map((s, i) => {
      const at = Math.max(0, STAGES.findIndex((x) => x.key === stage));
      const state = i < at ? "done" : i === at ? "current" : "todo";
      return <li key={s.key} className={styles[state]} aria-current={state === "current" ? "step" : undefined}><span className={styles.dot} aria-hidden="true">{state === "done" ? <Icon name="check" width={15} /> : state === "todo" ? i + 1 : null}</span><div>{s.label}{state === "current" && <small>{s.doing}</small>}</div></li>;
    })}</ol>
    <div className={styles.leave}><Icon name="clock" width={18} /><p>이 화면에 있으면 끝나는 대로 결과를 보여 드려요. 화면을 나가도 링크는 남아요. 저장되면 지도에, 확인이 남으면 확인 대기에 보여요.</p></div>
  </>;
  else if (failure && result) body = <FailureView kind={failure} result={result} roomLine={roomLine} source={source} busy={busy || (!!result.source_id && !sourceSession.ready && !!sourceSession.checking)}
    onAnother={another} onRetry={() => void submit(sent, true)} sessionError={sourceSession.error}
    onDismissed={() => { void store.refresh(); another(); }} />;
  else body = <>
    <RoomChooser disabled={busy || write.pending} onRoom={(r) => setRoom(r)} />
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className={styles.label} htmlFor="instagram-link">인스타 링크<small>게시물 · 릴스</small></label>
      <div className={styles.linkField}>
        <Icon name="link" width={18} />
        <input ref={input} id="instagram-link" inputMode="url" autoCapitalize="none" autoCorrect="off" autoComplete="off" enterKeyHint="go" value={text} onChange={(e) => { setText(e.target.value); setHint(""); }} placeholder="복사한 링크를 넣어 주세요" disabled={busy} />
        <button type="button" className={styles.paste} disabled={busy} onClick={() => void paste()}><Icon name="copy" width={17} />붙여넣기</button>
      </div>
      {hint && <p className={styles.fieldHint} role="status">{hint}</p>}
      <button className={`btn primary ${styles.block}`} disabled={busy || !text.trim()}>장소 찾기</button>
    </form>
    <p className={styles.label}>다음엔 인스타에서 바로 보내요</p>
    <ol className={styles.steps}>
      <li><span className={styles.stepNo}>1</span><p>게시물의 공유 버튼 → ‘공유’<small>인스타 공유 화면 아래 줄에서 iOS 공유 시트를 열어요</small></p></li>
      <li><span className={styles.stepNo}>2</span><p>‘데이트맵에 저장’ 단축어 누르기<small>처음 한 번만 단축어를 추가해 두면 돼요</small></p></li>
      <li><span className={styles.stepNo}>3</span><p>앱이 열리면 바로 찾기 시작<small>이 화면은 건너뛰고, 위의 방에 담아요</small></p></li>
    </ol>
    {pendingCount > 0 && <ShellLink className={styles.goRow} href="/?panel=pending"><Icon name="clock" width={18} /><span>확인 대기 <b>{pendingCount}개</b></span><Icon name="chevron" width={17} /></ShellLink>}
  </>;

  return <main className={`form-page ${styles.page}`}><ClientReady><PageHeader title="장소 추가" />{body}</ClientReady></main>;
}

/** 원인별 실패 화면(시안 10·11번): 제목·설명·다음 행동 하나. */
function FailureView({ kind, result, roomLine, source, busy, sessionError, onAnother, onRetry, onDismissed }: {
  kind: AddFailure; result: ShareResult; roomLine: ReactNode; source: ReactNode; busy: boolean; sessionError?: string;
  onAnother: () => void; onRetry: () => void; onDismissed: () => void;
}) {
  const ai = aiIssueCopy(result.code);
  const kept = result.source_id ? " 이 링크는 확인 대기에 남겨 둘게요." : "";
  const copy: Record<AddFailure, { icon: "lock" | "link" | "clock" | "refresh"; title: string; body: string; cause: string }> = {
    unreadable: { icon: "lock", title: "게시물을 열 수 없어요", body: "비공개 계정이거나 삭제된 게시물일 수 있어요. 인스타에서 이 게시물이 열리는지 확인해 주세요.", cause: "원인 · 게시물 내용을 읽지 못함" },
    not_instagram: { icon: "link", title: "인스타 링크를 확인해 주세요", body: result.message || "인스타그램 게시물이나 릴스 링크를 넣어 주세요.", cause: "원인 · 링크 형식" },
    ai_wait: { icon: "clock", title: ai?.title ?? "AI가 잠시 장소를 못 읽었어요", body: (ai?.body ?? "") + kept, cause: "원인 · AI 분석 실패 (잠시)" },
    ai_limit: { icon: "clock", title: ai?.title ?? "AI 분석 한도에 걸렸어요", body: (ai?.body ?? "") + kept, cause: "원인 · AI 분석 한도" },
    busy: { icon: "clock", title: "이 링크는 지금 저장 중이에요", body: result.message, cause: "원인 · 다른 화면에서 작업 중" },
    failed: { icon: "refresh", title: "분석을 끝내지 못했어요", body: result.message + kept, cause: "원인 · 처리 중 오류" },
  };
  const c = copy[kind];
  const toMap = (label = "나중에 할게요 · 지도로") => <ShellLink className="btn" href="/">{label}</ShellLink>;
  const retry = (primary: boolean, label = "다시 시도") => <button type="button" className={`btn${primary ? " primary" : ""}`} disabled={busy} onClick={onRetry}><Icon name="refresh" width={18} />{label}</button>;
  const another = <button type="button" className="btn primary" disabled={busy} onClick={onAnother}><Icon name="link" width={18} />다른 링크 넣기</button>;
  const dismiss = result.source_id && result.source_version ? <DismissSource id={result.source_id} version={result.source_version} className="btn" disabled={busy} onDone={onDismissed}>이 링크 정리</DismissSource> : null;
  const confirmPath = result.confirm_url ? (() => { try { const path = new URL(result.confirm_url!, "https://datemap.local").pathname; return /^\/confirm\/[a-z0-9-]+$/i.test(path) ? path : null; } catch { return null; } })() : null;
  return <>
    {roomLine}
    {source}
    <div className={styles.fail} role="alert">
      <span className={styles.failIcon}><Icon name={c.icon} width={36} /></span>
      <h2>{c.title}</h2>
      <p>{c.body}</p>
      <span className={styles.cause}>{c.cause}</span>
      {sessionError && <p className={styles.hintLine}>{sessionError}</p>}
    </div>
    <div className={styles.bar}>
      {kind === "unreadable" ? <>{another}<div className={styles.row2}>{retry(false, "다시 읽어 보기")}{dismiss}</div></>
        : kind === "not_instagram" ? another
        : kind === "ai_limit" ? <>{confirmPath ? <ShellLink className="btn primary" href={confirmPath}><Icon name="search" width={18} />이름으로 직접 찾기</ShellLink> : toMap()}<div className={styles.row2}>{retry(false)}{confirmPath ? toMap("나중에 할게요") : dismiss}</div></>
        : <>{retry(true)}{toMap()}</>}
    </div>
  </>;
}
