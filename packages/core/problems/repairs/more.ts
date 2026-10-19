import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  type ProblemListItem,
  problemMore,
  type ProblemState,
  type ReleaseRef,
} from "../../../protocol/problems/mod.ts";
import type { ReleaseFact } from "../ports.ts";
import { logsRowOf } from "../snapshots/mod.ts";
import {
  invalidCursor,
  loadProblem,
  NOT_FOUND,
  occurrenceOf,
  ReleaseLookupPort,
  requireOperation,
  targetVisible,
} from "../reporting/mod.ts";

const DEFAULT_LIMIT = 20;

type Row = Record<string, unknown>;
type More = Output<typeof problemMore>;

// 모든 종류가 (시각, id) 내림차순이고 cursor는 마지막 항목의 `시각|id`다.
function parseCursor(
  cursor: string | undefined,
): Result<[string, string] | null> {
  if (cursor === undefined) return ok(null);
  const cut = cursor.indexOf("|");
  return cut <= 0 || cut === cursor.length - 1
    ? invalidCursor()
    : ok([cursor.slice(0, cut), cursor.slice(cut + 1)]);
}

// limit개보다 한 행 더 읽어 다음 page가 있는지 본다.
function paged<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => string,
): { rows: T[]; next: string | null } {
  if (rows.length <= limit) return { rows, next: null };
  const kept = rows.slice(0, limit);
  return { rows: kept, next: cursorOf(kept[kept.length - 1]) };
}

const reportCursor = (row: Row) => `${row["observed_at"]}|${row["id"]}`;

// 이 문제의 발생을 최근 것부터 읽는다. `extra`는 reports(r)·snapshots(s)를 거는 조건이다.
function reportRows(
  snapshot: ReadSnapshot,
  problem: string,
  after: [string, string] | null,
  limit: number,
  extra = "",
): Row[] {
  const params: (string | number)[] = [problem];
  if (after !== null) params.push(after[0], after[1]);
  params.push(limit + 1);
  return snapshot.sql.all(
    `select r.id, r.source, r.release, r.observed_at, r.snapshot
     from reports r join snapshots s on s.id = r.snapshot
     where r.problem = ? ${extra}
     ${after === null ? "" : "and (r.observed_at, r.id) < (?, ?)"}
     order by r.observed_at desc, r.id desc limit ?`,
    params,
  );
}

type ReleaseLookup = ReturnType<ReturnType<typeof lookupOf>>;
const lookupOf = (snapshot: ReadSnapshot) => snapshot.port(ReleaseLookupPort);

function releaseRef(fact: ReleaseFact): ReleaseRef {
  return {
    id: fact.id,
    number: fact.number,
    code_commit: fact.code_commit,
  };
}

function releaseChanges(
  snapshot: ReadSnapshot,
  problem: string,
  after: [string, string] | null,
  limit: number,
): Result<More> {
  const params: (string | number)[] = [problem];
  if (after !== null) params.push(after[0], after[1]);
  params.push(limit + 1);
  const rows = snapshot.sql.all(
    `select release, max(observed_at) as at from reports
     where problem = ? and release is not null group by release
     ${after === null ? "" : "having (max(observed_at), release) < (?, ?)"}
     order by at desc, release desc limit ?`,
    params,
  );
  const { rows: kept, next } = paged(
    rows,
    limit,
    (row) => `${row["at"]}|${row["release"]}`,
  );
  const items: Extract<More, { kind: "release_changes" }>["items"] = [];
  let lookup: ReleaseLookup;
  try {
    lookup = lookupOf(snapshot)(snapshot.sql);
  } catch {
    return err({ code: "unavailable", message: "release를 읽지 못했다" });
  }
  for (const row of kept) {
    const id = String(row["release"]);
    const found = lookup.get(id);
    if (!found.ok) return found;
    // 모르는 release는 건너뛴다.
    if (found.value === null) continue;
    const before = lookup.previousOf(id);
    if (!before.ok) return before;
    const previous = before.value;
    const had = new Set(previous?.resources ?? []);
    const has = new Set(found.value.resources);
    items.push({
      release: releaseRef(found.value),
      previous: previous === null ? null : releaseRef(previous),
      added_resources: found.value.resources.filter((name) => !had.has(name)),
      removed_resources: (previous?.resources ?? []).filter((name) =>
        !has.has(name)
      ),
    });
  }
  return ok({
    kind: "release_changes",
    items,
    next_cursor: next,
    as_of_seq: snapshot.as_of_seq,
  });
}

function relatedProblems(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  problem: { id: string; app: string },
  after: [string, string] | null,
  limit: number,
): Result<More> {
  const last = (id: string) =>
    `(select release from reports where problem = ${id}
      order by observed_at desc, id desc limit 1)`;
  const params: (string | number)[] = [problem.app, problem.id, problem.id];
  if (after !== null) params.push(after[0], after[1]);
  params.push(limit + 1);
  const rows = snapshot.sql.all(
    `select p.id, p.app, p.state, p.name, p.seq, c.total, c.last_at
     from problems p
     join (
       select problem, count(*) as total, max(observed_at) as last_at
       from reports where problem is not null group by problem
     ) c on c.problem = p.id
     where p.app = ? and p.id <> ? and ${last("p.id")} = ${last("?")}
     ${after === null ? "" : "and (c.last_at, p.id) < (?, ?)"}
     order by c.last_at desc, p.id desc limit ?`,
    params,
  );
  const { rows: kept, next } = paged(
    rows,
    limit,
    (row) => `${row["last_at"]}|${row["id"]}`,
  );
  const items: ProblemListItem[] = [];
  for (const row of kept) {
    const seen = targetVisible(snapshot, ctx, problemMore.name, {
      app: String(row["app"]),
      problem: String(row["id"]),
    });
    if (!seen.ok) return seen;
    if (!seen.value) continue;
    items.push({
      id: String(row["id"]),
      app: String(row["app"]),
      state: String(row["state"]) as ProblemState,
      name: String(row["name"]),
      occurrence_count: Number(row["total"]),
      last_observed_at: String(row["last_at"]),
      seq: String(row["seq"]),
    });
  }
  return ok({
    kind: "related_problems",
    items,
    next_cursor: next,
    as_of_seq: snapshot.as_of_seq,
  });
}

// coding agent와 App Engineer가 종류를 골라 읽는 문제의 더 많은 근거다. 종류마다 한 표 읽기이고
// 외부를 부르지 않는다. 열람 범위는 `problem.get`과 같다.
export const problemMoreRead: ReadDefinition<typeof problemMore> = {
  route: problemMore,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof problemMore>,
  ): Result<Output<typeof problemMore>> {
    const granted = requireOperation(ctx, problemMore.name);
    if (!granted.ok) return granted;
    const after = parseCursor(input.cursor);
    if (!after.ok) return after;
    const row = loadProblem(snapshot.sql, input.problem);
    const visible = row === null ? ok(false) : targetVisible(
      snapshot,
      ctx,
      problemMore.name,
      { app: row.app, problem: row.id },
    );
    if (!visible.ok) return visible;
    if (row === null || !visible.value) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    const limit = input.limit ?? DEFAULT_LIMIT;
    const asOf = snapshot.as_of_seq;
    switch (input.kind) {
      case "occurrences": {
        const page = paged(
          reportRows(snapshot, row.id, after.value, limit),
          limit,
          reportCursor,
        );
        return ok({
          kind: "occurrences",
          items: page.rows.map(occurrenceOf),
          next_cursor: page.next,
          as_of_seq: asOf,
        });
      }
      case "failed_invocations": {
        // invocation이 정말 실패했는지는 앱 표를 읽지 못해 확인하지 않는다.
        const page = paged(
          reportRows(
            snapshot,
            row.id,
            after.value,
            limit,
            "and s.invocation is not null",
          ),
          limit,
          reportCursor,
        );
        const items = page.rows.map((report) => ({
          report: String(report["id"]),
          invocation: String(
            snapshot.sql.get("select invocation from snapshots where id = ?", [
              String(report["snapshot"]),
            ])?.["invocation"],
          ),
        }));
        return ok({
          kind: "failed_invocations",
          items,
          next_cursor: page.next,
          as_of_seq: asOf,
        });
      }
      case "logs": {
        const page = paged(
          reportRows(
            snapshot,
            row.id,
            after.value,
            limit,
            "and s.logs_blob is not null",
          ),
          limit,
          reportCursor,
        );
        const items: Extract<More, { kind: "logs" }>["items"] = [];
        for (const report of page.rows) {
          const id = String(report["snapshot"]);
          const log = logsRowOf(snapshot.sql, id, asOf)?.logs;
          if (log) {
            items.push({ report: String(report["id"]), snapshot: id, log });
          }
        }
        return ok({
          kind: "logs",
          items,
          next_cursor: page.next,
          as_of_seq: asOf,
        });
      }
      case "release_changes":
        return releaseChanges(snapshot, row.id, after.value, limit);
      case "related_problems":
        return relatedProblems(snapshot, ctx, row, after.value, limit);
    }
  },
};
