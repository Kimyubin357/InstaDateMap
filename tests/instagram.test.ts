import { describe, expect, it } from "vitest";
import {
  captionFromOgDescription,
  detectMediaType,
  locationTagFromHtml,
  metaContent,
  normalizeInstagramUrl,
} from "@/lib/instagram";
import { firstUrl } from "@/lib/pipeline";

describe("인스타 링크 정리", () => {
  it("추적 파라미터를 떼고 정규 URL로", () => {
    expect(normalizeInstagramUrl("https://www.instagram.com/reel/C9abc_12-x/?igsh=MTZ3dW")).toBe(
      "https://www.instagram.com/reel/C9abc_12-x/",
    );
    expect(normalizeInstagramUrl("https://instagram.com/reels/XYZ123")).toBe("https://www.instagram.com/reel/XYZ123/");
    expect(normalizeInstagramUrl("https://www.instagram.com/someone/p/ABC/")).toBe("https://www.instagram.com/p/ABC/");
    expect(normalizeInstagramUrl("https://example.com/p/ABC/")).toBeNull();
    expect(normalizeInstagramUrl("https://www.instagram.com/someone/")).toBeNull();
  });
  it("게시물 유형 판별", () => {
    expect(detectMediaType("https://www.instagram.com/reel/A/")).toBe("reel");
    expect(detectMediaType("https://www.instagram.com/p/A/")).toBe("post");
  });
  it("공유 텍스트에서 첫 링크 꺼내기", () => {
    expect(firstUrl("이거 봐 https://www.instagram.com/p/ABC/?igsh=1 가자")).toBe("https://www.instagram.com/p/ABC/?igsh=1");
  });
});

describe("캡션 수집 파싱", () => {
  const html = `<html><head>
    <meta property="og:title" content="cafe_lover on Instagram" />
    <meta property="og:description" content="좋아요 1,234개, 댓글 56개 - cafe_lover님, 2025년 3월 1일: &quot;📍성수 카페 어니언 성수점&#10;주소: 서울 성동구 아차산로9길 8&quot;." />
    </head><body><script>{"location":{"id":"123","has_public_page":true,"name":"\\uc5b4\\ub2c8\\uc5b8 \\uc131\\uc218"}}</script></body></html>`;

  it("og:description에서 캡션만", () => {
    const desc = metaContent(html, "og:description")!;
    const cap = captionFromOgDescription(desc);
    expect(cap).toContain("📍성수 카페 어니언 성수점");
    expect(cap).toContain("주소: 서울 성동구");
    expect(cap.startsWith("좋아요")).toBe(false);
  });
  it("형식이 다르면 전체", () => {
    expect(captionFromOgDescription("그냥 텍스트")).toBe("그냥 텍스트");
  });
  it("위치 태그", () => {
    expect(locationTagFromHtml(html)).toBe("어니언 성수");
    expect(locationTagFromHtml("<html></html>")).toBeNull();
  });
});
