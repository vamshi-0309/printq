/**
 * An in-memory stand-in for the slice of PostgREST this app uses.
 *
 * Not a test file (no .test.ts), so vitest only loads it when a test imports
 * it. Each request is applied in full at the moment it is awaited, exactly
 * like the real client, which sends one HTTP request per terminal call. That
 * is what makes compare-and-swap writes meaningful here: two concurrent
 * `update(...).eq("state", "QUEUED")` calls are applied one after the other,
 * and the second matches nothing.
 *
 * Supported: select (with `x!inner(...)`/`x(...)` to-one embeds and
 * count/head), insert, update, upsert, delete; eq, neq, in, is, lt, lte, gt,
 * gte, not(col, "in", "(a,b)"), order, limit; single, maybeSingle; rpc.
 * Column lists are not projected — rows come back whole.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface FakeDbOptions {
  /** table → list of column groups that must be unique, e.g. [["shop_id","idempotency_key"]] */
  unique?: Record<string, string[][]>;
  rpc?: Record<string, (args: Record<string, unknown>, db: FakeDb) => unknown>;
}

let idCounter = 0;
export function fakeUuid(): string {
  idCounter += 1;
  const hex = idCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

/** Monotonic timestamps so "oldest first" is deterministic within a test. */
let clock = Date.parse("2026-10-01T09:00:00Z");
function nextTimestamp(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

const DEFAULT_UNIQUE: Record<string, string[][]> = {
  payments: [["cashfree_order_id"]],
  orders: [["shop_id", "idempotency_key"]],
  print_attempts: [["print_job_id", "attempt_number"]],
  printers: [["shop_id", "system_name"]],
};

export class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcHandlers: NonNullable<FakeDbOptions["rpc"]>;
  unique: Record<string, string[][]>;
  /** Every write, in order, for assertions about what a route touched. */
  log: { table: string; op: string; rows: Row[] }[] = [];

  constructor(seed: Record<string, Row[]> = {}, opts: FakeDbOptions = {}) {
    for (const [t, rows] of Object.entries(seed)) {
      this.tables[t] = rows.map((r) => ({ ...r }));
    }
    this.rpcHandlers = opts.rpc ?? {};
    this.unique = { ...DEFAULT_UNIQUE, ...(opts.unique ?? {}) };
  }

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  rows(name: string, where: Row = {}): Row[] {
    return this.table(name).filter((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v)
    );
  }

  one(name: string, where: Row = {}): Row {
    const found = this.rows(name, where);
    if (found.length !== 1) {
      throw new Error(`expected one ${name} row matching ${JSON.stringify(where)}, found ${found.length}`);
    }
    return found[0];
  }

  from(name: string) {
    return new Query(this, name);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    const handler = this.rpcHandlers[name];
    if (!handler) return { data: null, error: { message: `rpc ${name} not faked` } };
    try {
      return { data: await handler(args, this), error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  /** Throws a Postgres-style unique violation when `row` collides. */
  checkUnique(name: string, row: Row, ignore?: Row) {
    for (const cols of this.unique[name] ?? []) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      const clash = this.table(name).find(
        (other) => other !== ignore && cols.every((c) => other[c] === row[c])
      );
      if (clash) {
        const err = new Error(`duplicate key value violates unique constraint on ${name}(${cols.join(",")})`);
        (err as Error & { code: string }).code = "23505";
        throw err;
      }
    }
  }
}

interface Embed {
  table: string;
  alias: string;
  inner: boolean;
}

class Query {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private embedFilters: { alias: string; test: Filter }[] = [];
  private embeds: Embed[] = [];
  private payload: Row | Row[] | null = null;
  private upsertConflict: string[] = [];
  private orderBy: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private countMode = false;
  private headMode = false;
  private returning = false;
  private singleMode: "single" | "maybe" | null = null;

  constructor(private db: FakeDb, private name: string) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") {
      this.returning = true;
    } else if (cols) {
      for (const m of cols.matchAll(/(\w+)(!inner)?\s*\(/g)) {
        this.embeds.push({ table: m[1], alias: m[1], inner: Boolean(m[2]) });
      }
    }
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.headMode = true;
    return this;
  }

  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }

  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }

  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = rows;
    this.upsertConflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  private addFilter(col: string, test: (v: unknown) => boolean) {
    const dot = col.indexOf(".");
    if (dot > 0) {
      const alias = col.slice(0, dot);
      const field = col.slice(dot + 1);
      this.embedFilters.push({ alias, test: (r) => test(r[field]) });
    } else {
      this.filters.push((r) => test(r[col]));
    }
    return this;
  }

  eq(col: string, v: unknown) {
    return this.addFilter(col, (x) => x === v);
  }
  neq(col: string, v: unknown) {
    return this.addFilter(col, (x) => x !== v);
  }
  in(col: string, vs: unknown[]) {
    return this.addFilter(col, (x) => vs.includes(x));
  }
  is(col: string, v: unknown) {
    return this.addFilter(col, (x) => (v === null ? x === null || x === undefined : x === v));
  }
  lt(col: string, v: unknown) {
    return this.addFilter(col, (x) => x != null && cmp(x, v) < 0);
  }
  lte(col: string, v: unknown) {
    return this.addFilter(col, (x) => x != null && cmp(x, v) <= 0);
  }
  gt(col: string, v: unknown) {
    return this.addFilter(col, (x) => x != null && cmp(x, v) > 0);
  }
  gte(col: string, v: unknown) {
    return this.addFilter(col, (x) => x != null && cmp(x, v) >= 0);
  }
  not(col: string, operator: string, value: string) {
    if (operator !== "in") throw new Error(`fake not(${operator}) unsupported`);
    const vs = value.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim());
    return this.addFilter(col, (x) => !vs.includes(String(x)));
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this.execute();
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this.execute();
  }

  then<T1, T2>(
    onFulfilled?: (v: { data: unknown; error: unknown; count?: number | null }) => T1,
    onRejected?: (e: unknown) => T2
  ) {
    return this.execute().then(onFulfilled, onRejected);
  }

  private matches(row: Row): boolean {
    if (!this.filters.every((f) => f(row))) return false;
    for (const e of this.embeds) {
      const child = this.embedFor(row, e);
      const own = this.embedFilters.filter((f) => f.alias === e.alias);
      if (e.inner) {
        if (!child) return false;
        if (!own.every((f) => f.test(child))) return false;
      }
    }
    return true;
  }

  private embedFor(row: Row, e: Embed): Row | null {
    const fk = `${singular(e.table)}_id`;
    const id = row[fk];
    if (id === undefined) return null;
    return this.db.table(e.table).find((r) => r.id === id) ?? null;
  }

  private shape(row: Row): Row {
    const out: Row = { ...row };
    for (const e of this.embeds) {
      const child = this.embedFor(row, e);
      out[e.alias] = child ? { ...child } : null;
    }
    return out;
  }

  private async execute(): Promise<{ data: unknown; error: unknown; count?: number | null }> {
    // Yield once so concurrent callers interleave the way real requests do.
    await Promise.resolve();
    try {
      return this.run();
    } catch (err) {
      const e = err as Error & { code?: string };
      return { data: null, error: { message: e.message, code: e.code } };
    }
  }

  private run(): { data: unknown; error: unknown; count?: number | null } {
    const table = this.db.table(this.name);

    if (this.op === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) =>
        withDefaults(r)
      );
      for (const r of rows) this.db.checkUnique(this.name, r);
      table.push(...rows);
      this.db.log.push({ table: this.name, op: "insert", rows });
      return this.finish(rows);
    }

    if (this.op === "upsert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const out: Row[] = [];
      for (const r of rows) {
        const existing = table.find((t) => this.upsertConflict.every((c) => t[c] === r[c]));
        if (existing) {
          Object.assign(existing, r);
          out.push(existing);
        } else {
          const fresh = withDefaults(r);
          this.db.checkUnique(this.name, fresh);
          table.push(fresh);
          out.push(fresh);
        }
      }
      this.db.log.push({ table: this.name, op: "upsert", rows: out });
      return this.finish(out);
    }

    let matched = table.filter((r) => this.matches(r));

    if (this.op === "update") {
      for (const r of matched) {
        const next = { ...r, ...(this.payload as Row) };
        this.db.checkUnique(this.name, next, r);
      }
      for (const r of matched) Object.assign(r, this.payload as Row);
      this.db.log.push({ table: this.name, op: "update", rows: matched.map((r) => ({ ...r })) });
      return this.finish(matched);
    }

    if (this.op === "delete") {
      this.db.tables[this.name] = table.filter((r) => !matched.includes(r));
      this.db.log.push({ table: this.name, op: "delete", rows: matched });
      return this.finish(matched);
    }

    // select
    for (const { col, asc } of [...this.orderBy].reverse()) {
      matched = [...matched].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
    }
    const count = matched.length;
    if (this.limitN !== null) matched = matched.slice(0, this.limitN);
    if (this.headMode) return { data: null, error: null, count };
    return this.finish(matched, this.countMode ? count : null);
  }

  private finish(rows: Row[], count: number | null = null) {
    const shaped = rows.map((r) => this.shape(r));
    if (this.op !== "select" && !this.returning && !this.singleMode) {
      return { data: null, error: null, count };
    }
    if (this.singleMode === "single") {
      if (shaped.length !== 1) {
        return { data: null, error: { message: `expected 1 row, got ${shaped.length}`, code: "PGRST116" } };
      }
      return { data: shaped[0], error: null };
    }
    if (this.singleMode === "maybe") {
      if (shaped.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: shaped[0] ?? null, error: null };
    }
    return { data: shaped, error: null, count };
  }
}

function withDefaults(r: Row): Row {
  return { id: fakeUuid(), created_at: nextTimestamp(), ...r };
}

function singular(table: string): string {
  return table.endsWith("s") ? table.slice(0, -1) : table;
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

/** A client-shaped view, for code typed against SupabaseClient. */
export function asClient(db: FakeDb) {
  return db as unknown as import("@supabase/supabase-js").SupabaseClient;
}
