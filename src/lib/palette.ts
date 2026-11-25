/**
 * 방·모음이 함께 쓰는 잉크색 10가지(2026-11-25 사용자 확정, design-lab/room-look).
 * 키는 DB(018_room_look.sql)와 같고, 화면 색은 globals.css의 --palette-<키> 토큰을 씁니다.
 */
export const PALETTE_COLORS = ["red", "orange", "gold", "olive", "forest", "teal", "blue", "navy", "plum", "taupe"] as const;
export type PaletteColor = typeof PALETTE_COLORS[number];
export const PALETTE_LABEL: Record<PaletteColor, string> = {
  red: "빨강", orange: "주황", gold: "겨자", olive: "올리브", forest: "초록",
  teal: "청록", blue: "파랑", navy: "남색", plum: "자두", taupe: "흙색",
};
export const isPaletteColor = (value: unknown): value is PaletteColor => PALETTE_COLORS.includes(value as PaletteColor);
/** CSS 변수 이름. 모르는 값이면 빨강으로 그립니다. */
export const paletteVar = (color?: string | null) => `var(--palette-${isPaletteColor(color) ? color : "red"})`;

/** 018 이전에 만든 모음의 선 아이콘 키. 018이 이모지로 바꾸지만, 그 전 데이터도 같은 이모지로 보여 줍니다. */
export const LEGACY_COLLECTION_ICONS = { heart: "💞", map: "🗺️", cup: "☕", food: "🍜", tree: "🌿", culture: "🎨" } as const;
export type LegacyCollectionIcon = keyof typeof LEGACY_COLLECTION_ICONS;
const isLegacyIcon = (value: unknown): value is LegacyCollectionIcon => typeof value === "string" && Object.hasOwn(LEGACY_COLLECTION_ICONS, value);

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
function graphemes(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) return Array.from(new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(value), (s) => s.segment);
  return Array.from(value);
}
/** 이모지 하나(한 글자로 보이는 묶음)인지. 글자·공백·여러 개는 거절합니다. DB는 16자까지 받습니다. */
export function isSingleEmoji(value: unknown): value is string {
  if (typeof value !== "string" || !value || Array.from(value).length > 16 || /[\s\p{L}\p{N}<>"'&\\/]/u.test(value.replace(/[0-9#*]\uFE0F?\u20E3/gu, ""))) return false;
  return graphemes(value).length === 1 && PICTOGRAPH.test(value);
}
/** 모음 표지로 받을 수 있는 값: 이모지 하나, 또는 예전 선 아이콘 키 */
export const isCollectionIcon = (value: unknown): value is string => isLegacyIcon(value) || isSingleEmoji(value);
/** 화면에 그릴 이모지 */
export const collectionEmoji = (icon?: string | null) => isLegacyIcon(icon) ? LEGACY_COLLECTION_ICONS[icon] : icon || LEGACY_COLLECTION_ICONS.heart;
/** 입력칸에서 마지막 이모지 하나만 남깁니다(없으면 null). */
export function lastEmoji(value: string): string | null {
  const found = graphemes(value).filter(isSingleEmoji);
  return found.at(-1) ?? null;
}

/** 같은 방의 다른 모음과 색·이모지가 겹치면 회색 한 줄로만 알립니다(막지 않음). 둘 다 같은 모음을 먼저 봅니다. */
export function duplicateNote(editor: { id: string; icon: string }, collections: readonly { id: string; name: string; icon: string }[]) {
  // 모음은 색 없이 이모지로만 구분합니다(방·모음 구분 A안, 2026-11-25: 색은 방에만). 같은 방에서 이모지가 겹칠 때만 알립니다.
  const emoji = collectionEmoji(editor.icon);
  const same = collections.find((c) => c.id !== editor.id && collectionEmoji(c.icon) === emoji);
  return same ? `‘${same.name}’ 모음도 이 이모지(${emoji})를 써요.` : "";
}
