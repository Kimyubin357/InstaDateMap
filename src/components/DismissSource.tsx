"use client";
import { useState, type ReactNode } from "react";
import { requestJson } from "@/lib/client-request";
import { workId } from "@/lib/work-id";
import ActionDialog from "./ActionDialog";

/**
 * 저장 없이 링크를 정리합니다(시안 14번). 0곳 완료는 이 확인창을 거쳐야만 합니다.
 * 확인창에는 담지 않을 장소 이름을 그대로 보여 주고, 기본 선택은 [계속 확인하기]입니다.
 */
export default function DismissSource({ id, version, disabled, onDone, names = [], className = "text-btn", children = "이 링크 정리하기" }: {
  id: string; version: string; disabled?: boolean; onDone: () => void; names?: string[]; className?: string; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function dismiss() {
    if (busy) return;
    setBusy(true); setError("");
    try { await requestJson(`/api/sources/${id}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss", version, work_id: workId() }) }); setOpen(false); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "링크를 정리하지 못했어요."); }
    finally { setBusy(false); }
  }
  const shown = [...new Set(names.filter((name) => name.trim()))];
  return <><button type="button" className={className} disabled={disabled || busy} onClick={() => { setError(""); setOpen(true); }}>{children}</button>
    {open && <ActionDialog title="이 링크는 저장하지 않을까요?" message={shown.length ? "게시물에서 찾은 곳을 담지 않고, 확인 대기에서 정리해요." : "이 링크를 확인 대기에서 정리해요."} tone="info" confirmLabel="정리하기" busyLabel="정리하는 중…" cancelLabel="계속 확인하기" busy={busy} onClose={() => { if (!busy) setOpen(false); }} onConfirm={dismiss}>
      {shown.length > 0 && <ul className="dismiss-list">{shown.map((name) => <li key={name}><span>{name}</span><small>담지 않음</small></li>)}</ul>}
      <p className="dismiss-note">이미 저장한 장소는 그대로 남아요.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </ActionDialog>}</>;
}
