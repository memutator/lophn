import { err, ok, parseSeq, type Result } from "../../base/mod.ts";
import type {
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  closureSchema,
  getProblem,
  type GroupKey,
  groupKeySchema,
  listProblems,
  PROBLEM_LIST_LIMIT,
  problemSchema,
  type ProblemSummary,
} from "../../contracts/problems/mod.ts";
import { reservedProblemCodes } from "../problem-codes/mod.ts";
import {
  invalidCursor,
  NOT_FOUND,
  requireOperation,
  scanVisible,
  targetVisible,
} from "../reporting/mod.ts";

const BROKEN = "저장된 문제를 읽을 수 없다";

// 선언 code의 당시 문구는 release 선언을 읽는 problems#T27이 채운다. 그 전과 선언을
// 읽을 수 없을 때는 이 안내다. 앱 이름은 목록 항목의 `app`으로 화면이 붙인다.
const DECLARED_FALLBACK = "There is a problem to check in this app.";

const RESERVED_MESSAGE: ReadonlyMap<string, string> = new Map(
  reservedProblemCodes().map((reserved) => [reserved.code, reserved.message]),
);

// 예약 3종은 catalog en 그대로다(problem-codes#R6).
export function symptomOf(key: GroupKey): string {
  return RESERVED_MESSAGE.get(key.code) ?? DECLARED_FALLBACK;
}

function groupKeyOf(row: Record<string, unknown>): Result<GroupKey> {
  try {
    const parsed = groupKeySchema.safeParse(
      JSON.parse(String(row["group_key"])),
    );
    if (parsed.success) return ok(parsed.data);
  } catch {
    // 깨진 JSON도 같은 내부 오류다.
  }
  return err({ code: "internal", message: BROKEN });
}

// 문제의 최신 변경 seq는 그 문제를 subject로 한 event에서 읽는다(별도 counter가 없다).
// pin은 목록 page를 고정하는 위치이고, 그 뒤 생긴 변경은 이 page 묶음에 들어오지 않는다.
const PROBLEM_SEQ =
  `(select max(e.seq) from events e where e.subject = p.id and e.seq <= ?)`;

type ProblemRowSeq = {
  id: string;
  app: string;
  status: ProblemSummary["status"];
  group_key: string;
  seq: bigint;
};

function pageRows(
  snapshot: ReadSnapshot,
  pin: bigint,
  filter: { app?: string; status?: string },
  before: bigint | null,
  size: number,
): ProblemRowSeq[] {
  const where: string[] = [];
  const params: (string | bigint | number)[] = [pin];
  if (filter.app !== undefined) {
    where.push("p.app = ?");
    params.push(filter.app);
  }
  if (filter.status !== undefined) {
    where.push("p.status = ?");
    params.push(filter.status);
  }
  const clause = where.length === 0 ? "" : ` where ${where.join(" and ")}`;
  const outer = before === null ? "" : " and seq < ?";
  if (before !== null) params.push(before);
  params.push(size);
  return snapshot.sql.all(
    `select id, app, status, group_key, seq from (
       select p.id as id, p.app as app, p.status as status, p.group_key as group_key,
              ${PROBLEM_SEQ} as seq
       from problems p${clause}
     ) where seq is not null${outer} order by seq desc limit ?`,
    params,
  ).map((row) => ({
    id: String(row["id"]),
    app: String(row["app"]),
    status: String(row["status"]) as ProblemSummary["status"],
    group_key: String(row["group_key"]),
    seq: BigInt(String(row["seq"])),
  }));
}

// 목록 cursor는 고정 위치와 마지막 seq다. 형식이 다르거나 snapshot보다 앞서면 거절한다.
function parseCursor(
  cursor: string | undefined,
  asOf: bigint,
): Result<{ pin: bigint; before: bigint | null }> {
  if (cursor === undefined) return ok({ pin: asOf, before: null });
  const match = /^([0-9]+):([0-9]+)$/.exec(cursor);
  if (match === null) return invalidCursor();
  const pin = parseSeq(match[1]);
  const before = parseSeq(match[2]);
  if (!pin.ok || !before.ok || pin.value > asOf) return invalidCursor();
  return ok({ pin: pin.value, before: before.value });
}

// 기본 항목은 앱·증상·진행·필요한 다음 행동뿐이다(grouping#R11). 사람이 해야 할 행동은
// 선언의 fixer를 읽는 problems#T27 전에는 알 수 없어 null이다. claim·기한·연결 식별자·
// 보고 수는 싣지 않는다.
export const listProblemsRead = {
  route: listProblems,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof listProblems>,
  ): Result<Output<typeof listProblems>> {
    const granted = requireOperation(ctx, listProblems.name);
    if (!granted.ok) return granted;
    const asOf = parseSeq(snapshot.as_of_seq);
    if (!asOf.ok) return err({ code: "internal", message: BROKEN });
    const cursor = parseCursor(input.cursor, asOf.value);
    if (!cursor.ok) return cursor;
    const filter = { app: input.app, status: input.status };
    const page = scanVisible({
      limit: input.limit ?? PROBLEM_LIST_LIMIT,
      before: cursor.value.before,
      load: (before, size) =>
        pageRows(snapshot, cursor.value.pin, filter, before, size),
      visible: (row) =>
        targetVisible(snapshot, ctx, listProblems.name, {
          app: row.app,
          problem: row.id,
        }),
    });
    if (!page.ok) return page;
    const problems: ProblemSummary[] = [];
    for (const row of page.value.rows) {
      const key = groupKeyOf({ group_key: row.group_key });
      if (!key.ok) return key;
      problems.push({
        id: row.id,
        app: row.app,
        status: row.status,
        symptom: symptomOf(key.value),
        next_action: null,
        seq: String(row.seq),
      });
    }
    return ok({
      problems,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: page.value.next === null
        ? null
        : `${cursor.value.pin}:${page.value.next}`,
    });
  },
};

function closureOf(row: Record<string, unknown>): Result<unknown> {
  if (row["closure"] === null) return ok(null);
  try {
    const parsed = closureSchema.safeParse(JSON.parse(String(row["closure"])));
    if (parsed.success) return ok(parsed.data);
  } catch {
    // 깨진 JSON도 같은 내부 오류다.
  }
  return err({ code: "internal", message: BROKEN });
}

// 진행은 상태 하나로 먼저 오고, 수·처음/최근 시각은 Report에서 센다. 실제 담당과 수리
// 작업 상태는 ticket을 읽는 problems#T22가 더하고, 지금은 가짜 담당을 만들지 않는다.
export const getProblemRead = {
  route: getProblem,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof getProblem>,
  ): Result<Output<typeof getProblem>> {
    const granted = requireOperation(ctx, getProblem.name);
    if (!granted.ok) return granted;
    const row = snapshot.sql.get(
      `select id, app, group_key, status, work, interpretation_version,
              interpretation_section, closure
       from problems where id = ?`,
      [input.problem],
    );
    const visible = row === undefined ? ok(false) : targetVisible(
      snapshot,
      ctx,
      getProblem.name,
      { app: String(row["app"]), problem: String(row["id"]) },
    );
    if (!visible.ok) return visible;
    if (row === undefined || !visible.value) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    const key = groupKeyOf(row);
    if (!key.ok) return key;
    const closure = closureOf(row);
    if (!closure.ok) return closure;
    const latest = snapshot.sql.get(
      `select cast(max(seq) as text) as seq from events where subject = ?`,
      [input.problem],
    );
    const observed = snapshot.sql.get(
      `select count(*) as total, min(observed_at) as first_at, max(observed_at) as last_at
       from reports where problem = ?`,
      [input.problem],
    );
    const releaseAt = (order: "asc" | "desc") =>
      snapshot.sql.get(
        `select release from reports where problem = ?
         order by observed_at ${order}, id ${order} limit 1`,
        [input.problem],
      );
    const firstReport = releaseAt("asc");
    const lastReport = releaseAt("desc");
    if (
      latest === undefined || latest["seq"] === null || !observed ||
      !firstReport || !lastReport
    ) {
      return err({ code: "internal", message: BROKEN });
    }
    const problem = problemSchema.safeParse({
      id: String(row["id"]),
      app: String(row["app"]),
      group_key: key.value,
      status: String(row["status"]),
      work: row["work"] === null ? null : String(row["work"]),
      interpretation: row["interpretation_version"] === null ? null : {
        version: String(row["interpretation_version"]),
        section: row["interpretation_section"] === null
          ? null
          : String(row["interpretation_section"]),
      },
      closure: closure.value,
      seq: String(latest["seq"]),
    });
    if (!problem.success) return err({ code: "internal", message: BROKEN });
    return ok({
      problem: problem.data,
      text: symptomOf(key.value),
      report_count: Number(observed["total"]),
      first_observed_at: observed["first_at"] === null
        ? null
        : String(observed["first_at"]),
      last_observed_at: observed["last_at"] === null
        ? null
        : String(observed["last_at"]),
      first_release: firstReport["release"] === null
        ? null
        : String(firstReport["release"]),
      last_release: lastReport["release"] === null
        ? null
        : String(lastReport["release"]),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
