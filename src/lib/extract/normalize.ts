import { parseJsonObject } from "../llm";
import type { ModuleName, PlaceCandidate } from "./types";

interface RawPlace {
  name?: unknown;
  branch?: unknown;
  address?: unknown;
  area_hint?: unknown;
  category?: unknown;
  confidence?: unknown;
  evidence?: unknown;
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.toLowerCase() !== "null" ? t : null;
};

/** LLM 응답(JSON 텍스트)을 PlaceCandidate 배열로 바꿉니다. 이상한 값은 버립니다. */
export function candidatesFromLlm(text: string, module: ModuleName): PlaceCandidate[] {
  const parsed = parseJsonObject<{ places?: RawPlace[] }>(text);
  if (!parsed || !Array.isArray(parsed.places)) return [];
  const out: PlaceCandidate[] = [];
  for (const p of parsed.places) {
    if (!p || typeof p !== "object") continue;
    const name = str(p.name);
    if (!name || name.length > 60) continue;
    const c = typeof p.confidence === "number" ? p.confidence : Number(p.confidence);
    out.push({
      name,
      branch: str(p.branch),
      address: str(p.address),
      areaHint: str(p.area_hint),
      category: str(p.category),
      confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5,
      evidence: str(p.evidence) ?? "",
      module,
    });
  }
  return out;
}

/** 비교용 키: 공백·기호 제거, 소문자, 끝의 "점" 제거 */
export function nameKey(name: string, branch?: string | null): string {
  const n = `${name}${branch ?? ""}`
    .toLowerCase()
    .replace(/[\s·\-_.,'"()\[\]]/g, "");
  return n;
}
