/**
 * 지도 핀 안의 분류 아이콘 41가지(시안 design-lab/map-pins, 2026-11-26).
 * 네이버 지도의 분류와 모양 느낌을 따라 우리가 새로 그린 흰 면 아이콘입니다(네이버 이미지는 쓰지 않음).
 * viewBox 0 0 24 24, fill=currentColor. 선이 필요한 부분은 path에 stroke를 직접 적었습니다.
 */
export const MAP_GLYPHS = {
  restaurant: "<ellipse cx=\"8.4\" cy=\"7.6\" rx=\"2.3\" ry=\"3.2\"/><path d=\"M7.6 10.2h1.6V19.2a.8.8 0 0 1-1.6 0Z\"/><path d=\"M13.3 4.5h1.1V9h.8V4.5h1.1V9h.8V4.5h1.1v5a2.2 2.2 0 0 1-1.7 2.1v7.6a.8.8 0 0 1-1.6 0v-7.6a2.2 2.2 0 0 1-1.6-2.1Z\"/>",
  pizza: "<path d=\"M12 20.5 4.3 7.3a15.5 15.5 0 0 1 15.4 0Z M8.35 10.4a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0 -2.5 0Z M12.45 12.6a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0 -2.3 0Z M10.6 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0Z\" fill-rule=\"evenodd\"/>",
  chicken: "<path d=\"M3.8 15.2h16.4a8.2 6.4 0 0 0-16.4 0Z\"/><rect x=\"3\" y=\"16.6\" width=\"18\" height=\"1.9\" rx=\".95\"/><path d=\"M15.6 10.2 18 7.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"18.6\" cy=\"6.9\" r=\"1.35\"/>",
  fast_food: "<path d=\"M5 11a7 5.2 0 0 1 14 0Z\"/><rect x=\"4.3\" y=\"12.2\" width=\"15.4\" height=\"2.3\" rx=\"1.15\"/><path d=\"M5 15.7h14v.9a2.4 2.4 0 0 1-2.4 2.4H7.4A2.4 2.4 0 0 1 5 16.6Z\"/>",
  pub: "<rect x=\"5.6\" y=\"8.6\" width=\"9.4\" height=\"10.9\" rx=\"1.6\"/><path d=\"M15 10.6h1.8a1.8 1.8 0 0 1 1.8 1.8v2.4a1.8 1.8 0 0 1-1.8 1.8H15\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M5.2 9.4a2.3 2.3 0 0 1 2.5-3 2.7 2.7 0 0 1 4.7-.4 2.3 2.3 0 0 1 3 2.3v1.1Z\"/>",
  cafe: "<path d=\"M4.8 8h11.4v4.8a5.7 5.7 0 0 1-11.4 0Z\"/><path d=\"M16.2 9.4h1.4a2.3 2.3 0 0 1 0 4.6h-1.7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"3.8\" y=\"18.6\" width=\"13.4\" height=\"1.7\" rx=\".85\"/>",
  bakery: "<path d=\"M4.2 16.8a4 4 0 0 1 2-7.4 5.2 5.2 0 0 1 9.7-.9 4.2 4.2 0 0 1 4 8.3Z\"/><rect x=\"4.6\" y=\"17.8\" width=\"14.8\" height=\"1.6\" rx=\".8\"/>",
  ice_cream: "<circle cx=\"12\" cy=\"8.6\" r=\"4.3\"/><path d=\"M7.9 11.6h8.2L12 20.2Z\"/>",
  art_gallery: "<path d=\"M3.8 5h16.4v14H3.8Z M5.8 7v10h12.4V7Z\" fill-rule=\"evenodd\"/><path d=\"M7 16l3.4-4.6 2.6 3.1 1.9-2.1L17.2 16Z\"/><circle cx=\"15.6\" cy=\"9.4\" r=\"1.2\"/>",
  museum: "<path d=\"M12 3.6 3.6 8.2h16.8Z\"/><rect x=\"5.6\" y=\"9.6\" width=\"2.2\" height=\"7.6\"/><rect x=\"10.9\" y=\"9.6\" width=\"2.2\" height=\"7.6\"/><rect x=\"16.2\" y=\"9.6\" width=\"2.2\" height=\"7.6\"/><rect x=\"4.2\" y=\"18\" width=\"15.6\" height=\"2\" rx=\".5\"/>",
  cinema: "<rect x=\"4.4\" y=\"10.2\" width=\"15.2\" height=\"9.6\" rx=\"1.2\"/><path d=\"M4.1 8.5 18.1 5.1l.6 2.3-14 3.4Z\"/>",
  theater: "<path d=\"M5 4.8h14v6.6a7 7 0 0 1-14 0Z M7.8 8.9h2.8v1.7H7.8Z M13.4 8.9h2.8v1.7h-2.8Z M8.8 13.6c2 1.6 4.4 1.6 6.4 0l-.8-1c-1.5 1.1-3.3 1.1-4.8 0Z\" fill-rule=\"evenodd\"/>",
  music_venues: "<path d=\"M9.2 17.4V6.6l9.6-2v10.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"7\" cy=\"17.4\" r=\"2.4\"/><circle cx=\"16.6\" cy=\"15.4\" r=\"2.4\"/>",
  karaoke: "<circle cx=\"15.2\" cy=\"8.4\" r=\"4.1\"/><path d=\"M12.2 11.2 4.9 18.5l1.6 1.6 7.3-7.3Z\"/>",
  park: "<path d=\"M8.6 4 4.4 11h2.2l-2.7 4.6h3.8V20h1.8v-4.4h3.8L10.6 11h2.2Z\"/><path d=\"M16.2 7.6l-3 5h1.6L12.8 16h2.6V20h1.6v-4h2.6l-2-3.4h1.6Z\"/>",
  forest: "<circle cx=\"12\" cy=\"9\" r=\"5.6\"/><rect x=\"11.05\" y=\"13\" width=\"1.9\" height=\"7.2\" rx=\".5\"/>",
  mountain: "<path d=\"M2.8 19.2 9.4 7.8l3.6 5.6 2.1-3.1 6.1 8.9Z\"/>",
  beach: "<path d=\"M4 11.2a8 6.2 0 0 1 16 0Z\"/><path d=\"M12 11.2v6.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M3.8 19.6c1.4-1 2.8-1 4.1 0s2.8 1 4.1 0 2.8-1 4.1 0 2.8 1 4.1 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  lake: "<path d=\"M4 8.6c1.4-1 2.8-1 4.1 0s2.8 1 4.1 0 2.8-1 4.1 0 2.8 1 4.1 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M4 12.6c1.4-1 2.8-1 4.1 0s2.8 1 4.1 0 2.8-1 4.1 0 2.8 1 4.1 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M4 16.6c1.4-1 2.8-1 4.1 0s2.8 1 4.1 0 2.8-1 4.1 0 2.8 1 4.1 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  botanical_garden: "<circle cx=\"12\" cy=\"4.9\" r=\"2.3\"/><circle cx=\"15.1\" cy=\"8\" r=\"2.3\"/><circle cx=\"12\" cy=\"11.1\" r=\"2.3\"/><circle cx=\"8.9\" cy=\"8\" r=\"2.3\"/><path d=\"M12 12v8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M12 17.4c-1.2-2.4-3.3-3-5-2.6.3 2 2 3.4 5 3.4Z\"/>",
  tourist_spot: "<rect x=\"5.6\" y=\"3.6\" width=\"1.9\" height=\"16.8\" rx=\".6\"/><path d=\"M7.5 4.4h10.9l-2.6 4.1 2.6 4.1H7.5Z\"/>",
  historic_sites: "<path d=\"M2.8 9.6c3.2-.5 6.2-2.6 9.2-5.6 3 3 6 5.1 9.2 5.6v1.6H2.8Z\"/><rect x=\"5.4\" y=\"11.6\" width=\"2.1\" height=\"8.2\"/><rect x=\"16.5\" y=\"11.6\" width=\"2.1\" height=\"8.2\"/><rect x=\"5.4\" y=\"13.4\" width=\"13.2\" height=\"1.6\"/>",
  observatory: "<path d=\"M10.4 9.2h3.2l1.6 11h-6.4Z\"/><rect x=\"7.6\" y=\"6.4\" width=\"8.8\" height=\"2.4\" rx=\".6\"/><path d=\"M12 2.8l1.1 3.4h-2.2Z\"/>",
  amusement_park: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"9.8\" r=\"5.8\"/><path d=\"M12 4v11.6M6.2 9.8h11.6M7.9 5.7l8.2 8.2M16.1 5.7l-8.2 8.2M12 9.8 8.2 20M12 9.8l3.8 10.2\"/></g>",
  aquarium: "<path d=\"M3.4 12c2.6-4.1 8.2-5.6 12.2-2l4-3v10l-4-3c-4 3.6-9.6 2.1-12.2-2Z M6.6 11.4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0Z\" fill-rule=\"evenodd\"/>",
  zoo: "<ellipse cx=\"12\" cy=\"15.4\" rx=\"4.4\" ry=\"3.7\"/><circle cx=\"6.6\" cy=\"10.2\" r=\"1.9\"/><circle cx=\"9.9\" cy=\"6.9\" r=\"1.9\"/><circle cx=\"14.1\" cy=\"6.9\" r=\"1.9\"/><circle cx=\"17.4\" cy=\"10.2\" r=\"1.9\"/>",
  water_park: "<path d=\"M6.2 4.5v6.2c0 3 2.8 4.4 6 4.4h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M3.8 19.4c1.4-1 2.8-1 4.1 0s2.8 1 4.1 0 2.8-1 4.1 0 2.8 1 4.1 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"17.6\" cy=\"6.6\" r=\"1.9\"/>",
  department_store: "<path d=\"M5 9h14l-1.1 11H6.1Z\"/><path d=\"M9 9V7.6a3 3 0 0 1 6 0V9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  fashion: "<path d=\"M8.4 4 3.8 6.6l1.9 4.3 2.3-1.1V20.2h8V9.8l2.3 1.1 1.9-4.3L15.6 4a3.6 3.6 0 0 1-7.2 0Z\"/>",
  mart: "<path d=\"M3.4 10.2h17.2l-2.1 9.6H5.5Z\"/><path d=\"M7.8 10.2l3-5.4M16.2 10.2l-3-5.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  spa: "<path d=\"M3.8 13.6h16.4a8.2 5.6 0 0 1-16.4 0Z\"/><path d=\"M8.2 11c-1.3-1.5 1.3-2.8 0-4.6M12 11c-1.3-1.5 1.3-2.8 0-4.6M15.8 11c-1.3-1.5 1.3-2.8 0-4.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  swimming_pool: "<circle cx=\"16.6\" cy=\"7\" r=\"2.1\"/><path d=\"M5 12.6l4.4-3.2 2.4 2.6 2.8-1.8 1.2 1.6-4.4 2.8-2-2.1-3.2 2.3Z\"/><path d=\"M3.8 16.4c1.4-1 2.8-1 4.1 0s2.8 1 4.1 0 2.8-1 4.1 0 2.8 1 4.1 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M3.8 19.8c1.4-1 2.8-1 4.1 0s2.8 1 4.1 0 2.8-1 4.1 0 2.8 1 4.1 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  sports_center: "<rect x=\"3.2\" y=\"8.6\" width=\"2.6\" height=\"6.8\" rx=\"1\"/><rect x=\"6.2\" y=\"6.6\" width=\"2.8\" height=\"10.8\" rx=\"1\"/><rect x=\"15\" y=\"6.6\" width=\"2.8\" height=\"10.8\" rx=\"1\"/><rect x=\"18.2\" y=\"8.6\" width=\"2.6\" height=\"6.8\" rx=\"1\"/><rect x=\"9\" y=\"11\" width=\"6\" height=\"2\" rx=\".6\"/>",
  bowling: "<path d=\"M4.2 14.6a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0 -10.4 0Z M7.35 12.6a0.85 0.85 0 1 0 1.7 0a0.85 0.85 0 1 0 -1.7 0Z M9.75 12.2a0.85 0.85 0 1 0 1.7 0a0.85 0.85 0 1 0 -1.7 0Z M8.75 15a0.85 0.85 0 1 0 1.7 0a0.85 0.85 0 1 0 -1.7 0Z\" fill-rule=\"evenodd\"/><path d=\"M17.2 3.6c1.2 0 1.6 1.4 1.2 3-.3 1 .9 2.2.9 4.6 0 3.6-1.2 5.6-2.1 5.6s-2.1-2-2.1-5.6c0-2.4 1.2-3.6.9-4.6-.4-1.6 0-3 1.2-3Z\"/>",
  billiard_room: "<path d=\"M4.4 12a7.6 7.6 0 1 0 15.2 0a7.6 7.6 0 1 0 -15.2 0Z M8.8 10.6a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0Z\" fill-rule=\"evenodd\"/><text x=\"12\" y=\"12.2\" font-size=\"4.6\" text-anchor=\"middle\" font-family=\"sans-serif\" font-weight=\"700\">8</text>",
  camping: "<path d=\"M12 3.8 2.8 20h18.4Z M12 12.2l-3.6 7.8h7.2Z\" fill-rule=\"evenodd\"/>",
  hotel: "<path d=\"M3 7.6h2v4h14.4a1.6 1.6 0 0 1 1.6 1.6V19h-2v-2.2H5V19H3Z\"/><rect x=\"6.2\" y=\"8.6\" width=\"5\" height=\"2.4\" rx=\"1.2\"/>",
  accommodation: "<path d=\"M12 3.4 2.8 11.2h2.6v8.8h13.2v-8.8h2.6Z M10.2 20v-5h3.6v5Z\" fill-rule=\"evenodd\"/>",
  resort: "<rect x=\"11.1\" y=\"10\" width=\"1.8\" height=\"10\" rx=\".6\"/><path d=\"M12 10.4C10 7 6.4 6.4 4 7.6c2.6.2 5.6 1.2 8 2.8Z\"/><path d=\"M12 10.4c2-3.4 5.6-4 8-2.8-2.6.2-5.6 1.2-8 2.8Z\"/><path d=\"M12 10.4c-.6-3.2 1-5.8 3.4-6.6-1.6 1.6-2.6 4-3.4 6.6Z\"/><rect x=\"7\" y=\"19\" width=\"10\" height=\"1.6\" rx=\".8\"/>",
  studio: "<path d=\"M3.6 8.2h4l1.6-2.4h5.6l1.6 2.4h4v11.2H3.6Z M8.4 13.6a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0Z\" fill-rule=\"evenodd\"/>",
  etc: "<circle cx=\"12\" cy=\"12\" r=\"4\"/>",
} as const;
export type MapGlyph = keyof typeof MAP_GLYPHS;

/**
 * 카카오 분류(category_group_name 또는 category_name의 마지막 칸) + 가게 이름 → 아이콘.
 * 카카오가 음식점을 "음식점"으로만 주므로 피자·치킨·술집 같은 세부는 가게 이름의 분명한 낱말로 보충합니다.
 */
const BY_NAME: [RegExp, MapGlyph][] = [
  [/피자|pizza/i, "pizza"], [/치킨|통닭|닭강정/, "chicken"], [/버거|burger/i, "fast_food"],
  [/베이커리|제과|빵집|브레드|bakery|bread/i, "bakery"], [/아이스크림|젤라또|빙수|gelato/i, "ice_cream"],
  [/호프|포차|이자카야|와인바|비어|펍|pub|wine/i, "pub"],
];
const BY_CATEGORY: [RegExp, MapGlyph][] = [
  [/카페|커피|찻집|티하우스/, "cafe"], [/제과|베이커리|빵/, "bakery"], [/디저트|아이스크림|케이크|빙수/, "ice_cream"],
  [/피자/, "pizza"], [/치킨|닭강정/, "chicken"], [/햄버거|패스트푸드/, "fast_food"],
  [/술집|호프|바$|와인|이자카야|포장마차|칵테일/, "pub"],
  [/음식점|식당|한식|중식|일식|양식|분식|국밥|국수|고기|해물|아시아|뷔페|이탈리아|프랑스|베트남|태국|멕시코|돈까스|초밥|라면/, "restaurant"],
  [/미술관|갤러리|전시/, "art_gallery"], [/박물관|기념관|문화시설|과학관|도서관/, "museum"], [/영화관|시네마/, "cinema"],
  [/공연장|음악|라이브|LP/i, "music_venues"], [/극장|공연|연극/, "theater"], [/노래방|코인노래/, "karaoke"],
  [/식물원|수목원|정원/, "botanical_garden"], [/공원/, "park"], [/숲|자연휴양림/, "forest"], [/산$|등산|봉$/, "mountain"],
  [/해수욕장|해변|해안/, "beach"], [/호수|저수지|강변/, "lake"], [/전망대|타워/, "observatory"],
  [/유적|고궁|궁$|사적|성곽|한옥/, "historic_sites"], [/놀이공원|테마파크|놀이시설/, "amusement_park"],
  [/아쿠아리움|수족관/, "aquarium"], [/동물원/, "zoo"], [/워터파크/, "water_park"], [/관광|명소|테마거리|거리/, "tourist_spot"],
  [/백화점|쇼핑몰|아울렛|상가|아케이드/, "department_store"], [/의류|패션|편집숍|잡화|소품|디자인문구|문구/, "fashion"],
  [/마트|시장|편의점|슈퍼|생활용품/, "mart"], [/목욕|사우나|찜질|스파|온천/, "spa"], [/수영장/, "swimming_pool"],
  [/볼링/, "bowling"], [/당구/, "billiard_room"], [/스포츠|체육|운동|클라이밍|헬스|레저|체험|공방/, "sports_center"],
  [/캠핑|글램핑|야영/, "camping"], [/리조트/, "resort"], [/호텔/, "hotel"], [/숙박|펜션|게스트하우스|모텔|민박/, "accommodation"],
  [/사진|스튜디오|포토/, "studio"],
];
export function mapGlyph(category: string | null | undefined, name = ""): MapGlyph {
  const value = category?.trim() || "";
  const food = !value || /음식점|식당/.test(value);
  if (food) for (const [pattern, glyph] of BY_NAME) if (pattern.test(name)) return glyph;
  for (const [pattern, glyph] of BY_CATEGORY) if (pattern.test(value)) return glyph;
  return "etc";
}
/** 핀 원 안에 넣을 SVG 문자열 */
export function mapGlyphSvg(glyph: MapGlyph) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${MAP_GLYPHS[glyph]}</svg>`;
}

/** 리스트 타일 바탕색 묶음(fabric-theme.css의 .category-*). 아이콘은 지도 핀과 같은 41가지를 쓰고, 색만 8묶음으로 나눕니다. */
export type GlyphTone = "cup" | "food" | "culture" | "tree" | "activity" | "bag" | "bed" | "pin";
const TONES: Record<GlyphTone, MapGlyph[]> = {
  cup: ["cafe", "bakery", "ice_cream"],
  food: ["restaurant", "pizza", "chicken", "fast_food", "pub"],
  culture: ["art_gallery", "museum", "cinema", "theater", "music_venues", "karaoke", "studio"],
  tree: ["park", "forest", "mountain", "beach", "lake", "botanical_garden", "tourist_spot", "historic_sites", "observatory"],
  activity: ["amusement_park", "aquarium", "zoo", "water_park", "spa", "swimming_pool", "sports_center", "bowling", "billiard_room", "camping"],
  bag: ["department_store", "fashion", "mart"],
  bed: ["hotel", "accommodation", "resort"],
  pin: ["etc"],
};
const TONE_OF = new Map(Object.entries(TONES).flatMap(([tone, glyphs]) => glyphs.map((g) => [g, tone as GlyphTone])));
export function glyphTone(glyph: MapGlyph): GlyphTone { return TONE_OF.get(glyph) ?? "pin"; }
