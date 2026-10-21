import { db } from "@/lib/db";
import type { KakaoPlace } from "@/lib/types";
import ConfirmForm, { type ExtractionView } from "./ConfirmForm";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: { sourceId: string };
  searchParams: { t?: string; who?: string };
}) {
  const token = searchParams.t ?? "";
  const { data: board } = token
    ? await db().from("boards").select("id").eq("token", token).maybeSingle()
    : { data: null };
  if (!board) {
    return (
      <main className="confirm">
        <h1>열 수 없는 링크예요</h1>
        <p className="lead">보드 주소가 맞지 않아요. 단축어에서 다시 열어 주세요.</p>
      </main>
    );
  }

  const { data: source } = await db()
    .from("sources")
    .select("id, url, status, caption, shared_by")
    .eq("id", params.sourceId)
    .eq("board_id", board.id)
    .maybeSingle();
  if (!source) {
    return (
      <main className="confirm">
        <h1>링크를 찾을 수 없어요</h1>
      </main>
    );
  }

  const { data: rows } = await db()
    .from("extractions")
    .select("id, module, raw_name, branch, raw_address, area_hint, evidence, confidence, candidates, excluded")
    .eq("source_id", source.id)
    .order("confidence", { ascending: false });

  const extractions: ExtractionView[] = (rows ?? []).map((r) => ({
    id: r.id,
    module: r.module,
    name: [r.raw_name, r.branch].filter(Boolean).join(" "),
    areaHint: r.area_hint,
    evidence: r.evidence,
    candidates: (r.candidates ?? []) as KakaoPlace[],
  }));

  return (
    <ConfirmForm
      token={token}
      who={searchParams.who || source.shared_by}
      source={{ id: source.id, url: source.url, status: source.status, caption: source.caption }}
      extractions={extractions}
    />
  );
}
