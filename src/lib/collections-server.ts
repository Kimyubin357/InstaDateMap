import { db } from "./db";
/** PostgREST caps rows per request; a place can belong to many collections. */
export async function collectionMemberships(boardId: string) {
  const rows: { collection_id: string; place_id: string }[] = [];
  const size = 1000;
  for (let start = 0; ; start += size) {
    const { data, error } = await db().from("collection_places").select("id,collection_id,place_id").eq("board_id", boardId).order("id").range(start, start + size - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < size) return { data: rows, error: null };
  }
}
