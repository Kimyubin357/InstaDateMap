/** In-memory test adapter; SQL transaction semantics are also verified against real Postgres. */
type Row = Record<string, any>;
export const tables: Record<string, Row[]> = {};
let seq = 0;
const failures: { table: string; op: string; message: string }[] = [];
export function failNext(table: string, op: string, message = "테스트 DB 오류") { failures.push({ table, op, message }); }
const uniq: Record<string, string[]> = { sources: ["board_id", "url"], places: ["board_id", "kakao_place_id"], source_places: ["source_id", "place_id", "added_by"], place_saves: ["place_id", "added_by"], access_sessions: ["token_hash"], place_details: ["kakao_place_id"] };
/**
 * 예전 형식 세션 픽스처(user_id 없이 member_name만 있음)를 계정 세션으로 읽습니다.
 * 2026-11-24 PIN 입장을 없애 실제 코드는 계정 세션만 엽니다. API 테스트의 픽스처는 이름으로 보드를 고르던 형식이 많아서,
 * user_id = "u:" + member_name 으로 보고, 그런 세션이 있는 보드의 member_names를 board_members로 보여 줍니다.
 * 이름이 없는(이름을 고르지 않은) 예전 세션은 user_id가 없어 열리지 않습니다.
 */
const LEGACY = new WeakSet<Row>();
const AUTO = new WeakSet<Row>();
function legacyAccounts() {
  const sessions = tables.access_sessions ?? [];
  const boards = new Set<string>();
  for (const row of sessions) {
    if (!("user_id" in row) || LEGACY.has(row)) { LEGACY.add(row); row.user_id = row.member_name ? `u:${row.member_name}` : null; if (row.board_id) boards.add(row.board_id); }
  }
  if (!boards.size && !(tables.board_members ?? []).some((m) => AUTO.has(m))) return;
  const real = (tables.board_members ?? []).filter((m) => !AUTO.has(m));
  const auto = [...boards].flatMap((id) => (tables.boards?.find((b) => b.id === id)?.member_names ?? [])
    .filter((name: string) => !real.some((m) => m.board_id === id && m.member_name === name))
    .map((name: string, i: number) => { const row = { board_id: id, user_id: `u:${name}`, member_name: name, role: i === 0 ? "owner" : "member", joined_at: `2026-01-0${i + 1}` }; AUTO.add(row); return row; }));
  tables.board_members = [...real, ...auto];
}
/** 019 트리거(dm_fill_actor_id)처럼: 이름만 넣은 기록에 그 방 멤버의 계정 id를 채웁니다. */
const ACTOR: Record<string, [string, string]> = { place_saves: ["added_by", "added_by_user_id"], source_places: ["added_by", "added_by_user_id"], sources: ["shared_by", "shared_by_user_id"], place_push_events: ["added_by", "added_by_user_id"] };
function fillActor(table: string, row: Row) {
  const pair = ACTOR[table];
  if (!pair || row[pair[1]] !== undefined || typeof row[pair[0]] !== "string") return row;
  legacyAccounts();
  const boardId = table === "source_places" ? tables.sources?.find((x) => x.id === row.source_id)?.board_id : row.board_id;
  row[pair[1]] = tables.board_members?.find((m) => m.board_id === boardId && m.member_name === row[pair[0]])?.user_id ?? null;
  return row;
}
class Q {
  private filters: ((r: Row) => boolean)[] = []; private op = "select"; private patch: Row = {}; private result: Row[] | null = null;
  private failure: { message: string } | null = null; private selection = ""; private max = Infinity; private offset = 0; private sortKey = ""; private ascending = true;
  constructor(private t: string) { tables[t] ??= []; if (t === "access_sessions" || t === "board_members") legacyAccounts(); }
  private failed(op: string) { const i = failures.findIndex((f) => f.table === this.t && f.op === op); if (i >= 0) this.failure = { message: failures.splice(i, 1)[0].message }; return !!this.failure; }
  select(value = "") { this.selection = value; return this; }
  eq(k: string, v: any) { this.filters.push((r) => k.split(".").reduce((a, key) => a?.[key], r) === v); return this; }
  is(k: string, v: any) { this.filters.push((r) => k.split(".").reduce((a, key) => a?.[key], r) == v); return this; }
  not(k: string, op: string, v: any) { this.filters.push((r) => r[k] != v); return this; }
  in(k: string, vs: any[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  order(k = "", opts?: { ascending?: boolean }) { this.sortKey = k; this.ascending = opts?.ascending !== false; return this; }
  range(from: number, to: number) { this.offset = from; this.max = to - from + 1; return this; }
  limit(n: number) { this.max = n; return this; }
  update(p: Row) { this.op = "update"; this.failed("update"); this.patch = p; return this; }
  delete() { this.op = "delete"; this.failed("delete"); return this; }
  insert(input: Row | Row[]) { if (this.failed("insert")) return this; this.result = (Array.isArray(input) ? input : [input]).map((r) => { const row = fillActor(this.t, { id: `id${++seq}`, ...r }); tables[this.t].push(row); return row; }); return this; }
  upsert(input: Row | Row[], opts: { ignoreDuplicates?: boolean } = {}) {
    if (this.failed("upsert")) return this;
    const keys = this.t === "push_subscriptions" ? ["endpoint_hash", "board_id"] : uniq[this.t] || ["id"];
    this.result = (Array.isArray(input) ? input : [input]).map((r) => {
      const found = tables[this.t].find((x) => keys.every((k) => x[k] === r[k]));
      if (found) { if (!opts.ignoreDuplicates) Object.assign(found, r); return found; }
      const row = fillActor(this.t, { id: `id${++seq}`, ...(this.t === "places" ? { status: "wish", memo: null } : {}), ...r }); tables[this.t].push(row); return row;
    }); return this;
  }
  private run(): Row[] {
    if (this.failure || (this.result === null && this.op === "select" && this.failed("select"))) return [];
    if (this.result) return this.result;
    let all = tables[this.t];
    if (this.selection.includes("sources!inner")) all = all.map((r) => ({ ...r, sources: tables.sources?.find((s) => s.id === r.source_id) })).filter((r) => r.sources);
    if (this.selection.includes("places!inner")) all = all.map((r) => ({ ...r, places: tables.places?.find((p) => p.id === r.place_id) })).filter((r) => r.places);
    let rows = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.sortKey) rows = [...rows].sort((a, b) => String(a[this.sortKey] ?? "").localeCompare(String(b[this.sortKey] ?? "")) * (this.ascending ? 1 : -1));
    rows = rows.slice(this.offset, this.offset + this.max);
    if (this.op === "update") rows.forEach((r) => Object.assign(r, this.patch));
    if (this.op === "delete") {
      tables[this.t] = tables[this.t].filter((r) => !rows.includes(r));
      if (this.t === "places") for (const t of ["source_places", "place_saves"]) if (tables[t]) tables[t] = tables[t].filter((r) => !rows.some((p) => p.id === r.place_id));
    }
    return rows;
  }
  async maybeSingle() { return { data: this.run()[0] ?? null, error: this.failure }; }
  async single() { const data = this.run()[0]; return { data: data ?? null, error: this.failure ?? (data ? null : { message: "none" }) }; }
  then(resolve: (v: { data: Row[]; error: { message: string } | null }) => unknown) { return Promise.resolve({ data: this.run(), error: this.failure }).then(resolve); }
}
async function rpc(name: string, p: Row): Promise<{ data: any; error: { message: string } | null }> {
  const snapshot = structuredClone(tables);
  const check = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };
  try {
    if (name === "dm_delete_place") {
      // 017: 처음 등록한 사람만(등록한 사람이 방에 없으면 누구나). 방에서 바로 빼고 지운 사람의 기록에 남김.
      legacyAccounts();
      const me = tables.board_members?.find((m) => m.board_id === p.p_board && m.user_id === p.p_user)?.member_name;
      if (!me) throw Error("참여한 방의 장소만 지울 수 있어요.");
      const row = tables.places?.find((r) => r.id === p.p_place && r.board_id === p.p_board && !r.deleted_at);
      if (!row) return { data: { ok: true, already_deleted: true, deleted_id: p.p_place }, error: null };
      // 019: 처음 등록한 사람은 계정 id로 비교하고, id가 없는 예전 기록만 이름으로 비교합니다.
      const first = [...(tables.place_saves ?? []).filter((x) => x.place_id === row.id)].sort((a, b) => String(a.added_at ?? "").localeCompare(String(b.added_at ?? "")))[0];
      const owner = first?.added_by_user_id ? tables.board_members?.find((m) => m.board_id === p.p_board && m.user_id === first.added_by_user_id) : null;
      if (owner && owner.user_id !== p.p_user) throw Error(`${owner.member_name}님이 등록한 장소라 지울 수 없어요.`);
      if (first && !first.added_by_user_id && first.added_by !== me && tables.board_members?.some((m) => m.board_id === p.p_board && m.member_name === first.added_by)) throw Error(`${first.added_by}님이 등록한 장소라 지울 수 없어요.`);
      (tables.place_trash_log ??= []).push({ id: `log${++seq}`, user_id: p.p_user, board_id: p.p_board, place: { name: row.name }, deleted_at: new Date().toISOString() });
      check(await new Q("places").delete().eq("id", row.id));
      return { data: { ok: true, deleted_id: row.id }, error: null };
    }
    if (name === "dm_trash_place") {
      const row = tables.places?.find((r) => r.id === p.p_id && r.board_id === p.p_board);
      if (!row) return { data: p.p_action === "restore" ? { code: "PLACE_NOT_FOUND" } : { ok: true, deleted_id: p.p_id, already_deleted: true }, error: null };
      if (p.p_action === "trash") {
        const already = !!row.deleted_at;
        if (!already) check(await new Q("places").update({ deleted_at: new Date().toISOString(), deleted_by: p.p_who, memo_version: (row.memo_version ?? 0)+1 }).eq("id", row.id));
        return { data: { ok: true, deleted_id: row.id, already_deleted: already }, error: null };
      }
      if (!row.deleted_at) return { data: p.p_action === "restore" ? { ok: true, restored_id: row.id } : { code: "TRASH_CHANGED" }, error: null };
      if (row.deleted_at !== p.p_expected) return { data: { code: "TRASH_CHANGED" }, error: null };
      if (p.p_action === "restore") check(await new Q("places").update({ deleted_at: null, deleted_by: null, memo_version: (row.memo_version ?? 0)+1 }).eq("id", row.id));
      else check(await new Q("places").delete().eq("id", row.id));
      return { data: { ok: true }, error: null };
    }
    if (name === "dm_patch_place") {
      const row = tables.places?.find((r) => r.id === p.p_id && r.board_id === p.p_board);
      if (!row || row.deleted_at) return { data: { code: "PLACE_NOT_FOUND" }, error: null };
      if ("memo" in p.p_patch && p.p_expected !== (row.memo_version ?? 0)) return { data: { code: "MEMO_CONFLICT", memo: row.memo || "", memo_version: row.memo_version ?? 0, memo_updated_by: row.memo_updated_by }, error: null };
      const memo_changed = "memo" in p.p_patch && (row.memo || "") !== (p.p_patch.memo || "");
      const patch = { ...p.p_patch, ...("memo" in p.p_patch ? { memo_version: (row.memo_version ?? 0) + 1, memo_updated_by: p.p_who } : {}) };
      check(await new Q("places").update(patch).eq("id", row.id));
      return { data: { ok: true, memo_version: row.memo_version ?? 0, memo_changed }, error: null };
    }
    if (name === "dm_recover_sources") {
      for (const r of tables.sources ?? []) if (r.board_id === p.p_board && r.status === "processing" && new Date(r.work_until || new Date(r.shared_at).getTime() + 90000).getTime() <= Date.now()) Object.assign(r, { status: "needs_review", recovery_reason: "interrupted", work_owner: null, work_until: null, analysis_version: `v${++seq}` });
      return { data: null, error: null };
    }
    if (name === "dm_begin_source") {
      let r = tables.sources?.find((r) => r.board_id === p.p_board && r.url === p.p_url);
      if (!r) { const result = await new Q("sources").upsert({ board_id: p.p_board, url: p.p_url, media_type: p.p_media, shared_by: p.p_who, status: "needs_review" }).single(); check(result); r = result.data; }
      if (new Date(r.work_until).getTime() > Date.now() && (r.status === "processing" || r.work_owner !== p.p_owner)) return { data: { outcome: "busy" }, error: null };
      if (r.status === "done" && tables.source_places?.some((l) => l.source_id === r!.id)) return { data: { outcome: tables.source_places.some((l) => l.source_id === r!.id && tables.places?.some((place) => place.id === l.place_id && !place.deleted_at)) ? "duplicate" : "trashed", source: { ...r } }, error: null };
      if (new Date(r.work_until).getTime() > Date.now() && r.work_owner === p.p_owner && !p.p_retry) return { data: { outcome: "resume", source: { ...r } }, error: null };
      Object.assign(r, { status: "processing", work_owner: p.p_owner, work_until: new Date(Date.now()+90000).toISOString(), analysis_version: `v${++seq}`, recovery_reason: null });
      return { data: { outcome: "started", source: { ...r } }, error: null };
    }
    if (name === "dm_finish_analysis") {
      const r = tables.sources?.find((r) => r.board_id === p.p_board && r.id === p.p_source);
      if (!r || r.status !== "processing" || r.work_owner !== p.p_owner || r.analysis_version !== p.p_version || new Date(r.work_until).getTime() <= Date.now()) throw Error("SOURCE_STALE");
      let placeId = null;
      if (p.p_rows !== null) {
        check(await new Q("extractions").delete().eq("source_id", r.id));
        for (const row of p.p_rows) {
          const inserted = await new Q("extractions").insert({ ...row, source_id: r.id }).single(); check(inserted);
          if (p.p_auto) { const saved = await rpc("dm_save_place", { p_board: p.p_board, p_source: r.id, p_extraction: inserted.data.id, p_added_by: p.p_who, p_place: row.candidates[0] }); check(saved); placeId = saved.data; }
        }
      }
      check(await new Q("sources").update({ status: p.p_status, caption: p.p_caption, caption_method: p.p_method, location_tag: p.p_location, recovery_reason: p.p_reason, work_until: p.p_status === "done" ? null : new Date(Date.now()+90000).toISOString(), work_owner: p.p_status === "done" ? null : p.p_owner }).eq("id", r.id));
      return { data: { place_id: placeId }, error: null };
    }
    if (name === "dm_source_session") {
      check(await rpc("dm_recover_sources", p));
      const r = tables.sources?.find((r) => r.id === p.p_source && r.board_id === p.p_board);
      if (!r) return { data: { code: "SOURCE_NOT_FOUND" }, error: null };
      if (p.p_action === "release") { if (r.work_owner === p.p_owner && r.analysis_version === p.p_version && r.status !== "processing") Object.assign(r, { work_owner: null, work_until: null }); return { data: { ok: true }, error: null }; }
      if (r.status === "dismissed" && p.p_action === "dismiss") return { data: { ok: true }, error: null };
      if (r.analysis_version !== p.p_version || ["done", "dismissed"].includes(r.status)) return { data: { code: "SOURCE_STALE" }, error: null };
      if (r.status === "processing" || new Date(r.work_until).getTime() > Date.now() && r.work_owner !== p.p_owner) return { data: { code: "SOURCE_BUSY" }, error: null };
      if (p.p_action === "dismiss") Object.assign(r, { status: "dismissed", work_owner: null, work_until: null, analysis_version: `v${++seq}` });
      else Object.assign(r, { work_owner: p.p_owner, work_until: new Date(Date.now()+90000).toISOString() });
      return { data: { ok: true }, error: null };
    }
    if (name === "dm_confirm_source") {
      const r = tables.sources?.find((r) => r.board_id === p.p_board && r.id === p.p_source);
      if (!r || r.analysis_version !== p.p_version || ["processing", "done", "dismissed"].includes(r.status)) throw Error("SOURCE_STALE");
      if (r.work_owner !== p.p_owner || new Date(r.work_until).getTime() <= Date.now()) throw Error("SOURCE_BUSY");
      let n = 0;
      for (const s of p.p_selections) {
        if (!tables.extractions?.some((e) => e.id === s.extraction_id && e.source_id === r.id)) throw Error("SOURCE_STALE");
        check(await new Q("extractions").update({ excluded: !s.include }).eq("id", s.extraction_id));
        if (s.include) { check(await rpc("dm_save_place", { p_board: p.p_board, p_source: r.id, p_extraction: s.extraction_id, p_place: s.place, p_added_by: p.p_who })); n++; }
      }
      if (p.p_direct) { check(await rpc("dm_save_place", { p_board: p.p_board, p_source: r.id, p_extraction: null, p_place: p.p_direct, p_added_by: p.p_who })); n++; }
      Object.assign(r, { status: "done", work_owner: null, work_until: null }); return { data: n, error: null };
    }
    if (name === "dm_board_revision") { const result = await new Q("board_sync").eq("board_id", p.p_board).maybeSingle(); check(result); return { data: String(result.data?.revision ?? 0), error: null }; }
    if (name === "dm_save_place") {
      if (p.p_source && !tables.sources?.some((s) => s.id === p.p_source && s.board_id === p.p_board)) throw Error("이 보드의 링크가 아닙니다.");
      if (p.p_extraction && !tables.extractions?.some((e) => e.id === p.p_extraction && e.source_id === p.p_source)) throw Error("이 링크의 장소 후보가 아닙니다.");
      if (tables.places?.some((r) => r.board_id === p.p_board && r.kakao_place_id === p.p_place.kakao_place_id && r.deleted_at)) throw Error("삭제한 장소에 있어요. 설정의 삭제한 장소에서 먼저 복구해 주세요.");
      const result = await new Q("places").upsert({ board_id: p.p_board, ...p.p_place }).select().single(); check(result);
      check(await new Q("place_saves").upsert({ board_id: p.p_board, place_id: result.data.id, added_by: p.p_added_by }, { ignoreDuplicates: true }));
      if (p.p_source) check(await new Q("source_places").upsert({ source_id: p.p_source, place_id: result.data.id, extraction_id: p.p_extraction, added_by: p.p_added_by }, { ignoreDuplicates: true }));
      return { data: result.data.id, error: null };
    }
    if (name === "dm_push_board_ids") {
      const open = new Set((tables.push_deliveries ?? []).filter((d) => d.state !== "sent").map((d) => d.event_id));
      return { data: [...new Set((tables.place_push_events ?? []).filter((e) => open.has(e.id)).map((e) => e.board_id))], error: null };
    }
    // 계정 로그인: 011_accounts.sql의 dm_login과 같은 규칙(실제 SQL은 accounts-sql 테스트에서 검증)
    if (name === "dm_login") {
      for (const t of ["app_users", "user_identities", "board_members", "boards"]) tables[t] ??= [];
      const display = (String(p.p_name ?? "").trim().replace(/\s+/g, " ") || "나").slice(0, 20);
      let identity = tables.user_identities.find((i) => i.provider === p.p_provider && i.subject === p.p_subject);
      let created = false;
      if (!identity) {
        const user = { id: `u${++seq}`, display_name: display, avatar_url: p.p_avatar, last_board_id: null, name_confirmed: false };
        tables.app_users.push(user); identity = { provider: p.p_provider, subject: p.p_subject, user_id: user.id, email: p.p_email };
        tables.user_identities.push(identity); created = true;
        // 012: 첫 로그인만 "내 장소"를 만듭니다.
        const board = { id: `b${++seq}`, name: "내 장소", owner_id: user.id, is_personal: true, member_names: [user.display_name], auth_version: 0, pin_hash: null, color: "red", icon: "heart" };
        tables.boards.push(board); tables.board_members.push({ board_id: board.id, user_id: user.id, role: "owner", member_name: user.display_name, joined_at: new Date(Date.now() + seq).toISOString() });
      }
      const user = tables.app_users.find((u) => u.id === identity!.user_id)!;
      const mine = tables.board_members.filter((m) => m.user_id === user.id);
      const member = mine.find((m) => m.board_id === user.last_board_id) ?? mine[0];
      user.last_board_id = member?.board_id ?? null;
      const board = member && tables.boards.find((b) => b.id === member.board_id)!;
      return { data: { user_id: user.id, board_id: board?.id ?? null, member_name: member?.member_name ?? null, auth_version: board?.auth_version ?? 0, created, name_confirmed: user.name_confirmed !== false }, error: null };
    }
    if (name === "dm_link_member") {
      tables.board_members ??= [];
      const b = tables.boards.find((x) => x.id === p.p_board);
      if (!b?.pin_hash) return { data: null, error: { message: "연결할 수 있는 지도가 아니에요.", code: "P0001" } as any };
      if (!b.member_names.includes(p.p_name)) return { data: null, error: { message: "이 지도의 이름 중에서 골라 주세요.", code: "P0001" } as any };
      const taken = tables.board_members.find((m) => m.board_id === b.id && m.member_name === p.p_name && m.user_id !== p.p_user);
      if (taken) return { data: null, error: { message: "이 이름은 이미 다른 계정에 연결되어 있어요.", code: "P0001" } as any };
      if (!tables.board_members.some((m) => m.board_id === b.id && m.user_id === p.p_user)) tables.board_members.push({ board_id: b.id, user_id: p.p_user, role: "member", member_name: p.p_name, joined_at: new Date().toISOString() });
      const user = tables.app_users?.find((u) => u.id === p.p_user); if (user) user.last_board_id = b.id;
      return { data: { board_id: b.id, member_name: p.p_name, auth_version: b.auth_version }, error: null };
    }
    if (name === "dm_list_folders") {
      legacyAccounts();
      const mine = (tables.board_members ?? []).filter((m) => m.user_id === p.p_user);
      return { data: mine.map((m) => { const b = tables.boards?.find((x) => x.id === m.board_id); return { id: m.board_id, name: b?.name ?? "", role: m.role, member_name: m.member_name }; }), error: null };
    }
    throw Error("unknown RPC");
  } catch (e) { for (const k of Object.keys(tables)) delete tables[k]; Object.assign(tables, snapshot); return { data: null, error: { message: e instanceof Error ? e.message : "error" } }; }
}
export const fakeDb = { from: (t: string) => new Q(t), rpc };
/** 예전 형식 세션 픽스처를 미리 계정 세션으로 바꿉니다(테이블 전체를 비교하는 테스트가 비교 전에 부릅니다). */
export function normalizeSessions() { legacyAccounts(); }
export function reset() { seq = 0; failures.length = 0; for (const k of Object.keys(tables)) delete tables[k]; }
