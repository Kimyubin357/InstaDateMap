import { env } from "./env";
import type { MediaType } from "./types";

const IG_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

/** 공유 링크에서 추적 파라미터를 떼고 게시물 단위의 정규 URL로 만듭니다. */
export function normalizeInstagramUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!IG_HOSTS.has(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const kind = m[1] === "reels" ? "reel" : m[1];
  return `https://www.instagram.com/${kind}/${m[2]}/`;
}

export function detectMediaType(url: string): MediaType {
  if (/\/(reel|reels|tv)\//.test(url)) return "reel";
  if (/\/p\//.test(url)) return "post";
  return "unknown";
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function metaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? decodeEntities(v) : null;
}

/**
 * og:description은 보통 `좋아요 12개, 댓글 3개 - user님, 2025년 3월 1일: "캡션"` 같은 형태입니다.
 * 따옴표 안의 캡션만 꺼내고, 형태가 다르면 전체를 돌려줍니다.
 */
export function captionFromOgDescription(desc: string): string {
  const m = desc.match(/:\s*["“]([\s\S]*)["”]\s*\.?\s*$/);
  return (m ? m[1] : desc).trim();
}

/** 페이지 HTML에 위치 태그 정보가 실려 있으면 이름을 꺼냅니다(없을 때가 많습니다). */
export function locationTagFromHtml(html: string): string | null {
  const m = html.match(/"location"\s*:\s*\{[^{}]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) || null;
  } catch {
    return m[1] || null;
  }
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export interface CaptionResult {
  caption: string | null;
  method: "og" | "oembed" | null;
  locationTag: string | null;
}

type Fetcher = typeof fetch;

/** 캡션 수집: og 메타태그 → (토큰이 있으면) oEmbed → 실패 시 null(단축어가 붙여넣기 요청) */
export async function fetchCaption(url: string, fetcher: Fetcher = fetch): Promise<CaptionResult> {
  let locationTag: string | null = null;
  try {
    const res = await fetcher(url, {
      headers: {
        "User-Agent": "DatemapPersonal/0.1 (couple's private place list)",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const html = await res.text();
      locationTag = locationTagFromHtml(html);
      const desc = metaContent(html, "og:description") || metaContent(html, "description");
      // 로그인 페이지로 튕기면 og:description이 일반 소개 문구라 걸러냅니다.
      if (desc && !/로그인|Log in|Sign up|Create an account/i.test(desc)) {
        const caption = captionFromOgDescription(desc);
        if (caption.length >= 2) return { caption, method: "og", locationTag };
      }
    }
  } catch {
    // 네트워크 실패는 다음 경로로 넘깁니다.
  }

  const token = env.oembedToken();
  if (token) {
    try {
      const api = `https://graph.facebook.com/${env.oembedVersion()}/instagram_oembed?url=${encodeURIComponent(
        url,
      )}&access_token=${encodeURIComponent(token)}`;
      const res = await fetcher(api, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const body = (await res.json()) as { html?: string };
        const text = body.html ? stripHtml(body.html) : "";
        if (text.length >= 2) return { caption: text, method: "oembed", locationTag };
      }
    } catch {
      // 아래에서 null 반환
    }
  }
  return { caption: null, method: null, locationTag };
}
