import { recoverSources } from "@/lib/source-work";
import { db } from "@/lib/db";
import { legacyRedirect, requirePageBoard } from "@/lib/access";
import type { KakaoPlace } from "@/lib/types";
import ConfirmForm, { type ExtractionView } from "./ConfirmForm";
export const dynamic = "force-dynamic";
export default async function ConfirmPage({ params: route, searchParams: query }: { params: Promise<{ sourceId: string }>; searchParams: Promise<{ t?: string }> }) {
  const [params, searchParams] = await Promise.all([route, query]);
  const next = `/confirm/${params.sourceId}`; legacyRedirect(searchParams.t, next);
  const board = await requirePageBoard(next);
  await recoverSources(board.id);
  const { data: source, error } = await db().from("sources").select("id, url, status, caption, shared_by, analysis_version, recovery_reason").eq("id", params.sourceId).eq("board_id", board.id).maybeSingle();
  if (error) throw new Error("링크를 불러오지 못했어요.");
  if (!source) return <main className="confirm"><h1>링크를 찾을 수 없어요</h1><a className="btn" href="/">우리 지도로 돌아가기</a></main>;
  if (["done", "dismissed"].includes(source.status)) return <main className="confirm"><h1>{source.status === "done" ? "등록이 끝난 링크예요" : "대기함에서 제외한 링크예요"}</h1><a className="btn" href="/">우리 지도로 돌아가기</a><a className="btn" href={`/add?url=${encodeURIComponent(source.url)}`}>링크 다시 등록하기</a></main>;
  const { data: rows, error: rowError } = await db().from("extractions").select("id, module, raw_name, branch, area_hint, evidence, confidence, candidates, excluded").eq("source_id", source.id).order("confidence", { ascending: false });
  if (rowError) throw new Error("장소 후보를 읽지 못했어요.");
  const extractions: ExtractionView[] = (rows || []).map((r) => ({ id: r.id, module: r.module, name: [r.raw_name, r.branch].filter(Boolean).join(" "), areaHint: r.area_hint, evidence: r.evidence, candidates: (r.candidates || []) as KakaoPlace[], excluded: r.excluded }));
  return <ConfirmForm key={`${source.id}:${source.analysis_version}:${source.status}:${extractions.map((e) => e.id).join(",")}`} source={{ id: source.id, url: source.url, status: source.status, caption: source.caption, version: source.analysis_version, recoveryReason: source.recovery_reason }} extractions={extractions} />;
}
