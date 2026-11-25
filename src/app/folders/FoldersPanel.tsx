"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import ClientReady from "@/components/ClientReady";
import Icon from "@/components/Icon";
import ShellLink from "@/components/ShellLink";
import ActionDialog from "@/components/ActionDialog";
import Avatar from "@/components/Avatar";
import { useBoardSync } from "@/components/BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { FOLDER_COLOR_LABEL, INVITE_DAYS, ROOM_LIMIT, ROOM_NAME_MAX, type FolderColor, type FolderDetail, type FolderMember, type FolderSummary, type FoldersResponse } from "@/lib/folders";
import { ColorSwatches, FieldLabel, RoomBand, RoomCard } from "@/components/Palette";
import styles from "./Folders.module.css";

interface Draft { name: string; color: FolderColor }
type Confirm = { kind: "delete" } | { kind: "leave" } | { kind: "kick"; member: FolderMember } | { kind: "owner"; member: FolderMember };
/** 새 방은 빨강으로 시작합니다(쓰지 않는 색을 미리 골라 두지 않음, 2026-11-25). */
const NEW_DRAFT: Draft = { name: "", color: "red" };
const call = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(url, { method, cache: "no-store", notifyBoardChange: false,
  ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
const clean = (name: string) => name.replace(/\s+/g, " ").trim();
const people = (count: number) => count > 1 ? `${count}명` : "나만";

/** 방 이름·색 고르기(시안 1·3번). 맨 위 색 카드는 고르는 대로 바로 바뀌고, 저장 버튼은 아래 고정 바에 있습니다. */
function RoomEditor({ draft, onChange, busy, kicker, meta, note, submitLabel, busyLabel, onSubmit, unchanged = false, children }: {
  draft: Draft; onChange: (d: Draft) => void; busy: boolean; kicker: string; meta: string; note: ReactNode; submitLabel: string; busyLabel: string; onSubmit: () => void; unchanged?: boolean; children?: ReactNode;
}) {
  const trimmed = clean(draft.name);
  return <form className={styles.editor} aria-busy={busy} onSubmit={(e: FormEvent) => { e.preventDefault(); if (!busy && trimmed && !unchanged) onSubmit(); }}>
    <RoomCard color={draft.color} kicker={kicker} name={trimmed} meta={meta} />
    <FieldLabel htmlFor="room-name" aside={<small>{draft.name.length}/{ROOM_NAME_MAX}</small>}>방 이름</FieldLabel>
    <input id="room-name" className={styles.nameField} value={draft.name} maxLength={ROOM_NAME_MAX} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="예: 부산 여행, 동네 맛집" disabled={busy} enterKeyHint="done" />
    <FieldLabel aside={<b>{FOLDER_COLOR_LABEL[draft.color]}</b>}>색</FieldLabel>
    <ColorSwatches value={draft.color} disabled={busy} label="방 색" onChange={(color) => onChange({ ...draft, color })} />
    <p className={styles.note}><Icon name="user" width={20} /><span>{note}</span></p>
    {children}
    <div className={styles.bar}><button className="btn primary" disabled={busy || !trimmed || unchanged}>{busy ? busyLabel : submitLabel}</button></div>
  </form>;
}

/**
 * 폴더 목록·만들기·전환, 그리고 폴더 관리(이름·표지, 멤버, 초대, 나가기·삭제).
 * standalone: 폴더가 0개라 지도 없이 이 화면만 보여줄 때.
 */
export default function FoldersPanel({ standalone = false }: { standalone?: boolean }) {
  const sync = useBoardSync();
  const router = useRouter();
  const [data, setData] = useState<FoldersResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [detail, setDetail] = useState<FolderDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [invite, setInvite] = useState<{ url: string; expires_at: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const acting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const say = useCallback((message: string) => { if (standalone) setStatus(message); else sync.notify(message); }, [standalone, sync]);
  const load = useCallback(async () => {
    setLoadError("");
    try { const next = await call<FoldersResponse>("/api/folders"); setData(next); return next; }
    catch (e) { setLoadError(friendlyMessage(e, "방 목록을 불러오지 못했어요. 다시 시도해 주세요.")); return null; }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const loadDetail = useCallback(async (id: string) => {
    setError("");
    try { const next = await call<FolderDetail>(`/api/folders/${id}`); setDetail(next); setEdit(next.folder.role === "owner" ? { name: next.folder.name, color: next.folder.color } : null); }
    catch (e) { setError(friendlyMessage(e, "방 정보를 불러오지 못했어요.")); }
  }, []);
  useEffect(() => { if (selected) { setDetail(null); setInvite(null); void loadDetail(selected); } }, [selected, loadDetail]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [selected]);

  /** 한 번에 하나의 요청만 보내고, 실패하면 입력을 유지한 채 한국어 안내를 보여줍니다. */
  async function act<T>(task: () => Promise<T>, fallback: string): Promise<T | null> {
    if (acting.current) return null;
    acting.current = true; setBusy(true); setError(""); setStatus("");
    try { return await task(); }
    catch (e) { setError(friendlyMessage(e, fallback)); return null; }
    finally { acting.current = false; setBusy(false); }
  }
  /** 이 기기가 보는 폴더가 바뀌면 입장 정보를 다시 받아 지도를 새 폴더로 엽니다. */
  async function follow(current: string | null, goHome: boolean, message: string) {
    const was = sync.store.getSnapshot().access?.boardId ?? null;
    if (!current) { window.location.assign("/folders"); return; }
    if (standalone) { window.location.assign(goHome ? "/" : "/folders"); return; }
    if (current !== was && !await sync.resetAccess()) return;
    say(message);
    if (goHome) router.replace("/");
  }

  const open = (folder: FolderSummary) => {
    if (folder.id === data?.current && !standalone) { router.replace("/"); return; }
    void act(async () => { const res = await call<{ current: string }>(`/api/folders/${folder.id}/open`, "POST"); await follow(res.current, true, `‘${folder.name}’ 방을 열었어요.`); }, "방을 열지 못했어요. 다시 시도해 주세요.");
  };
  const create = () => act(async () => {
    const res = await call<{ current: string }>("/api/folders", "POST", draft);
    setDraft(NEW_DRAFT); setCreating(false);
    await follow(res.current, true, "새 방을 만들었어요.");
  }, "방을 만들지 못했어요. 다시 시도해 주세요.");
  const save = () => selected && edit && act(async () => {
    const next = await call<FolderDetail>(`/api/folders/${selected}`, "PATCH", edit);
    setDetail(next); await load(); say("방을 바꿨어요.");
    if (selected === data?.current && !standalone) sync.store.invalidate();
  }, "방을 바꾸지 못했어요. 다시 시도해 주세요.");
  const makeInvite = () => selected && act(async () => {
    const next = await call<{ url: string; expires_at: string }>(`/api/folders/${selected}/invites`, "POST");
    setInvite(next); await loadDetail(selected);
  }, "초대 링크를 만들지 못했어요. 다시 시도해 주세요.");
  const revokeInvites = () => selected && act(async () => {
    await call(`/api/folders/${selected}/invites`, "DELETE"); setInvite(null); await loadDetail(selected); say("초대 링크를 모두 끊었어요.");
  }, "초대 링크를 끊지 못했어요. 다시 시도해 주세요.");
  const copyInvite = async () => {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.url); say("초대 링크를 복사했어요."); }
    catch { setError("복사하지 못했어요. 링크를 길게 눌러 복사해 주세요."); }
  };
  const shareInvite = async () => {
    if (!invite || !detail) return;
    try { await navigator.share({ title: `‘${detail.folder.name}’ 방 초대`, text: `‘${detail.folder.name}’ 방에 함께해요.`, url: invite.url }); }
    catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) void copyInvite(); }
  };
  async function runConfirm() {
    if (!confirm || !detail) return;
    const folder = detail.folder;
    const me = detail.members.find((m) => m.me);
    if (confirm.kind === "owner") {
      const next = await act(() => call<FolderDetail>(`/api/folders/${folder.id}/owner`, "POST", { userId: confirm.member.user_id }), "방장을 넘기지 못했어요. 다시 시도해 주세요.");
      if (next) { setDetail(next); setEdit(null); setConfirm(null); await load(); say(`${confirm.member.name}님이 방장이 됐어요.`); }
      return;
    }
    if (confirm.kind === "kick") {
      const ok = await act(() => call(`/api/folders/${folder.id}/members/${confirm.member.user_id}`, "DELETE"), "내보내지 못했어요. 다시 시도해 주세요.");
      if (ok) { setConfirm(null); await loadDetail(folder.id); await load(); say(`${confirm.member.name}님을 내보냈어요.`); }
      return;
    }
    const res = await act(() => confirm.kind === "delete"
      ? call<{ current: string | null }>(`/api/folders/${folder.id}`, "DELETE")
      : call<{ current: string | null }>(`/api/folders/${folder.id}/members/${me?.user_id}`, "DELETE"), confirm.kind === "delete" ? "방을 삭제하지 못했어요. 다시 시도해 주세요." : "방에서 나가지 못했어요. 다시 시도해 주세요.");
    if (!res) return;
    setConfirm(null); setSelected(null); setDetail(null);
    await follow(res.current, false, confirm.kind === "delete" ? `‘${folder.name}’ 방을 삭제했어요.` : `‘${folder.name}’ 방에서 나왔어요.`);
    await load();
  }

  const folders = data?.folders ?? [];
  const header = (title: string, back?: () => void) => <header className="page-header">
    {back ? <button type="button" className="icon-btn" aria-label="방 목록으로" onClick={back}><Icon name="back" /></button>
      : standalone ? <span className="header-spacer" /> : <ShellLink href="/settings" className="icon-btn" aria-label="이전 화면으로"><Icon name="back" /></ShellLink>}
    <h1 ref={heading} tabIndex={-1}>{title}</h1><span className="header-spacer" /></header>;
  const feedback = <>{error && <p className={`error ${styles.message}`} role="alert">{error}</p>}{status && <p className={`hint ${styles.message}`} role="status">{status}</p>}</>;

  if (selected) {
    const folder = detail?.folder ?? folders.find((f) => f.id === selected);
    const owner = detail?.folder.role === "owner";
    const others = detail ? detail.members.length - 1 : 0;
    return <main className={`form-page settings-page ${styles.page}${owner ? ` ${styles.withBar}` : ""}`}>{header(folder?.name ?? "방", () => { setSelected(null); setError(""); setStatus(""); })}<ClientReady>
      {feedback}
      {!detail ? !error && <p className="hint" role="status">방 정보를 불러오고 있어요…</p> : <div className={styles.detail}>
        <section className={styles.about} aria-label="방 이름과 색">
          {owner && edit ? <RoomEditor draft={edit} onChange={setEdit} busy={busy} kicker="방장 · 나" meta={`${people(detail.members.length)} · 장소 ${detail.folder.place_count}곳`}
            note={<>바꾸면 <b>모든 멤버에게</b> 바뀐 이름과 색으로 보여요.</>} submitLabel="저장" busyLabel="저장하는 중…" onSubmit={() => { void save(); }}
            unchanged={clean(edit.name) === detail.folder.name && edit.color === detail.folder.color} />
            : <><RoomCard color={detail.folder.color} kicker={`멤버 · 방장 ${detail.members.find((m) => m.role === "owner")?.name ?? ""}`.trim()} name={detail.folder.name} meta={`${people(detail.members.length)} · 장소 ${detail.folder.place_count}곳`} />
              <p className={styles.note}><Icon name="user" width={20} /><span>이름과 색은 방장이 바꿀 수 있어요.</span></p></>}
        </section>
        <section className="settings-group" aria-labelledby="folder-members"><h2 id="folder-members" className="settings-label">멤버 {detail.members.length}/{detail.folder.member_limit}명</h2>
          <ul className={styles.members}>{detail.members.map((m) => <li key={m.user_id}>
            <span className={styles.memberName}><Avatar src={m.avatar} size={32} /><span>{m.name}{m.me && <small> (나)</small>}</span>{m.role === "owner" && <span className={styles.badge}>방장</span>}</span>
            {owner && !m.me && <span className={styles.memberActions}><button type="button" className="text-btn" disabled={busy} onClick={() => setConfirm({ kind: "owner", member: m })}>방장 넘기기</button><button type="button" className="text-btn" disabled={busy} onClick={() => setConfirm({ kind: "kick", member: m })}>내보내기</button></span>}
          </li>)}</ul>
        </section>
        <section className="settings-group" aria-labelledby="folder-invite"><h2 id="folder-invite" className="settings-label">초대</h2>
          {owner ? <div className={styles.invite}>
            {invite ? <div className={styles.inviteBox}>
              <label>초대 링크<input readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} /></label>
              <div className={styles.editorActions}><button type="button" className="btn" onClick={() => { void copyInvite(); }}><Icon name="copy" width={18} />복사</button>{typeof navigator !== "undefined" && "share" in navigator && <button type="button" className="btn primary" onClick={() => { void shareInvite(); }}><Icon name="link" width={18} />보내기</button>}</div>
              <p className="hint">{INVITE_DAYS}일 동안 누구든 이 링크로 참여할 수 있어요. 받는 사람은 카카오·구글로 로그인한 뒤 참여해요.</p>
            </div> : <button type="button" className="settings-row" disabled={busy || detail.members.length >= detail.folder.member_limit} onClick={() => { void makeInvite(); }}><Icon name="link" /><span className="settings-copy"><span>{busy ? "링크 만드는 중…" : "초대 링크 만들기"}</span><small>{detail.members.length >= detail.folder.member_limit ? "인원이 가득 찼어요" : `${INVITE_DAYS}일 동안 쓸 수 있는 링크를 만들어요`}</small></span><Icon name="chevron" width="18" /></button>}
            {detail.active_invites > 0 && <button type="button" className="settings-row" disabled={busy} onClick={() => { void revokeInvites(); }}><Icon name="close" /><span className="settings-copy"><span>초대 링크 모두 끊기</span><small>지금 쓸 수 있는 링크 {detail.active_invites}개를 더 이상 쓰지 못하게 해요</small></span></button>}
          </div> : <p className="hint">초대는 방장({detail.members.find((m) => m.role === "owner")?.name ?? "방장"})이 할 수 있어요.</p>}
        </section>
        <section className={`settings-group ${styles.danger}`} aria-label="방 나가기·삭제">
          {others > 0 && <button type="button" className="settings-row" disabled={busy} onClick={() => setConfirm({ kind: "leave" })}><Icon name="back" /><span className="settings-copy"><span>방 나가기</span><small>{owner ? "가장 먼저 참여한 멤버가 방장이 돼요" : "다시 들어오려면 초대 링크가 필요해요"}</small></span></button>}
          {owner && <button type="button" className="settings-row" disabled={busy} onClick={() => setConfirm({ kind: "delete" })}><Icon name="trash" /><span className="settings-copy"><span>방 삭제</span><small>{others > 0 ? "모든 멤버에게서 장소와 메모가 사라져요" : "이 방의 장소와 메모가 모두 사라져요"}</small></span></button>}
        </section>
      </div>}
      {confirm && detail && <ActionDialog
        title={confirm.kind === "delete" ? `‘${detail.folder.name}’ 방을 삭제할까요?` : confirm.kind === "leave" ? `‘${detail.folder.name}’ 방에서 나갈까요?` : confirm.kind === "kick" ? `${confirm.member.name}님을 내보낼까요?` : `${confirm.member.name}님에게 방장을 넘길까요?`}
        message={confirm.kind === "delete" ? `장소 ${detail.folder.place_count}곳과 메모·모음이 ${others > 0 ? "모든 멤버에게서 " : ""}사라지고 되돌릴 수 없어요.` : confirm.kind === "leave" ? "내가 저장한 장소는 방에 남아요. 다시 들어오려면 초대 링크가 필요해요." : confirm.kind === "kick" ? "저장한 장소는 방에 남아요. 다시 들어오려면 새 초대 링크가 필요해요." : "이름·색 수정, 초대, 내보내기, 삭제를 새 방장이 하게 돼요."}
        tone={confirm.kind === "owner" ? "info" : "error"} destructive={confirm.kind === "delete" || confirm.kind === "kick"} cancelLabel="취소"
        confirmLabel={confirm.kind === "delete" ? "삭제" : confirm.kind === "leave" ? "나가기" : confirm.kind === "kick" ? "내보내기" : "넘기기"} busy={busy}
        onClose={() => { if (!busy) { setConfirm(null); setError(""); } }} onConfirm={runConfirm}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}
    </ClientReady></main>;
  }

  if (creating) {
    return <main className={`form-page settings-page ${styles.page} ${styles.withBar}`}>{header("새 방", () => { setCreating(false); setDraft(NEW_DRAFT); setError(""); })}<ClientReady>
      {feedback}
      <RoomEditor draft={draft} onChange={setDraft} busy={busy} kicker="미리보기" meta="나만 · 장소 0곳"
        note={<>방을 만들면 <b>초대 링크</b>로 함께 쓸 사람을 부를 수 있어요. 방 안은 <b>모음</b>으로 나눠요.</>} submitLabel="만들기" busyLabel="만드는 중…" onSubmit={() => { void create(); }} />
    </ClientReady></main>;
  }

  const full = folders.length >= ROOM_LIMIT;
  return <main className={`form-page settings-page ${styles.page}`}>{header("방")}<ClientReady>
    {!data && !loadError && <p className="hint" role="status">방 목록을 불러오고 있어요…</p>}
    {loadError && <section className="settings-notice"><p className="error" role="alert">{loadError}</p><button type="button" className="btn" onClick={() => { void load(); }}>다시 불러오기</button></section>}
    {data && <>
      {!folders.length && <p className={styles.empty}>아직 방이 없어요. 새 방을 만들거나, 받은 초대 링크로 참여해 보세요.</p>}
      {feedback}
      <section className="settings-group" aria-labelledby="folder-list">
        <h2 id="folder-list" className={`settings-label ${styles.countLabel}`}><span>내 방 {folders.length}개</span><span>{ROOM_LIMIT}개까지</span></h2>
        {folders.length > 0 && <ul className={styles.list}>{folders.map((f) => { const current = f.id === data.current; return <li key={f.id} className={current ? styles.current : undefined}>
          <button type="button" className={styles.openRow} disabled={busy} aria-current={current ? "true" : undefined} onClick={() => open(f)}>
            <RoomBand color={f.color} className={styles.band} />
            <span className={styles.rowCopy}><strong>{f.name}</strong><small>{f.role === "owner" ? "방장 · " : ""}{people(f.member_count)} · 장소 {f.place_count}곳</small></span>
            {current && <span className={styles.badge}>보는 중</span>}
          </button>
          <button type="button" className={styles.manage} disabled={busy} aria-label={`${f.name} 방 관리`} onClick={() => { setError(""); setStatus(""); setSelected(f.id); }}><Icon name="settings" /></button>
        </li>; })}</ul>}
        <button type="button" className={styles.newRow} disabled={busy || full} onClick={() => { setError(""); setStatus(""); setDraft(NEW_DRAFT); setCreating(true); }}>
          <span className={styles.newBand} aria-hidden="true" />
          <span className={styles.rowCopy}><span>새 방 만들기</span><small>{full ? `방은 ${ROOM_LIMIT}개까지예요. 쓰지 않는 방을 정리하면 새로 만들 수 있어요.` : "혼자 모으거나, 둘이·친구들과 함께 쓸 방"}</small></span>
        </button>
      </section>
      {folders.length > 0 && <p className={styles.note}><Icon name="list" width={20} /><span>같은 사람과 주제만 다르면 방을 새로 만들지 말고 <b>방 안에 모음</b>을 만들어요. 다시 초대할 필요가 없어요.</span></p>}
    </>}
  </ClientReady></main>;
}
