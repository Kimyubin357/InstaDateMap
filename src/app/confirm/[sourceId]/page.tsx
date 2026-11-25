import { recoverSources } from "@/lib/source-work";
import { db } from "@/lib/db";
import { requirePageBoard } from "@/lib/access";
import type { KakaoPlace } from "@/lib/types";
import ConfirmForm, { type ExtractionView } from "./ConfirmForm";
export const dynamic = "force-dynamic";
export default async function ConfirmPage({ params: route, searchParams: query }: { params: Promise<{ sourceId: string }>; searchParams: Promise<{ t?: string }> }) {
  const [params, searchParams] = await Promise.all([route, query]);
  const next = `/confirm/${params.sourceId}`;
  const board = await requirePageBoard(next);
  await recoverSources(board.id);
  const { data: source, error } = await db().from("sources").select("id, url, status, shared_by, analysis_version, recovery_reason").eq("id", params.sourceId).eq("board_id", board.id).maybeSingle();
  if (error) throw new Error("링크를 불러오지 못했어요.");
  if (!source) return <main className="confirm"><h1>링크를 찾을 수 없어요</h1><a className="btn" href="/">지도로 돌아가기</a></main>;
  if (["done", "dismissed"].includes(source.status)) return <main className="confirm"><h1>{source.status === "done" ? "등록이 끝난 링크예요" : "확인 대기에서 정리한 링크예요"}</h1><a className="btn" href="/">지도로 돌아가기</a><a className="btn" href={`/add?url=${encodeURIComponent(source.url)}`}>링크 다시 등록하기</a></main>;
  const { data: rows, error: rowError } = await db().from("extractions").select("id, module, raw_name, branch, area_hint, confidence, candidates, excluded").eq("source_id", source.id).order("confidence", { ascending: false });
  if (rowError) throw new Error("장소 후보를 읽지 못했어요.");
  // 장소 이름은 캡션에서만 읽습니다. 예전에 위치 태그(역·동네)로 만든 후보는 보여 주지도, 보내지도 않습니다.
  const extractions: ExtractionView[] = (rows || []).filter((r) => r.module !== "location_tag").map((r) => ({ id: r.id, module: r.module, name: [r.raw_name, r.branch].filter(Boolean).join(" "), rawName: r.raw_name, branch: r.branch, areaHint: r.area_hint, candidates: (r.candidates || []) as KakaoPlace[], excluded: r.excluded }));
  const { data: look } = await db().from("boards").select("color, icon").eq("id", board.id).maybeSingle();
  return <ConfirmForm key={`${source.id}:${source.analysis_version}:${source.status}:${extractions.map((e) => e.id).join(",")}`} room={{ id: board.id, name: board.name, color: look?.color, icon: look?.icon }} source={{ id: source.id, url: source.url, status: source.status, version: source.analysis_version, recoveryReason: source.recovery_reason }} extractions={extractions} />;
}
