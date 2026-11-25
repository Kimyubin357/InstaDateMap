import { createHash } from "node:crypto";
import { db } from "./db";
import { listFolders } from "./folders-server";
import { boardRevision } from "./sync-server";
import { shapePlaces, type PlaceLink, type PlaceSave } from "./places-server";
import type { Member } from "./people";
import type { AllPlace, RoomSummary } from "./rooms";

const PLACE_COLUMNS = "id, board_id, name, address, lat, lng, category, kakao_place_id, kakao_url, status, memo, memo_version, created_at";
const failed = (where: string, error: { code?: string; message: string }) => {
  console.error(`${where} failed`, error.code, error.message);
  return new Error("방 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
};

/** 내 방 목록 + 방마다 모음 수·지금 멤버(계정 id·이름). 방 버튼·내 방 시트·리스트 [방] 칸이 씁니다. */
export async function roomSummaries(userId: string): Promise<{ rooms: RoomSummary[]; members: Map<string, Member[]> }> {
  const folders = await listFolders(userId);
  const ids = folders.map((f) => f.id);
  if (!ids.length) return { rooms: [], members: new Map() };
  const [memberResult, collectionResult] = await Promise.all([
    db().from("board_members").select("board_id, user_id, member_name, joined_at").in("board_id", ids).order("joined_at"),
    db().from("collections").select("id, board_id").in("board_id", ids),
  ]);
  if (memberResult.error) throw failed("roomSummaries: members", memberResult.error);
  if (collectionResult.error) throw failed("roomSummaries: collections", collectionResult.error);
  const members = new Map<string, Member[]>();
  for (const m of memberResult.data ?? []) {
    const list = members.get(m.board_id) ?? []; list.push({ userId: m.user_id, name: m.member_name }); members.set(m.board_id, list);
  }
  // 멤버 얼굴(방 카드·장소 리스트의 "누가 저장"): 프로필 사진. 직접 올린 사진은 256px라 작습니다(방당 최대 8명).
  const faceIds = [...new Set([...members.values()].flatMap((list) => list.map((m) => m.userId)).filter(Boolean))];
  const avatars = new Map<string, string | null>();
  if (faceIds.length) {
    const users = await db().from("app_users").select("id, avatar_url").in("id", faceIds);
    if (users.error) console.error("roomSummaries: avatars failed", users.error.code, users.error.message);
    for (const u of users.data ?? []) avatars.set(u.id, u.avatar_url ?? null);
  }
  const collections = new Map<string, number>();
  for (const c of collectionResult.data ?? []) collections.set(c.board_id, (collections.get(c.board_id) ?? 0) + 1);
  return {
    members,
    rooms: folders.map((f) => ({ ...f, collection_count: collections.get(f.id) ?? 0,
      member_ids: (members.get(f.id) ?? []).map((m) => m.userId), member_names: (members.get(f.id) ?? []).map((m) => m.name),
      member_avatars: (members.get(f.id) ?? []).map((m) => (m.userId && avatars.get(m.userId)) || null) })),
  };
}

/** 전체 보기의 변경 표시: 방 목록(이름·색·수)과 방마다의 변경 번호가 같으면 같은 응답입니다. */
export async function allPlacesEtag(userId: string, rooms: readonly RoomSummary[]) {
  const revisions = await Promise.all(rooms.map((r) => boardRevision(r.id)));
  const hash = createHash("sha256").update(JSON.stringify([userId, rooms, revisions])).digest("base64url").slice(0, 32);
  return `"all1:${hash}"`;
}

/**
 * 내가 들어간 모든 방의 장소. 방마다 한 방 조회(/api/places)와 같은 질의를 따로 보내 같은 규칙으로 만듭니다(방은 10개까지).
 * 저장한 사람 이름은 그 장소가 있는 방의 지금 멤버 이름을 씁니다.
 */
export async function allRoomPlaces(rooms: readonly RoomSummary[], members: Map<string, Member[]>): Promise<AllPlace[]> {
  const perRoom = await Promise.all(rooms.map(async (room) => {
    const [placeResult, linkResult, saveResult] = await Promise.all([
      db().from("places").select(PLACE_COLUMNS).is("deleted_at", null).eq("board_id", room.id).order("created_at", { ascending: false }),
      db().from("source_places").select("place_id, added_by, added_by_user_id, added_at, sources!inner(id, url, media_type, board_id)").eq("sources.board_id", room.id),
      db().from("place_saves").select("place_id, added_by, added_by_user_id, added_at").eq("board_id", room.id),
    ]);
    const error = [placeResult, linkResult, saveResult].find((r) => r.error)?.error;
    if (error) throw failed("allRoomPlaces", error);
    const roomMembers = members.get(room.id) ?? [];
    return shapePlaces((placeResult.data ?? []) as unknown as Omit<AllPlace, "sharers" | "sources" | "last_saved_at">[], (linkResult.data ?? []) as unknown as PlaceLink[], (saveResult.data ?? []) as PlaceSave[], () => roomMembers);
  }));
  return perRoom.flat() as unknown as AllPlace[];
}
