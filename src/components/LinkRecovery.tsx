"use client";
import type { ReactNode } from "react";
import Icon from "./Icon";
import { analysisRecovery } from "@/lib/analysis-issue";

export default function LinkRecovery({ reason, busy, onRetry, onSearch, children }: {
  reason?: string | null; busy: boolean; onRetry: () => void; onSearch: () => void; children?: ReactNode;
}) {
  const recovery = analysisRecovery(reason);
  const search = <button className={`btn${recovery === "search" ? " primary" : ""}`} disabled={busy} onClick={onSearch}><Icon name="search" width="19" />장소 이름으로 직접 찾기</button>;
  const retry = <button className={`btn${recovery === "retry" ? " primary" : ""}`} disabled={busy} onClick={onRetry}><Icon name="refresh" width="17" />{recovery === "search" ? "분석 다시 시도" : "다시 시도하기"}</button>;
  return <section className="fallback-options"><h3>이어서 등록하기</h3>
    {recovery === "search" ? <>{search}{retry}</> : <>{retry}{search}</>}
    {children}
  </section>;
}
