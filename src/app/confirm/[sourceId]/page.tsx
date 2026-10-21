import { db } from "@/lib/db";
import { legacyRedirect, requirePageBoard } from "@/lib/access";
import type { KakaoPlace } from "@/lib/types";
import ConfirmForm, { type ExtractionView } from "./ConfirmForm";
export const dynamic = "force-dynamic";
export default async function ConfirmPage({ params, searchParams }: { params: { sourceId: string }; searchParams: { t?: string } }) {
  const next = `/confirm/${params.sourceId}`; legacyRedirect(searchParams.t, next);
  const board = await requirePageBoard(next);
  const { data: source, error } = await db().from("sources").select("id, url, status, caption, shared_by").eq("id", params.sourceId).eq("board_id", board.id).maybeSingle();
  if (error) throw new Error("링크를 불러오지 못했어요.");
  if (!source) return <main className="confirm"><h1>링크를 찾을 수 없어요</h1><a className="btn" href="/">우리 지도로 돌아가기</a></main>;
  const { data: rows, error: rowError } = await db().from("extractions").select("id, module, raw_name, branch, area_hint, evidence, confidence, candidates, excluded").eq("source_id", source.id).order("confidence", { ascending: false });
  if (rowError) throw new Error("장소 후보를 읽지 못했어요.");
  const extractions: ExtractionView[] = (rows || []).map((r) => ({ id: r.id, module: r.module, name: [r.raw_name, r.branch].filter(Boolean).join(" "), areaHint: r.area_hint, evidence: r.evidence, candidates: (r.candidates || []) as KakaoPlace[], excluded: r.excluded }));
  return <ConfirmForm key={`${source.id}:${source.status}:${extractions.map((e) => e.id).join(",")}`} source={{ id: source.id, url: source.url, status: source.status, caption: source.caption }} extractions={extractions} />;
}
