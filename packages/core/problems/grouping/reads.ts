import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  problemGet,
  problemList,
  type ProblemListItem,
  type ProblemState,
  type ReleaseRef,
} from "../../../protocol/problems/mod.ts";
import { readProblemSnapshot } from "../snapshots/mod.ts";
import {
  invalidCursor,
  loadProblem,
  NOT_FOUND,
  occurrenceOf,
  problemRecordOf,
  ReleaseLookupPort,
  requireOperation,
  targetVisible,
} from "../reporting/mod.ts";

const BROKEN = "저장된 문제를 읽을 수 없다";
const LIST_LIMIT = 100;
const SCAN_BATCH = 200;
// 한 호출이 훑는 행의 상한. 범위 밖 행이 많으면 짧은 page와 cursor를 돌려주고 다음 호출이 잇는다.
const SCAN_CAP = 1000;
const OCCURRENCES = 20;

type ListRow = ProblemListItem & { last_at: string };

// 목록 cursor는 마지막 행의 (마지막 발생 시각, 문제 id)다.
type After = { at: string; id: string };

function parseCursor(cursor: string | undefined): Result<After | null> {
  if (cursor === undefined) return ok(null);
  const match = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|(prb_\S+)$/.exec(cursor);
  return match === null ? invalidCursor() : ok({ at: match[1], id: match[2] });
}

const cursorOf = (row: ListRow) => `${row.last_at}|${row.id}`;

function pageRows(
  snapshot: ReadSnapshot,
  filter: Input<typeof problemList>,
  after: After | null,
  size: number,
): ListRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.app !== undefined) {
    where.push("p.app = ?");
    params.push(filter.app);
  }
  if (filter.state !== undefined) {
    where.push("p.state = ?");
    params.push(filter.state);
  }
  if (filter.since !== undefined) {
    where.push("r.last_at >= ?");
    params.push(filter.since);
  }
  if (filter.until !== undefined) {
    where.push("r.last_at <= ?");
    params.push(filter.until);
  }
  if (after !== null) {
    where.push("(r.last_at, p.id) < (?, ?)");
    params.push(after.at, after.id);
  }
  params.push(size);
  return snapshot.sql.all(
    `select p.id, p.app, p.state, p.name, p.seq, r.total, r.last_at
     from problems p
     join (
       select problem, count(*) as total, max(observed_at) as last_at
       from reports where problem is not null group by problem
     ) r on r.problem = p.id
     ${where.length === 0 ? "" : `where ${where.join(" and ")}`}
     order by r.last_at desc, p.id desc limit ?`,
    params,
  ).map((row) => ({
    id: String(row["id"]),
    app: String(row["app"]),
    state: String(row["state"]) as ProblemState,
    name: String(row["name"]),
    occurrence_count: Number(row["total"]),
    last_observed_at: String(row["last_at"]),
    seq: String(row["seq"]),
    last_at: String(row["last_at"]),
  }));
}

// `since`·`until`은 마지막 발생 시각에 건다(양끝 포함). 마지막 발생이 최근인 문제부터 cursor로 이어 읽는다.
export const problemListRead = {
  route: problemList,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof problemList>,
  ): Result<Output<typeof problemList>> {
    const granted = requireOperation(ctx, problemList.name);
    if (!granted.ok) return granted;
    const cursor = parseCursor(input.cursor);
    if (!cursor.ok) return cursor;
    const limit = input.limit ?? LIST_LIMIT;
    const rows: ListRow[] = [];
    let after = cursor.value;
    let scanned = 0;
    for (;;) {
      const batch = pageRows(snapshot, input, after, SCAN_BATCH);
      for (const row of batch) {
        const seen = targetVisible(snapshot, ctx, problemList.name, {
          app: row.app,
          problem: row.id,
        });
        if (!seen.ok) return seen;
        if (seen.value) {
          // limit개를 채운 뒤 보이는 행이 하나 더 있어야 다음 page가 있다.
          if (rows.length === limit) {
            return page(snapshot, rows, cursorOf(rows[rows.length - 1]));
          }
          rows.push(row);
        }
        after = { at: row.last_at, id: row.id };
        scanned += 1;
        if (scanned >= SCAN_CAP) return page(snapshot, rows, cursorOf(row));
      }
      if (batch.length < SCAN_BATCH) return page(snapshot, rows, null);
    }
  },
};

function page(
  snapshot: ReadSnapshot,
  rows: readonly ListRow[],
  next: string | null,
): Result<Output<typeof problemList>> {
  return ok({
    problems: rows.map(({ last_at: _, ...item }) => item),
    as_of_seq: snapshot.as_of_seq,
    next_cursor: next,
  });
}

// release id를 ReleaseLookup으로 번호와 commit까지 푼다. 풀 곳(port)이 없거나 읽지 못하면 id만으로
// 채우지 않고 unavailable이다. 모르는 release는 null이다.
function releaseRefOf(
  snapshot: ReadSnapshot,
  id: string | null,
): Result<ReleaseRef | null> {
  if (id === null) return ok(null);
  let found;
  try {
    found = snapshot.port(ReleaseLookupPort)(snapshot.sql).get(id);
  } catch {
    return err({ code: "unavailable", message: "release를 읽지 못했다" });
  }
  if (!found.ok) return found;
  const release = found.value;
  return ok(
    release === null ? null : {
      id: release.id,
      number: release.number,
      code_commit: release.code_commit,
    },
  );
}

const textOrNull = (value: unknown) =>
  value === null || value === undefined ? null : String(value);

// 발생 수, 처음·마지막 시각과 release, 최근 발생 20개, 마지막 발생의 근거를 한 번에 낸다.
export const problemGetRead = {
  route: problemGet,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof problemGet>,
  ): Result<Output<typeof problemGet>> {
    const granted = requireOperation(ctx, problemGet.name);
    if (!granted.ok) return granted;
    const row = loadProblem(snapshot.sql, input.problem);
    const visible = row === null ? ok(false) : targetVisible(
      snapshot,
      ctx,
      problemGet.name,
      { app: row.app, problem: row.id },
    );
    if (!visible.ok) return visible;
    if (row === null || !visible.value) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    const record = problemRecordOf(row);
    if (!record.ok) return record;
    const total = snapshot.sql.get(
      `select count(*) as total, min(observed_at) as first_at,
              max(observed_at) as last_at
       from reports where problem = ?`,
      [row.id],
    );
    const releaseAt = (order: "asc" | "desc") =>
      snapshot.sql.get(
        `select release from reports where problem = ?
         order by observed_at ${order}, id ${order} limit 1`,
        [row.id],
      );
    const first = releaseAt("asc");
    const last = releaseAt("desc");
    const recent = snapshot.sql.all(
      `select id, source, release, observed_at, snapshot from reports
       where problem = ? order by observed_at desc, id desc limit ?`,
      [row.id, OCCURRENCES],
    );
    if (
      total === undefined || first === undefined || last === undefined ||
      recent.length === 0
    ) return err({ code: "internal", message: BROKEN });
    const firstRelease = releaseRefOf(snapshot, textOrNull(first["release"]));
    if (!firstRelease.ok) return firstRelease;
    const lastRelease = releaseRefOf(snapshot, textOrNull(last["release"]));
    if (!lastRelease.ok) return lastRelease;
    const evidence = readProblemSnapshot(
      snapshot.sql,
      String(recent[0]["snapshot"]),
    );
    if (evidence === undefined) {
      return err({ code: "internal", message: BROKEN });
    }
    const occurrences = recent.map(occurrenceOf);
    return ok({
      problem: record.value,
      occurrence_count: Number(total["total"]),
      first_observed_at: String(total["first_at"]),
      last_observed_at: String(total["last_at"]),
      first_release: firstRelease.value,
      last_release: lastRelease.value,
      occurrences,
      latest: { occurrence: occurrences[0], snapshot: evidence },
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
