"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import ClientReady from "@/components/ClientReady";
import Icon from "@/components/Icon";
import ShellLink from "@/components/ShellLink";
import ActionDialog from "@/components/ActionDialog";
import ActionSheet, { ActionLead } from "@/components/ActionSheet";
import { RoomActionSheet, type RoomAction } from "@/components/Rooms";
import Avatar from "@/components/Avatar";
import { useBoardSync, useRooms } from "@/components/BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { FOLDER_COLOR_LABEL, INVITE_DAYS, isUuid, ROOM_LIMIT, ROOM_NAME_MAX, type FolderColor, type FolderDetail, type FolderMember, type FolderSummary, type FoldersResponse } from "@/lib/folders";
import { ColorSwatches, FieldLabel, RoomCard, toneStyle } from "@/components/Palette";
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
    {children}
    {/* 안내는 저장 버튼 아래 한 줄(시안 design-lab/settings 5번) */}
    <div className="set-cta"><button className="btn primary green" disabled={busy || !trimmed || unchanged}>{busy ? busyLabel : submitLabel}</button><small>{note}</small></div>
  </form>;
}

/**
 * 폴더 목록·만들기·전환, 그리고 폴더 관리(이름·표지, 멤버, 초대, 나가기·삭제).
 * standalone: 폴더가 0개라 지도 없이 이 화면만 보여줄 때.
 */
export default function FoldersPanel({ standalone = false }: { standalone?: boolean }) {
  const sync = useBoardSync();
  const roomsState = useRooms();
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
  /** 방 설정은 한 번에 한 화면: 방 수정(이름·색) 또는 멤버 관리(멤버·초대). 나가기·삭제는 ⚙ 시트에서 고릅니다(시안 design-lab/edit-sheets). */
  const [view, setView] = useState<"edit" | "members">("members");
  const [sheet, setSheet] = useState<FolderSummary | null>(null);
  const [memberSheet, setMemberSheet] = useState<FolderMember | null>(null);
  const [inviteSheet, setInviteSheet] = useState(false);
  /** ⚙ 시트에서 고른 초대하기·나가기·삭제: 방 정보를 받은 뒤 한 번 실행합니다. */
  const pending = useRef<RoomAction | null>(null);
  const fromSheet = useRef(false);
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
  // 내 방 시트·리스트 [방] 칸의 "+ 새 방 만들기"는 /folders?new=1 로 바로 만들기 화면을 엽니다.
  useEffect(() => { if (new URLSearchParams(window.location.search).get("new") === "1") setCreating(true); }, []);
  // 내 방 시트·방 머리띠·리스트 [방] 칸의 ⚙ 시트는 /folders?room=<id>&view=<할 일> 로 그 화면을 바로 엽니다. 뒤로 가면 왔던 화면으로 돌아갑니다.
  const direct = useRef(false);
  const openRoom = (id: string, action: RoomAction) => {
    setError(""); setStatus(""); setSelected(id); setView(action === "edit" ? "edit" : "members");
    pending.current = action === "edit" || action === "members" ? null : action;
  };
  useEffect(() => {
    const query = new URLSearchParams(window.location.search), id = query.get("room"), action = query.get("view") as RoomAction | null;
    if (id && isUuid(id)) { direct.current = true; openRoom(id, action && ["edit", "members", "invite", "delete", "leave"].includes(action) ? action : "members"); }
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    setError("");
    try {
      const next = await call<FolderDetail>(`/api/folders/${id}`); setDetail(next); setEdit(next.folder.role === "owner" ? { name: next.folder.name, color: next.folder.color } : null);
      if (next.folder.role !== "owner") setView("members");
      const action = pending.current; pending.current = null;
      const owner = next.folder.role === "owner", others = next.members.length > 1;
      if (action === "delete" && owner) { fromSheet.current = true; setConfirm({ kind: "delete" }); }
      else if (action === "leave" && others) { fromSheet.current = true; setConfirm({ kind: "leave" }); }
      else if (action === "invite" && owner && next.members.length < next.folder.member_limit) inviteSoon.current = true;
    }
    catch (e) { setError(friendlyMessage(e, "방 정보를 불러오지 못했어요.")); }
  }, []);
  useEffect(() => { if (selected) { setDetail(null); setInvite(null); void loadDetail(selected); } }, [selected, loadDetail]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [selected, view]);
  // ⚙ 시트의 초대하기: 멤버 관리 화면을 열고 바로 초대 링크를 만듭니다(복사 · 보내기).
  useEffect(() => { if (detail && inviteSoon.current) { inviteSoon.current = false; void makeInvite(); } });

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
    // 방을 열거나 새로 만들면 지도·리스트도 그 방만 봅니다(방 고르기·전체 보기, 2026-11-25).
    if (goHome) sync.rooms.setScope("room");
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
    setDetail(next); await load(); sync.rooms.schedule(0); say("방을 바꿨어요.");
    if (selected === data?.current && !standalone) sync.store.invalidate();
  }, "방을 바꾸지 못했어요. 다시 시도해 주세요.");
  const inviteSoon = useRef(false);
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
      if (next) { setDetail(next); setEdit(null); setConfirm(null); await load(); sync.rooms.schedule(0); say(`${confirm.member.name}님이 방장이 됐어요.`); }
      return;
    }
    if (confirm.kind === "kick") {
      const ok = await act(() => call(`/api/folders/${folder.id}/members/${confirm.member.user_id}`, "DELETE"), "내보내지 못했어요. 다시 시도해 주세요.");
      if (ok) { setConfirm(null); await loadDetail(folder.id); await load(); sync.rooms.schedule(0); say(`${confirm.member.name}님을 내보냈어요.`); }
      return;
    }
    const res = await act(() => confirm.kind === "delete"
      ? call<{ current: string | null }>(`/api/folders/${folder.id}`, "DELETE")
      : call<{ current: string | null }>(`/api/folders/${folder.id}/members/${me?.user_id}`, "DELETE"), confirm.kind === "delete" ? "방을 삭제하지 못했어요. 다시 시도해 주세요." : "방에서 나가지 못했어요. 다시 시도해 주세요.");
    if (!res) return;
    fromSheet.current = false; direct.current = false;
    setConfirm(null); setSelected(null); setDetail(null);
    await follow(res.current, false, confirm.kind === "delete" ? `‘${folder.name}’ 방을 삭제했어요.` : `‘${folder.name}’ 방에서 나왔어요.`);
    await load(); sync.rooms.schedule(0);
  }

  const folders = data?.folders ?? [];
  const header = (title: string, back?: () => void, right?: ReactNode) => <header className="page-header">
    {back ? <button type="button" className="icon-btn" aria-label="방 목록으로" onClick={back}><Icon name="back" /></button>
      : standalone ? <span className="header-spacer" /> : <ShellLink href="/settings" className="icon-btn" aria-label="이전 화면으로"><Icon name="back" /></ShellLink>}
    <h1 ref={heading} tabIndex={-1}>{title}</h1>{right ?? <span className="header-spacer" />}</header>;
  const feedback = <>{error && <p className={`error ${styles.message}`} role="alert">{error}</p>}{status && <p className={`hint ${styles.message}`} role="status">{status}</p>}</>;

  if (selected) {
    const folder = detail?.folder ?? folders.find((f) => f.id === selected);
    const owner = detail?.folder.role === "owner";
    const others = detail ? detail.members.length - 1 : 0;
    const editing = owner && view === "edit";
    const leaveDetail = () => { setConfirm(null); setMemberSheet(null); if (direct.current) { direct.current = false; if (window.history.length > 1) router.back(); else router.replace("/"); return; } setSelected(null); setError(""); setStatus(""); };
    const full = !!detail && detail.members.length >= detail.folder.member_limit;
    const inviteMenu = owner && !editing && (detail?.active_invites ?? 0) > 0
      ? <button type="button" className="icon-btn" aria-label="초대 링크 관리" aria-haspopup="dialog" onClick={() => setInviteSheet(true)}><Icon name="more" /></button> : undefined;
    return <main className={`form-page settings-page has-cta ${styles.page}`}>{header(editing ? "방 수정" : owner ? "멤버 관리" : `${folder?.name ?? "방"} 멤버`, leaveDetail, inviteMenu)}<ClientReady>
      {feedback}
      {!detail ? !error && <p className="hint" role="status">방 정보를 불러오고 있어요…</p> : editing && edit ? <div className={styles.detail}>
        <section className={styles.about} aria-label="방 이름과 색">
          <RoomEditor draft={edit} onChange={setEdit} busy={busy} kicker="방장 · 나" meta={`${people(detail.members.length)} · 장소 ${detail.folder.place_count}곳`}
            note="바꾸면 모든 멤버에게 보여요" submitLabel="저장" busyLabel="저장하는 중…" onSubmit={() => { void save(); }}
            unchanged={clean(edit.name) === detail.folder.name && edit.color === detail.folder.color} />
        </section>
      </div> : <div className={styles.detail}>
        {/* 멤버 관리(시안 design-lab/settings 6번): 멤버 줄 · 초대 링크 한 줄 · 맨 아래 초록 버튼 하나 */}
        <p className="set-count">{detail.members.length} / {detail.folder.member_limit}명</p>
        <section className="set-group" aria-label="멤버">{detail.members.map((m) => <div key={m.user_id} className="set-row">
          <Avatar src={m.avatar} size={40} /><span className="set-title">{m.name}{m.me && <small>나</small>}</span>{m.role === "owner" && <span className="set-tag">방장</span>}
          {owner && !m.me && <button type="button" className={styles.memberMore} disabled={busy} aria-haspopup="dialog" aria-label={`${m.name}님 관리`} onClick={() => setMemberSheet(m)}><Icon name="more" width={22} /></button>}
        </div>)}</section>
        {owner ? <>
          <h2 className="set-label">초대</h2>
          <section className="set-group" aria-label="초대">
            {invite ? <div className={styles.inviteBox}>
              <label>초대 링크 · {INVITE_DAYS}일 동안 쓸 수 있어요<input readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} /></label>
              <button type="button" className="text-btn" onClick={() => { void copyInvite(); }}><Icon name="copy" width={16} /> 링크 복사</button>
            </div> : <div className="set-row"><span className="set-tile"><Icon name="link" /></span><span className="set-title">{full ? "인원이 가득 찼어요" : detail.active_invites > 0 ? `쓸 수 있는 초대 링크 ${detail.active_invites}개` : "아직 만든 초대 링크가 없어요"}</span></div>}
          </section>
          <div className="set-cta"><button type="button" className="btn primary green" disabled={busy || full} onClick={() => { if (invite) void shareInvite(); else void makeInvite(); }}><Icon name="link" width={19} />{busy ? "링크 만드는 중…" : invite ? "초대 링크 보내기" : "초대 링크 만들기"}</button>{!full && !invite && <small>{INVITE_DAYS}일 동안 쓸 수 있는 링크를 만들어요</small>}</div>
        </> : <p className="set-hint" style={{ marginTop: 0 }}>초대는 방장({detail.members.find((m) => m.role === "owner")?.name ?? "방장"})이 할 수 있어요.</p>}
      </div>}
      {inviteSheet && detail && <ActionSheet title="초대 링크" note={`쓸 수 있는 링크 ${detail.active_invites}개`} onClose={() => setInviteSheet(false)} items={[
        { icon: "close", title: "초대 링크 모두 끊기", note: "이미 보낸 링크로는 더 들어올 수 없어요", danger: true, onSelect: () => { setInviteSheet(false); void revokeInvites(); } },
      ]} />}
      {memberSheet && detail && <ActionSheet title={memberSheet.name} note="멤버" lead={<ActionLead round photo={memberSheet.avatar}>{Array.from(memberSheet.name.trim())[0] ?? "?"}</ActionLead>} onClose={() => setMemberSheet(null)} items={[
        { icon: "user", title: "방장 넘기기", note: `${memberSheet.name}님이 방장이 돼요`, chevron: false, onSelect: () => { const member = memberSheet; setMemberSheet(null); setConfirm({ kind: "owner", member }); } },
        { icon: "close", title: "내보내기", note: `${memberSheet.name}님이 담은 장소는 방에 남아요`, danger: true, onSelect: () => { const member = memberSheet; setMemberSheet(null); setConfirm({ kind: "kick", member }); } },
      ]} />}
      {confirm && detail && <ActionDialog
        title={confirm.kind === "delete" ? `‘${detail.folder.name}’ 방을 삭제할까요?` : confirm.kind === "leave" ? `‘${detail.folder.name}’ 방에서 나갈까요?` : confirm.kind === "kick" ? `${confirm.member.name}님을 내보낼까요?` : `${confirm.member.name}님에게 방장을 넘길까요?`}
        message={confirm.kind === "delete" ? `장소 ${detail.folder.place_count}곳과 메모·모음이 ${others > 0 ? "모든 멤버에게서 " : ""}사라지고 되돌릴 수 없어요.` : confirm.kind === "leave" ? "내가 저장한 장소는 방에 남아요. 다시 들어오려면 초대 링크가 필요해요." : confirm.kind === "kick" ? "저장한 장소는 방에 남아요. 다시 들어오려면 새 초대 링크가 필요해요." : "이름·색 수정, 초대, 내보내기, 삭제를 새 방장이 하게 돼요."}
        tone={confirm.kind === "owner" ? "info" : "error"} destructive={confirm.kind === "delete" || confirm.kind === "kick"} cancelLabel="취소"
        confirmLabel={confirm.kind === "delete" ? "삭제" : confirm.kind === "leave" ? "나가기" : confirm.kind === "kick" ? "내보내기" : "넘기기"} busy={busy}
        onClose={() => { if (busy) return; setError(""); if (fromSheet.current) { fromSheet.current = false; leaveDetail(); } else setConfirm(null); }} onConfirm={runConfirm}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}
    </ClientReady></main>;
  }

  if (creating) {
    return <main className={`form-page settings-page ${styles.page} ${styles.withBar}`}>{header("새 방", () => { setCreating(false); setDraft(NEW_DRAFT); setError(""); })}<ClientReady>
      {feedback}
      <RoomEditor draft={draft} onChange={setDraft} busy={busy} kicker="미리보기" meta="나만 · 장소 0곳"
        note="만든 뒤 초대 링크로 함께 쓸 사람을 부를 수 있어요" submitLabel="만들기" busyLabel="만드는 중…" onSubmit={() => { void create(); }} />
    </ClientReady></main>;
  }

  const full = folders.length >= ROOM_LIMIT;
  const roomInfo = new Map((roomsState.rooms ?? []).map((r) => [r.id, r]));
  const viewingOne = roomsState.scope === "room";
  // 내 방(시안 design-lab/settings 4번): 방 색 네모 · 이름 · 멤버 얼굴 · ⚙, 만들기는 맨 아래 초록 버튼.
  return <main className={`form-page settings-page has-cta ${styles.page}`}>{header("내 방")}<ClientReady>
    {!data && !loadError && <p className="hint" role="status">방 목록을 불러오고 있어요…</p>}
    {loadError && <section className="settings-notice"><p className="error" role="alert">{loadError}</p><button type="button" className="btn" onClick={() => { void load(); }}>다시 불러오기</button></section>}
    {data && <>
      {!folders.length && <p className={styles.empty}>아직 방이 없어요. 새 방을 만들거나, 받은 초대 링크로 참여해 보세요.</p>}
      {feedback}
      {folders.length > 0 && <>
        <p className="set-count">{folders.length} / {ROOM_LIMIT}개</p>
        <section className="set-group" aria-label="내 방">{folders.map((f) => { const current = f.id === data.current, info = roomInfo.get(f.id); return <div key={f.id} className="set-row" style={toneStyle(f.color)}>
          <button type="button" className={styles.openRow} disabled={busy} aria-current={current && viewingOne ? "true" : undefined} aria-label={`${f.name}${f.role === "owner" ? ", 방장" : ""}, ${people(f.member_count)}. 이 방으로 들어가기`} onClick={() => open(f)}>
            <span className="set-room" aria-hidden="true" /><span className="set-title">{f.name}</span>
            {current && viewingOne && <span className="set-tag">보는 중</span>}
            {info && <span className="set-faces" aria-hidden="true">{info.member_names.slice(0, 3).map((n, k) => <Avatar key={`${n}-${k}`} src={info.member_avatars?.[k] ?? null} size={22} />)}</span>}
          </button>
          <button type="button" className={styles.manage} disabled={busy} aria-label={`${f.name} 방 설정`} aria-haspopup="dialog" onClick={() => setSheet(f)}><Icon name="settings" width={20} /></button>
        </div>; })}</section>
        <p className="set-hint">같은 사람과 주제만 다르면 새 방 대신 <b style={{ fontWeight: 400, color: "var(--forest)" }}>모음</b>을 만들어요.</p>
      </>}
      <div className="set-cta"><button type="button" className="btn primary green" disabled={busy || full} onClick={() => { setError(""); setStatus(""); setDraft(NEW_DRAFT); setCreating(true); }}><Icon name="plus" width={19} />새 방 만들기</button>{full && <small>방은 {ROOM_LIMIT}개까지예요</small>}</div>
      {sheet && <RoomActionSheet room={sheet} onClose={() => setSheet(null)} onGo={(action) => openRoom(sheet.id, action)} onRemoved={() => { void load(); }} />}
    </>}
  </ClientReady></main>;
}
