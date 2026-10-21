/** 테스트용 아주 작은 인메모리 Supabase 흉내 (pipeline이 쓰는 메서드만) */
type Row = Record<string, any>;
export const tables: Record<string, Row[]> = {};
let seq = 0;
const failures: { table: string; op: string; message: string }[] = [];
export function failNext(table: string, op: string, message = "테스트 DB 오류") { failures.push({ table, op, message }); }
const uniq: Record<string, string[]> = {
  sources: ["board_id", "url"],
  places: ["board_id", "kakao_place_id"],
  source_places: ["source_id", "place_id", "added_by"],
};

class Q {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "update" | "delete" = "select";
  private patch: Row = {};
  private result: Row[] | null = null;
  private failure: { message: string } | null = null;
  private failed(op: string) {
    const index = failures.findIndex((f) => f.table === this.t && f.op === op);
    if (index >= 0) this.failure = { message: failures.splice(index, 1)[0].message };
    return !!this.failure;
  }
  constructor(private t: string) {
    tables[t] ??= [];
  }
  select() {
    if (this.result === null) this.op = this.op === "select" ? "select" : this.op;
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  in(k: string, vs: any[]) {
    this.filters.push((r) => vs.includes(r[k]));
    return this;
  }
  order() {
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.failed("update");
    this.patch = p;
    return this;
  }
  delete() {
    this.op = "delete";
    this.failed("delete");
    return this;
  }
  insert(rows: Row[]) {
    if (this.failed("insert")) return this;
    this.result = rows.map((r) => {
      const row = { id: `id${++seq}`, ...r };
      tables[this.t].push(row);
      return row;
    });
    return this;
  }
  upsert(input: Row | Row[], opts: { ignoreDuplicates?: boolean } = {}) {
    if (this.failed("upsert")) return this;
    const keys = uniq[this.t];
    this.result = (Array.isArray(input) ? input : [input]).map((r) => {
      const found = tables[this.t].find((x) => keys.every((k) => x[k] === r[k]));
      if (found) {
        if (!opts.ignoreDuplicates) Object.assign(found, r);
        return found;
      }
      const row = { id: `id${++seq}`, ...r };
      tables[this.t].push(row);
      return row;
    });
    return this;
  }
  private run(): Row[] {
    if (this.failure || (this.result === null && this.op === "select" && this.failed("select"))) return [];
    if (this.result) return this.result;
    const rows = tables[this.t].filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") rows.forEach((r) => Object.assign(r, this.patch));
    if (this.op === "delete") tables[this.t] = tables[this.t].filter((r) => !rows.includes(r));
    return rows;
  }
  async maybeSingle() {
    return { data: this.run()[0] ?? null, error: this.failure };
  }
  async single() {
    const d = this.run()[0];
    return { data: d ?? null, error: this.failure ?? (d ? null : { message: "none" }) };
  }
  then(res: (v: { data: Row[]; error: { message: string } | null }) => unknown) {
    return Promise.resolve({ data: this.run(), error: this.failure }).then(res);
  }
}

export const fakeDb = { from: (t: string) => new Q(t) };
export function reset() {
  seq = 0;
  failures.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
}
