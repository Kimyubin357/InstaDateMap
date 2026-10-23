"use client";
import Link from "next/link";
import type { PendingSource } from "@/lib/sync-types";
import { analysisSummary } from "@/lib/analysis-issue";
import { pendingAction, pendingDate, pendingTitle } from "@/lib/pending-source";
import DismissSource from "./DismissSource";
import Icon from "./Icon";
export default function PendingLinks({ sources, onChanged }: { sources: PendingSource[]; onChanged: () => void }) {
  const summaries = new Map<string, number>();
  for (const source of sources) {
    const summary = analysisSummary(source.recovery_reason);
    if (summary) summaries.set(summary, (summaries.get(summary) ?? 0) + 1);
  }
  return <>
    {[...summaries].map(([message, count]) => <p key={message} className="notice pending-summary" role="status">{message}<small>해당 링크 {count}개</small></p>)}
    <div className="pending-list">{sources.map((source) => <div key={source.id}>
      <Link href={`/confirm/${source.id}`} className="pending-row"><div>
        <strong>{pendingTitle(source)}</strong>
        <small>{[source.shared_by, pendingDate(source.shared_at)].filter(Boolean).join(" · ")}</small>
        <span className="pending-action">{pendingAction(source)}</span>
        {!source.place_names?.length && <small className="pending-link-code">{source.url.replace(/^https?:\/\/(www\.)?instagram.com\//, "")}</small>}
      </div><Icon name="chevron" /></Link>
      {source.analysis_version && <DismissSource id={source.id} version={source.analysis_version} onDone={onChanged} />}
    </div>)}</div>
  </>;
}
