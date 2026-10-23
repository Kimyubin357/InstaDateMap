"use client";
import { useState } from "react";
import { requestJson } from "@/lib/client-request";
import { workId } from "@/lib/work-id";
import ActionDialog from "./ActionDialog";
export default function DismissSource({ id, version, disabled, onDone }: { id: string; version: string; disabled?: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function dismiss() {
    if (busy) return;
    setBusy(true); setError("");
    try { await requestJson(`/api/sources/${id}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss", version, work_id: workId() }) }); setOpen(false); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "링크를 제외하지 못했어요."); }
    finally { setBusy(false); }
  }
  return <><button className="text-btn" disabled={disabled || busy} onClick={() => { setError(""); setOpen(true); }}>이 링크 제외하기</button>
    {open && <ActionDialog title="이 링크 등록을 포기할까요?" message="확인 대기함에서 제외해요. 이미 저장한 장소는 그대로 남아요." destructive confirmLabel="제외하기" cancelLabel="계속 확인" busy={busy} onClose={() => { if (!busy) setOpen(false); }} onConfirm={dismiss}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}</>;
}
