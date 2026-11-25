"use client";
import { useEffect, useState, type CSSProperties } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import ShellLink from "./ShellLink";
import { useBoardState, useBoardSync } from "./BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { FolderIcon, FolderSummary, FoldersResponse } from "@/lib/folders";
import { lastSavedRoom } from "@/lib/saved-memory";
import styles from "./Registration.module.css";

export type RoomLook = { color?: string | null; icon?: FolderIcon | null };
const roomColor = (color?: string | null): CSSProperties => ({ "--room-color": color ? `var(--collection-${color})` : "var(--accent)" } as CSSProperties);
const members = (f: FolderSummary) => f.member_count > 1 ? `${f.member_count}명` : "나만";

/** 방 색·아이콘 표지 */
export function RoomAvatar({ room, size = "lg" }: { room?: RoomLook | null; size?: "lg" | "row" | "sm" }) {
  return <span className={`${styles.avatar}${size === "sm" ? ` ${styles.avatarSm}` : size === "row" ? ` ${styles.avatarRow}` : ""}`} style={roomColor(room?.color)} aria-hidden="true"><Icon name={room?.icon ?? "heart"} width={size === "sm" ? 18 : 22} /></span>;
}

/** 확인 화면·분석 중의 읽기 전용 한 줄: "'방'에 담아요" (분석이 시작된 링크는 그 방에 담깁니다) */
export function RoomLine({ name, room }: { name: string; room?: RoomLook | null }) {
  return <div className={styles.roomLine}><RoomAvatar room={room} size="sm" /><span>‘<em>{name}</em>’에 담아요</span></div>;
}

/**
 * 장소 추가 맨 위의 저장할 방(시안 1·2번). 저장은 지금 연 방(서버 세션)으로 가고,
 * [바꾸기]로 고른 방은 이 기기에서 열린 방이 되어 다음 저장에도 그대로 쓰입니다.
 */
export default function RoomChooser({ disabled = false, onRoom }: { disabled?: boolean; onRoom?: (current: FolderSummary | null) => void }) {
  const sync = useBoardSync();
  const state = useBoardState();
  const name = state.snapshot?.board ?? "";
  const [data, setData] = useState<FoldersResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const load = () => {
    setError("");
    return requestJson<FoldersResponse>("/api/folders", { cache: "no-store", notifyBoardChange: false }).then(setData)
      .catch((e) => setError(friendlyMessage(e, "방 목록을 불러오지 못했어요. 다시 시도해 주세요.")));
  };
  useEffect(() => { setLast(lastSavedRoom()); void load(); }, [state.access?.boardId]);
  const current = data?.folders.find((f) => f.id === (data.current ?? state.access?.boardId)) ?? null;
  useEffect(() => { onRoom?.(current); }, [current?.id, current?.name, current?.color, current?.icon]);
  async function choose(folder: FolderSummary) {
    if (busy) return;
    if (folder.id === current?.id) { setOpen(false); return; }
    setBusy(true); setError("");
    try {
      await requestJson(`/api/folders/${folder.id}/open`, { method: "POST", notifyBoardChange: false, headers: { "Content-Type": "application/json" }, body: "{}" });
      if (await sync.resetAccess()) { setOpen(false); sync.notify(`‘${folder.name}’에 저장해요.`, "info"); await load(); }
    } catch (e) { setError(friendlyMessage(e, "방을 바꾸지 못했어요. 다시 시도해 주세요.")); }
    finally { setBusy(false); }
  }
  const shown = current?.name || name;
  const kicker = current ? `${last === current.id ? "마지막에 저장한 방" : "지금 보고 있는 방"} · ${members(current)}` : "저장할 방";
  const close = <button className="icon-btn sheet-close-btn" aria-label="방 고르기 닫기" disabled={busy} onClick={() => setOpen(false)}><Icon name="close" width={18} /></button>;
  return <>
    <div className={styles.roomCard}>
      <RoomAvatar room={current} />
      <div><span className={styles.kicker}>{kicker}</span><span className={styles.roomBig}>{shown ? <>‘<em>{shown}</em>’에 저장해요</> : "방을 확인하고 있어요…"}</span></div>
      <button type="button" className={styles.change} disabled={disabled || busy} aria-haspopup="dialog" onClick={() => { setOpen(true); if (!data) void load(); }}>바꾸기</button>
    </div>
    {open && <Modal title="어느 방에 저장할까요?" variant="compact" className={styles.sheet} headerActions={close} onClose={() => { if (!busy) setOpen(false); }}>
      <p className={styles.sheetLead}>고른 방은 다음 저장 때도 그대로예요.</p>
      {!data && !error && <p className={styles.status} role="status">방 목록을 불러오고 있어요…</p>}
      {data && <div role="radiogroup" aria-label="저장할 방">
        {data.folders.map((f) => <button key={f.id} type="button" role="radio" aria-checked={f.id === current?.id} className={styles.roomRow} disabled={busy} onClick={() => void choose(f)}>
          <RoomAvatar room={f} size="row" />
          <span><strong>{f.name}</strong><small>{members(f)} · 장소 {f.place_count}</small></span>
          {f.id === last && <span className={styles.recent}>최근</span>}
          {f.id === current?.id && <span className={styles.check} aria-hidden="true"><Icon name="check" width={16} /></span>}
        </button>)}
        <ShellLink className={`${styles.roomRow} ${styles.roomNew}`} href="/folders"><span className={`${styles.avatar} ${styles.avatarRow} ${styles.newAvatar}`} aria-hidden="true"><Icon name="plus" width={20} /></span><span><strong>새 방 만들기</strong><small>만들면 그 방이 열리고, 거기에 저장해요</small></span></ShellLink>
      </div>}
      {busy && <p className={styles.status} role="status">방을 바꾸는 중…</p>}
      {error && <div role="alert"><p className="error">{error}</p>{!data && <button className="text-btn" onClick={() => void load()}>다시 불러오기</button>}</div>}
      <p className={styles.note}>잘못 담아도 괜찮아요. 장소 상세의 ‘다른 방에 담기’로 옮겨 담을 수 있어요.</p>
    </Modal>}
  </>;
}
