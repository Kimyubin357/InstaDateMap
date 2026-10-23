/** In-memory test adapter; SQL transaction semantics are also verified against real Postgres. */
type Row = Record<string, any>;
export const tables: Record<string, Row[]> = {};
let seq = 0;
const failures: { table: string; op: string; message: string }[] = [];
export function failNext(table: string, op: string, message = "테스트 DB 오류") { failures.push({ table, op, message }); }
const uniq: Record<string, string[]> = { sources: ["board_id", "url"], places: ["board_id", "kakao_place_id"], source_places: ["source_id", "place_id", "added_by"], place_saves: ["place_id", "added_by"], access_sessions: ["token_hash"] };
class Q {
  private filters: ((r: Row) => boolean)[] = []; private op = "select"; private patch: Row = {}; private result: Row[] | null = null;
  private failure: { message: string } | null = null; private selection = ""; private max = Infinity; private sortKey = ""; private ascending = true;
  constructor(private t: string) { tables[t] ??= []; }
  private failed(op: string) { const i = failures.findIndex((f) => f.table === this.t && f.op === op); if (i >= 0) this.failure = { message: failures.splice(i, 1)[0].message }; return !!this.failure; }
  select(value = "") { this.selection = value; return this; }
  eq(k: string, v: any) { this.filters.push((r) => k.split(".").reduce((a, key) => a?.[key], r) === v); return this; }
  in(k: string, vs: any[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  order(k = "", opts?: { ascending?: boolean }) { this.sortKey = k; this.ascending = opts?.ascending !== false; return this; }
  limit(n: number) { this.max = n; return this; }
  update(p: Row) { this.op = "update"; this.failed("update"); this.patch = p; return this; }
  delete() { this.op = "delete"; this.failed("delete"); return this; }
  insert(input: Row | Row[]) { if (this.failed("insert")) return this; this.result = (Array.isArray(input) ? input : [input]).map((r) => { const row = { id: `id${++seq}`, ...r }; tables[this.t].push(row); return row; }); return this; }
  upsert(input: Row | Row[], opts: { ignoreDuplicates?: boolean } = {}) {
    if (this.failed("upsert")) return this;
    const keys = this.t === "push_subscriptions" ? ["endpoint_hash"] : uniq[this.t] || ["id"];
    this.result = (Array.isArray(input) ? input : [input]).map((r) => {
      const found = tables[this.t].find((x) => keys.every((k) => x[k] === r[k]));
      if (found) { if (!opts.ignoreDuplicates) Object.assign(found, r); return found; }
      const row = { id: `id${++seq}`, ...(this.t === "places" ? { status: "wish", memo: null } : {}), ...r }; tables[this.t].push(row); return row;
    }); return this;
  }
  private run(): Row[] {
    if (this.failure || (this.result === null && this.op === "select" && this.failed("select"))) return [];
    if (this.result) return this.result;
    let all = tables[this.t];
    if (this.selection.includes("sources!inner")) all = all.map((r) => ({ ...r, sources: tables.sources?.find((s) => s.id === r.source_id) })).filter((r) => r.sources);
    let rows = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.sortKey) rows = [...rows].sort((a, b) => String(a[this.sortKey] ?? "").localeCompare(String(b[this.sortKey] ?? "")) * (this.ascending ? 1 : -1));
    rows = rows.slice(0, this.max);
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
    if (name === "dm_board_revision") { const result = await new Q("board_sync").eq("board_id", p.p_board).maybeSingle(); check(result); return { data: String(result.data?.revision ?? 0), error: null }; }
    if (name === "dm_save_place") {
      if (p.p_source && !tables.sources?.some((s) => s.id === p.p_source && s.board_id === p.p_board)) throw Error("이 보드의 링크가 아닙니다.");
      if (p.p_extraction && !tables.extractions?.some((e) => e.id === p.p_extraction && e.source_id === p.p_source)) throw Error("이 링크의 장소 후보가 아닙니다.");
      const result = await new Q("places").upsert({ board_id: p.p_board, ...p.p_place }).select().single(); check(result);
      check(await new Q("place_saves").upsert({ board_id: p.p_board, place_id: result.data.id, added_by: p.p_added_by }, { ignoreDuplicates: true }));
      if (p.p_source) check(await new Q("source_places").upsert({ source_id: p.p_source, place_id: result.data.id, extraction_id: p.p_extraction, added_by: p.p_added_by }, { ignoreDuplicates: true }));
      return { data: result.data.id, error: null };
    }
    if (name === "dm_configure_access") {
      const b = tables.boards.find((b) => b.id === p.p_board); const s = tables.access_sessions?.find((s) => s.token_hash === p.p_session);
      if (!b || !s || s.auth_version !== b.auth_version || new Date(s.expires_at).getTime() <= Date.now()) throw Error("expired");
      if (p.p_expected_hash === null ? !!b.pin_hash || s.purpose !== "setup" : b.pin_hash !== p.p_expected_hash || s.purpose !== "member") throw Error("invalid");
      b.pin_hash = p.p_pin_hash; b.member_names = p.p_names; b.auth_version++; b.token = "revoked";
      tables.access_sessions = [{ token_hash: p.p_new_session, board_id: b.id, purpose: "member", member_name: s.member_name, auth_version: b.auth_version, remember: p.p_remember, expires_at: p.p_expires }];
      return { data: null, error: null };
    }
    if (name === "dm_reserve_attempt") return { data: 0, error: null };
    if (name === "dm_clear_attempt") return { data: null, error: null };
    throw Error("unknown RPC");
  } catch (e) { for (const k of Object.keys(tables)) delete tables[k]; Object.assign(tables, snapshot); return { data: null, error: { message: e instanceof Error ? e.message : "error" } }; }
}
export const fakeDb = { from: (t: string) => new Q(t), rpc };
export function reset() { seq = 0; failures.length = 0; for (const k of Object.keys(tables)) delete tables[k]; }
