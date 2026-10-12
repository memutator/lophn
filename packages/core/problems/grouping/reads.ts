import { err, ok, parseSeq, type Result } from "../../../base/mod.ts";
import type {
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  type ProblemTestFact,
  ProblemTestPort,
  type ProblemTestRecord,
  type ProblemWordingFact,
  ProblemWordingPort,
  ProblemWorkPort,
  type RepairTicketFact,
} from "../../../protocol/problems/mod.ts";
import {
  closureSchema,
  getProblem,
  type GroupKey,
  groupKeySchema,
  listProblems,
  PROBLEM_LIST_LIMIT,
  problemSchema,
  type ProblemSummary,
} from "../../../protocol/problems/mod.ts";
import { type DecisionFacts, projectProblemDetail } from "./detail.ts";
import { problemTestHistory } from "../tests/mod.ts";
import { offersFixedConfirmation } from "../closing/mod.ts";
import { reservedProblemCodes } from "../problem-codes/mod.ts";
import {
  invalidCursor,
  NOT_FOUND,
  requireOperation,
  scanVisible,
  targetVisible,
} from "../reporting/mod.ts";

const BROKEN = "저장된 문제를 읽을 수 없다";

// 선언 code의 당시 문구는 보고 당시 release의 선언이다. 그 release가
// 없거나 선언을 읽을 수 없을 때는 이 안내고, 앱 이름을 알면 이름을 붙인다.
const DECLARED_FALLBACK = "There is a problem to check in this app.";

// fixer가 user인 선언의 다음 행동이다(#261 이어받음).
const USER_ACTION = "Adjust the app's settings or input for this problem.";

const RESERVED_MESSAGE: ReadonlyMap<string, string> = new Map(
  reservedProblemCodes().map((reserved) => [reserved.code, reserved.message]),
);

// 예약 3종은 catalog en 그대로다.
export function symptomOf(key: GroupKey): string {
  return RESERVED_MESSAGE.get(key.code) ?? DECLARED_FALLBACK;
}

type Wording = {
  symptom: string;
  next_action: string | null;
};

// 보고 당시 release의 선언 문구가 나온다. release를 모르는 보고, port가
// 등록되지 않은 core, 그 release가 없거나 선언에 그 code가 없는 경우에는 fallback이고,
// 앱 이름을 알면 이름을 붙인다. 예약 code는 catalog en 그대로다.
function declaredWording(
  snapshot: ReadSnapshot,
  app: string,
  release: string | null,
  code: string,
): Result<Wording> {
  if (RESERVED_MESSAGE.has(code)) {
    return ok({ symptom: RESERVED_MESSAGE.get(code)!, next_action: null });
  }
  const fallbackWith = (name: string | null): Wording => ({
    symptom: name === null
      ? DECLARED_FALLBACK
      : DECLARED_FALLBACK.replace("this app", name),
    next_action: null,
  });
  if (release === null) return ok(fallbackWith(null));
  let found: Result<ProblemWordingFact | null>;
  try {
    const lookup = snapshot.port(ProblemWordingPort);
    found = lookup(snapshot.sql, app, release, code);
  } catch {
    return ok(fallbackWith(null));
  }
  if (!found.ok) {
    return ok(fallbackWith(null));
  }
  if (found.value === null) return ok(fallbackWith(null));
  const { app_name, declaration } = found.value;
  if (declaration === null) return ok(fallbackWith(app_name));
  return ok({
    symptom: declaration.message,
    next_action: declaration.fixer === "user" ? USER_ACTION : null,
  });
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

// 기본 항목은 앱·증상·진행·필요한 다음 행동뿐이다. 당시 선언의 fixer가
// user면 사람이 할 일을 채운다. claim·기한·연결 식별자·보고 수는 싣지 않는다.
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
      // 보고 당시 release의 선언 문구다. 목록은 seq 내림차순이라 최근
      // 보고의 release를 찾을 때까지 row마다 내려가지 않아도 문제마다 한 번 본다.
      const lastReport = snapshot.sql.get(
        `select release from reports
         where app = ? and code = ?
         order by observed_at desc, id desc limit 1`,
        [row.app, key.value.code],
      );
      if (!lastReport) return err({ code: "internal", message: BROKEN });
      const wording = declaredWording(
        snapshot,
        row.app,
        lastReport["release"] === null ? null : String(lastReport["release"]),
        key.value.code,
      );
      if (!wording.ok) return wording;
      problems.push({
        id: row.id,
        app: row.app,
        status: row.status,
        symptom: wording.value.symptom,
        next_action: wording.value.next_action,
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

// port가 등록되지 않았거나 읽지 못한 사실은 undefined(모름)다. 성공이나 없음으로 채우지 않는다.
function readFact<T>(read: () => Result<T>): T | undefined {
  try {
    const found = read();
    return found.ok ? found.value : undefined;
  } catch {
    return undefined;
  }
}

function ticketFact(
  snapshot: ReadSnapshot,
  problem: string,
  work: string | null,
): RepairTicketFact | null | undefined {
  return readFact(() =>
    snapshot.port(ProblemWorkPort)(snapshot.sql, problem, work)
  );
}

function testFacts(
  snapshot: ReadSnapshot,
  problem: string,
): ProblemTestFact[] | undefined {
  return readFact(() => snapshot.port(ProblemTestPort)(snapshot.sql, problem));
}

function testHistory(
  snapshot: ReadSnapshot,
  problem: string,
): ProblemTestRecord[] | undefined {
  return readFact(() => problemTestHistory(snapshot.sql, problem));
}

// 마지막 고친 기록의 after release가 활성인지. 기록이 없거나 표를 읽지 못하면
// undefined라 적용된 것처럼 말하지 않는다. 행이 없거나 활성이 아니면 false다.
function fixAppliedOf(
  snapshot: ReadSnapshot,
  problem: string,
): boolean | undefined {
  try {
    const row = snapshot.sql.get(
      `select json_extract(payload, '$.after') as after from events
       where type = 'ProblemFixRecorded' and subject = ?
       order by seq desc limit 1`,
      [problem],
    );
    if (row === undefined || row["after"] == null) return undefined;
    const release = snapshot.sql.get(
      `select status from releases where id = ?`,
      [String(row["after"])],
    );
    if (release === undefined) return false;
    return String(release["status"]) === "active";
  } catch {
    return undefined;
  }
}

// 지금 닫힘을 남긴 마지막 ProblemClosed의 시각이다(실제 닫힘).
function closedAtOf(snapshot: ReadSnapshot, problem: string): string | null {
  const row = snapshot.sql.get(
    `select at from events where type = 'ProblemClosed' and subject = ?
      order by seq desc limit 1`,
    [problem],
  );
  return row === undefined ? null : String(row["at"]);
}

// 앱의 활성 release다. release 표를 읽지 못하면 모름(null)이고 그때는 "고쳐졌다"를 제안하지
// 않는다(fixed 결정은 release가 있어야 한다).
function activeReleaseOf(snapshot: ReadSnapshot, app: string): string | null {
  try {
    const row = snapshot.sql.get(
      `select id from releases where app = ? and status = 'active'`,
      [app],
    );
    return row === undefined ? null : String(row["id"]);
  } catch {
    return null;
  }
}

// 사람 결정 뒤의 사실이다: 마지막 "아직입니다"(ProblemConfirmationRecorded)나
// 다시 열림(ProblemReopened)과, 같은 release·근거로 고쳐짐 확인을 다시 제안할지.
function decisionFacts(
  snapshot: ReadSnapshot,
  problem: string,
  app: string,
): DecisionFacts {
  const row = snapshot.sql.get(
    `select type, at, json_extract(payload, '$.report') as report from events
      where subject = ? and type in ('ProblemConfirmationRecorded', 'ProblemReopened')
      order by seq desc limit 1`,
    [problem],
  );
  const last: DecisionFacts["last"] = row === undefined ? null : {
    kind: row["type"] === "ProblemConfirmationRecorded"
      ? "not_fixed"
      : row["report"] === null
      ? "reopened_by_you"
      : "reopened_by_report",
    at: String(row["at"]),
  };
  const release = activeReleaseOf(snapshot, app);
  return {
    offerFixed: release !== null &&
      offersFixedConfirmation(snapshot.sql, problem, release),
    last,
  };
}

// 진행은 상태 하나로 먼저 오고, 수·처음/최근 시각은 Report에서 센다. 실제 담당과 수리
// 작업 상태는 `detail`(사용자용 상세)에 있고, ticket을 읽지 못하면 가짜 담당 없이 모름이다.
// `problem`은 내부 contract(ticket·version ID)라 화면은 `detail`만 쓴다.
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
    // 상세 문구도 보고 당시 release의 선언이다. 최근 보고의 release를 쓴다.
    const wording = declaredWording(
      snapshot,
      String(row["app"]),
      lastReport["release"] === null ? null : String(lastReport["release"]),
      key.value.code,
    );
    if (!wording.ok) return wording;
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
    const fixRecorded = snapshot.sql.get(
      `select 1 as found from events where type = ? and subject = ? limit 1`,
      ["ProblemFixRecorded", input.problem],
    ) !== undefined;
    const detail = projectProblemDetail({
      status: problem.data.status,
      closure: problem.data.closure,
      ticket: ticketFact(snapshot, input.problem, problem.data.work),
      fixRecorded,
      tests: testFacts(snapshot, input.problem),
      recorded: testHistory(snapshot, input.problem),
      fixApplied: fixAppliedOf(snapshot, input.problem),
      nextAction: wording.value.next_action,
      closedAt: closedAtOf(snapshot, input.problem),
      decision: decisionFacts(snapshot, input.problem, String(row["app"])),
    });
    return ok({
      problem: problem.data,
      detail,
      text: wording.value.symptom,
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
