/**
 * "누가"를 보여 주는 규칙(019, 2026-11-25 사용자 결정: 프로필에서 이름을 바꾸면 앱 어디서나 새 이름).
 * 기록에는 그때의 이름과 계정 id가 함께 있습니다. 보여 줄 때는 id로 지금 이 방 멤버의 이름을 찾고,
 * 멤버가 아니면(나갔거나 탈퇴, id 없는 예전 기록) 기록된 이름을 씁니다. DB의 dm_member_name과 같은 기준입니다.
 */
export interface Member { userId: string; name: string }

export function actorName(members: readonly Member[], userId: string | null | undefined, recorded: string) {
  return (userId && members.find((m) => m.userId === userId)?.name) || recorded;
}

/** 같은 사람 판단: id가 있으면 id, 없으면(예전 기록) 이름. */
const actorKey = (userId: string | null | undefined, recorded: string) => userId ? `u:${userId}` : `n:${recorded}`;

export interface SaveRecord { added_by: string; added_by_user_id?: string | null; added_at?: string }

/**
 * 장소 하나의 저장 기록(원본 연결 + 저장)에서 저장한 사람들(지금 이름, 같은 사람은 한 번)과
 * 처음 등록한 사람(가장 이른 기록, DB의 dm_place_first_saver와 같은 기준)을 고릅니다.
 */
export function placePeople(records: readonly SaveRecord[], members: readonly Member[]) {
  const sharers = new Map<string, string>();
  let first: SaveRecord | null = null;
  for (const r of records) {
    const key = actorKey(r.added_by_user_id, r.added_by);
    if (!sharers.has(key)) sharers.set(key, actorName(members, r.added_by_user_id, r.added_by));
    if (r.added_at && (!first?.added_at || r.added_at < first.added_at)) first = r;
  }
  return {
    sharers: [...sharers.values()],
    registrant: first ? actorName(members, first.added_by_user_id, first.added_by) : null,
    registrant_id: first?.added_by_user_id ?? null,
  };
}
