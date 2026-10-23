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
  for (const tag of html.match(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) attrs.set(m[1].toLowerCase(), m[3]);
    if ((attrs.get("property") || attrs.get("name"))?.toLowerCase() === property.toLowerCase()) {
      const content = attrs.get("content");
      if (content) return decodeEntities(content);
    }
  }
  return null;
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

/** 인스타가 로그인 없이 og 태그를 내주는 링크 미리보기 봇들의 User-Agent */
const PREVIEW_AGENTS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
];
const BROWSER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const LOGIN_WALL = /로그인|Log in|Sign up|Create an account|See Instagram photos and videos/i;

/** 임베드 페이지(/embed/captioned/)의 캡션 블록이나 JSON에서 캡션을 꺼냅니다. */
export function captionFromEmbedHtml(html: string): string | null {
  // 1) JSON 안의 캡션
  const j = html.match(/"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (j) {
    try {
      const t = JSON.parse(`"${j[1]}"`) as string;
      if (t.trim().length >= 2) return t.trim();
    } catch {
      /* 아래로 */
    }
  }
  // 2) <div class="Caption"> … </div> 블록
  const m = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/i) ||
    html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const inner = m[1].replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, "");
  const text = stripHtml(inner);
  return text.length >= 2 ? text : null;
}

function shortcodePath(url: string): string | null {
  const m = url.match(/instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function getHtml(fetcher: Fetcher, url: string, ua: string): Promise<string | null> {
  try {
    const res = await fetcher(url, {
      headers: { "User-Agent": ua, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/**
 * 캡션 수집 순서:
 * 1) 링크 미리보기 봇 UA로 게시물 페이지 → og:description
 * 2) 임베드 페이지(/embed/captioned/) → 캡션 블록
 * 3) (토큰이 있으면) oEmbed
 * 모두 실패하면 null → 링크 재분석이나 장소 직접 검색으로 이어갑니다.
 */
export async function fetchCaption(url: string, fetcher: Fetcher = fetch): Promise<CaptionResult> {
  let locationTag: string | null = null;

  for (const ua of PREVIEW_AGENTS) {
    const html = await getHtml(fetcher, url, ua);
    if (!html) continue;
    locationTag = locationTag ?? locationTagFromHtml(html);
    const desc = metaContent(html, "og:description") || metaContent(html, "description");
    if (desc && !LOGIN_WALL.test(desc)) {
      const caption = captionFromOgDescription(desc);
      if (caption.length >= 2) return { caption, method: "og", locationTag };
    }
  }

  const path = shortcodePath(url);
  if (path) {
    const html = await getHtml(fetcher, `https://www.instagram.com/${path}/embed/captioned/`, BROWSER_AGENT);
    if (html) {
      locationTag = locationTag ?? locationTagFromHtml(html);
      const caption = captionFromEmbedHtml(html);
      if (caption) return { caption, method: "og", locationTag };
    }
  }

  const token = env.oembedToken();
  if (token) {
    try {
      const api = `https://graph.facebook.com/${env.oembedVersion()}/instagram_oembed?url=${encodeURIComponent(
        url,
      )}&access_token=${encodeURIComponent(token)}`;
      const res = await fetcher(api, { signal: AbortSignal.timeout(5000) });
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
