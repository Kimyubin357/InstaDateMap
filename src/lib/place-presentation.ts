import type { PlaceView } from "./place-view";

/** Kakao's group names and older detailed category paths share one presentation. */
export function categoryIcon(category: string | null | undefined) {
  const value = category?.trim() || "";
  if (/카페|커피|디저트|찻집/.test(value)) return "cup";
  if (/음식|식당|한식|중식|일식|양식|분식|술집|주점|제과|베이커리/.test(value)) return "food";
  if (/숙박|호텔|모텔|펜션|리조트|게스트하우스/.test(value)) return "bed";
  if (/문화|박물관|미술관|공연|영화|극장|전시/.test(value)) return "culture";
  if (/관광|공원|수목원|해수욕장|자연|명소/.test(value)) return "tree";
  if (/쇼핑|백화점|마트|시장|상점/.test(value)) return "bag";
  if (/레저|스포츠|체육|운동/.test(value)) return "activity";
  return "pin";
}

export function placeCopyContent(place: Pick<PlaceView, "address" | "name">) {
  const address = place.address?.trim();
  return address ? { text: address, label: "주소", object: "주소를" } : { text: place.name, label: "장소명", object: "장소명을" };
}
