import { describe, expect, it, beforeAll } from "vitest";
import { isConfident, keywordSearch, keywordSearchPage, resolveCandidate, scorePlace } from "@/lib/kakao";
import type { PlaceCandidate } from "@/lib/extract/types";

beforeAll(() => {
  process.env.KAKAO_REST_API_KEY = "test";
});

const doc = (id: string, name: string, addr: string, x = "127.05", y = "37.54") => ({
  id,
  place_name: name,
  address_name: addr,
  road_address_name: addr,
  category_name: "음식점 > 카페",
  category_group_name: "카페",
  x,
  y,
  place_url: `http://place.map.kakao.com/${id}`,
});

const fakeFetch = (docs: Record<string, ReturnType<typeof doc>[]>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    if (u.pathname.includes("address")) return new Response(JSON.stringify({ documents: [] }));
    const q = u.searchParams.get("query") ?? "";
    return new Response(JSON.stringify({ documents: docs[q] ?? [] }));
  }) as typeof fetch;

const cand: PlaceCandidate = {
  name: "어니언",
  branch: "성수점",
  address: null,
  areaHint: "성수",
  category: "카페",
  confidence: 0.9,
  evidence: "",
  module: "caption",
};

describe("카카오 후보 고르기", () => {
  const suwon = { kakao_place_id: "978669489", name: "도나스데이 본점", address: "경기 수원시 권선구 서수원로 174-2", lat: 37.24, lng: 126.97, category: "카페", kakao_url: "" };
  const yongin = { ...suwon, kakao_place_id: "other", address: "경기 용인시 기흥구 구성로 160" };
  const donas = { ...cand, name: "도나스데이", branch: "수원본점", areaHint: "수원", address: "경기도 수원시 권선구 서수원로 174-2 도나스데이 본점" };

  it("사용자 실패 링크: 지점 표기가 달라도 상호와 정확한 주소가 맞으면 확정", () => {
    expect(isConfident(donas, [suwon, yongin])).toBe(true);
    expect(isConfident({ ...donas, address: null }, [suwon, yongin])).toBe(false);
    expect(isConfident(donas, [yongin, suwon])).toBe(false);
    expect(isConfident(donas, [suwon, { ...suwon, kakao_place_id: "same-building" }])).toBe(false);
  });

  it("상호가 붙은 주소는 건물 번호까지 정리해서 좌표 검색", async () => {
    const queries: string[] = [];
    await resolveCandidate(donas, (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      if (u.pathname.includes("address")) queries.push(u.searchParams.get("query")!);
      return new Response(JSON.stringify({ documents: [] }));
    }) as typeof fetch);
    expect(queries).toEqual(["경기도 수원시 권선구 서수원로 174-2"]);
  });

  it("카카오 인증 실패를 검색 결과 없음으로 숨기지 않음", async () => {
    await expect(keywordSearch("카페", (async () => new Response("{}", { status: 401 })) as typeof fetch)).rejects.toThrow("401");
  });
  it("지점까지 맞는 곳이 1등, 이름이 전혀 다른 결과는 버림", async () => {
    const places = await resolveCandidate(
      cand,
      fakeFetch({
        "성수 어니언 성수점": [
          doc("2", "어니언 안국", "서울 종로구 계동길 5"),
          doc("1", "어니언 성수", "서울 성동구 아차산로9길 8"),
          doc("9", "성수 순대국", "서울 성동구 성수이로 1"),
        ],
      }),
    );
    expect(places.map((p) => p.kakao_place_id)).toEqual(["1", "2"]);
  });

  it("후보가 하나뿐이면 자동 확정", () => {
    const one = [{ kakao_place_id: "1", name: "어니언 성수", address: "서울 성동구", lat: 0, lng: 0, category: "카페", kakao_url: "" }];
    expect(isConfident(cand, one)).toBe(true);
  });

  it("체인점 후보가 비슷하면 사람에게 물음", () => {
    const two = [
      { kakao_place_id: "1", name: "블루보틀 성수", address: "서울 성동구", lat: 0, lng: 0, category: "카페", kakao_url: "" },
      { kakao_place_id: "2", name: "블루보틀 삼청", address: "서울 종로구", lat: 0, lng: 0, category: "카페", kakao_url: "" },
    ];
    expect(isConfident({ ...cand, name: "블루보틀", branch: null, areaHint: null }, two)).toBe(false);
  });

  it("점수: 지역 힌트가 주소에 있으면 가산", () => {
    const p = { kakao_place_id: "1", name: "어니언", address: "서울 성동구 성수동", lat: 0, lng: 0, category: "", kakao_url: "" };
    expect(scorePlace(p, cand)).toBeGreaterThan(scorePlace({ ...p, address: "서울 종로구" }, cand));
  });
});

it("interactive search requests a stable page size and keeps the last-page flag", async () => {
  let requested: URL | undefined;
  const fetcher: typeof fetch = async (input) => { requested = new URL(String(input)); return Response.json({ documents: [doc("p2", "두 번째 페이지", "서울")], meta: { is_end: false, total_count: 24 } }); };
  expect(await keywordSearchPage("식당", 2, fetcher)).toMatchObject({ page: 2, is_end: false, total_count: 24, places: [{ kakao_place_id: "p2" }] });
  expect(requested?.searchParams.get("page")).toBe("2"); expect(requested?.searchParams.get("size")).toBe("8");
  expect((await keywordSearchPage("식당", 45, fetcher)).is_end).toBe(true);
});
