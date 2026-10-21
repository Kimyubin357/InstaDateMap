import type { PlaceCandidate } from "./types";
import { nameKey } from "./normalize";

/**
 * 여러 모듈의 후보를 합칩니다.
 * - 같은 상호(+지점)는 하나로, 신뢰도는 최댓값, 빈 필드는 서로 채움
 * - 두 모듈 이상이 같은 곳을 가리키면 신뢰도를 조금 올림
 * - 신뢰도 높은 순 정렬
 */
export function mergeCandidates(all: PlaceCandidate[]): PlaceCandidate[] {
  const byKey = new Map<string, { c: PlaceCandidate; modules: Set<string> }>();
  for (const c of all) {
    // 지점명이 없는 후보는 같은 상호의 지점 있는 후보와 합칩니다.
    const exact = nameKey(c.name, c.branch);
    const loose = nameKey(c.name);
    let key = byKey.has(exact) ? exact : null;
    if (!key) {
      for (const [k, v] of byKey) {
        if (nameKey(v.c.name) === loose && (!c.branch || !v.c.branch)) {
          key = k;
          break;
        }
      }
    }
    if (!key) {
      byKey.set(exact, { c: { ...c }, modules: new Set([c.module]) });
      continue;
    }
    const cur = byKey.get(key)!;
    cur.modules.add(c.module);
    const a = cur.c;
    const keepNew = c.confidence > a.confidence;
    cur.c = {
      name: a.name,
      branch: a.branch ?? c.branch,
      address: a.address ?? c.address,
      areaHint: a.areaHint ?? c.areaHint,
      category: a.category ?? c.category,
      confidence: Math.max(a.confidence, c.confidence),
      evidence: keepNew ? c.evidence : a.evidence,
      module: keepNew ? c.module : a.module,
    };
  }
  return [...byKey.values()]
    .map(({ c, modules }) =>
      modules.size > 1 ? { ...c, confidence: Math.min(1, c.confidence + 0.1) } : c,
    )
    .sort((x, y) => y.confidence - x.confidence);
}
