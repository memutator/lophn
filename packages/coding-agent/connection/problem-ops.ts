// 문제 op의 공통 실행이다. MCP `lophn_problem`과
// CLI `problem …`이 이 한 흐름을 지나므로 같은 credential·입력의 결과와 거절이 같다(cli#R1,
// connection#R6). op마다 소유 route 하나로만 보내고 임의 core API는 부르지 않는다.
//
// - 읽기(list·show·snapshot·fix_records·summary·bundle·more)는 읽기 route만 부른다. claim을 만들거나
//   갱신하지 않는다.
// - record_fix는 summary 본문을 올려 저장한 blob의 준비 참조를 싣고 RecordProblemFix를 보낸다. hash만
//   싣는 기록은 core가 거절하므로 이 통로는 저장하지 않은 blob의 hash를 만들지 않는다. 지정 ticket의
//   현재 claim 검사는 owner command가 같은 transaction에서 한다.
// - test는 reproduction만이다. 지정 ticket의 현재 claim을 읽어 확인한 뒤 같은 `app test` 흐름으로 실제
//   runner에 요청하고 접수·시작·결과·timeout·판정 불가를 구별해 읽는다. 문제를 직접 claim하거나 test
//   result를 입력으로 받지 않는다.
// - attachment open은 허용된 첨부의 안전한 참조만 낸다. 운영 경로·blob hash 단독 접근은 없다.
import { type LophnError, ok, type Result, sha256Hex } from "../../base/mod.ts";
import {
  fixSummaryBlobSchema,
  getProblem,
  getProblemOutputSchema,
  getReport,
  getSnapshot,
  listProblemFixes,
  listProblems,
  listReports,
  problemsUploadFixSummary,
  recordProblemFix,
  userProblemReadOf,
} from "../../protocol/problems/mod.ts";
import {
  repairContextBundle,
  repairContextMore,
  repairContextSummary,
  ticketShow,
} from "../../protocol/coding-agent/mod.ts";
import type { Route } from "../../protocol/base/mod.ts";
import { type AppOpDeps, runAppOp } from "./app-ops.ts";
import type { TicketOpClient } from "./ticket-ops.ts";
import { UNREADABLE_MESSAGE } from "./unreadable.ts";

export const PROBLEM_OPS = [
  "list",
  "show",
  "snapshot",
  "fix_records",
  "summary",
  "bundle",
  "more",
  "record_fix",
  "test",
] as const;
export type ProblemOp = (typeof PROBLEM_OPS)[number];

export function isProblemOp(op: unknown): op is ProblemOp {
  return typeof op === "string" &&
    (PROBLEM_OPS as readonly string[]).includes(op);
}

// op마다 첫 소유 route다. MCP_PROBLEM_ROUTES(contract 표)와 같은 값이다.
const READ_ROUTES = {
  list: listProblems,
  show: getProblem,
  snapshot: getSnapshot,
  fix_records: listProblemFixes,
  summary: repairContextSummary,
  bundle: repairContextBundle,
  more: repairContextMore,
} as const satisfies Record<string, Route>;

// CLI command 이름이다. 두 통로의 안내가 같은 동작을 같은 이름으로 가리킨다.
export const PROBLEM_OP_CLI_NAMES: Record<ProblemOp, string> = {
  list: "problem list",
  show: "problem show",
  snapshot: "problem snapshot",
  fix_records: "problem fix-records",
  summary: "problem summary",
  bundle: "problem bundle",
  more: "problem more",
  record_fix: "problem record-fix",
  test: "problem test",
};

export type ProblemOpOutput = {
  summary: string;
  data: unknown;
  next: string[];
  // 실패·거절·판정 불가는 true다. 성공 결과는 생략한다.
  isError?: true;
};

export type ProblemOpDeps = {
  client: TicketOpClient;
  idempotencyKey: () => string;
  // claim 만료를 읽는 현재 시각이다.
  now: () => string;
  // 요청 connection이다. 알면 그 연결의 claim만 현재 claim으로 본다.
  connection?: string;
  surface?: "mcp" | "cli";
  progress?: AppOpDeps["progress"];
  wait?: AppOpDeps["wait"];
  sleep?: AppOpDeps["sleep"];
};

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return typeof value === "object" && value !== null ? value as Obj : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function withoutKeys(input: unknown, ...keys: string[]): Obj {
  const rest: Obj = { ...obj(input) };
  for (const key of keys) delete rest[key];
  return rest;
}

function refer(deps: ProblemOpDeps, op: ProblemOp, note = ""): string {
  const name = deps.surface === "cli"
    ? `lophn ${PROBLEM_OP_CLI_NAMES[op]}`
    : `lophn_problem ${op}`;
  return note === "" ? name : `${name} ${note}`;
}

// 없는 대상과 이 연결의 범위 밖 대상은 같은 답이다.
function failure(error: LophnError, next: string[]): ProblemOpOutput {
  const absent = error.code === "not_found";
  return {
    summary: absent ? UNREADABLE_MESSAGE : error.message,
    data: {
      code: error.code,
      details: absent ? {} : error.details ?? {},
    },
    next,
    isError: true,
  };
}

function more(value: Obj): string {
  const cursor = str(value.next_cursor);
  return cursor !== undefined && cursor !== ""
    ? "이어 읽을 것이 더 있다(next_cursor)"
    : "";
}

function joined(summary: string, ...notes: string[]): string {
  const rest = notes.filter((note) => note !== "");
  return rest.length === 0 ? summary : `${summary}. ${rest.join(". ")}`;
}

export async function runProblemOp(
  rawInput: unknown,
  deps: ProblemOpDeps,
): Promise<ProblemOpOutput> {
  const op = obj(rawInput).op;
  if (!isProblemOp(op)) {
    return failure({
      code: "invalid_input",
      message: "problem tool 표에 없는 op다",
      details: { op: typeof op === "string" ? op : null },
    }, [refer(deps, "list")]);
  }
  const input = withoutKeys(rawInput, "op");
  switch (op) {
    case "list":
      return await listOp(input, deps);
    case "record_fix":
      return await recordFix(input, deps);
    case "test":
      return await requestReproduction(input, deps);
    default:
      return await readOp(op, input, deps);
  }
}

// 처리 대상이다. 선언의 fixer가 user면 사람이 설정·입력을 조정할 문제라 next_action이 있고, 그렇지
// 않으면 coding agent가 고칠 문제다(grouping reads). 소유 list read에는 이 filter가 없다.
function handlerOf(row: Obj): "user" | "coding_agent" {
  return row.next_action === null || row.next_action === undefined
    ? "coding_agent"
    : "user";
}

async function listOp(
  input: Obj,
  deps: ProblemOpDeps,
): Promise<ProblemOpOutput> {
  const handler = str(input.handler);
  const read = await deps.client.read(
    READ_ROUTES.list,
    withoutKeys(input, "handler"),
  );
  if (!read.ok) return failure(read.error, [refer(deps, "list")]);
  const value = obj(read.value);
  const rows = (Array.isArray(value.problems) ? value.problems : [])
    .map((row) => ({ ...obj(row), handler: handlerOf(obj(row)) }));
  const shown = handler === undefined
    ? rows
    : rows.filter((row) => row.handler === handler);
  const hidden = rows.length - shown.length;
  return {
    summary: joined(
      `문제 ${shown.length}개`,
      hidden > 0 ? `처리 대상이 달라 ${hidden}개를 뺐다` : "",
      more(value),
    ),
    data: { ...value, problems: shown },
    next: [
      refer(deps, "show", "로 문제 하나의 상세를 읽는다"),
      refer(deps, "summary", "로 적은 양의 수리 자료를 읽는다"),
    ],
  };
}

async function readOp(
  op: Exclude<ProblemOp, "list" | "record_fix" | "test">,
  input: Obj,
  deps: ProblemOpDeps,
): Promise<ProblemOpOutput> {
  const read = await deps.client.read(READ_ROUTES[op], input);
  if (!read.ok) return failure(read.error, [refer(deps, "list")]);
  const value = obj(read.value);
  switch (op) {
    case "show": {
      // 사용자용 상세만 보인다. ticket·version 연결 식별자는 싣지 않고 담당·수리
      // 상태는 `detail`의 en 문구로 읽는다. detail이 없는 이전 응답은 받은 그대로 둔다.
      const parsed = getProblemOutputSchema.safeParse(value);
      const user = parsed.success ? userProblemReadOf(parsed.data) : null;
      if (user !== null) {
        return {
          summary:
            `문제 ${user.problem.id}: ${user.detail.progress.label}, 담당 ${user.detail.owner.label}, 수리 ${user.detail.repair.label}, 보고 ${user.report_count}개`,
          data: user,
          next: [
            refer(deps, "summary", "로 적은 양의 수리 자료를 읽는다"),
            refer(deps, "fix_records", "로 지난 고친 기록을 읽는다"),
          ],
        };
      }
      const problem = obj(value.problem);
      return {
        summary: `문제 ${str(problem.id) ?? ""}: ${
          str(problem.status) ?? "상태 모름"
        }, 보고 ${value.report_count ?? 0}개`,
        data: value,
        next: [
          refer(deps, "summary", "로 적은 양의 수리 자료를 읽는다"),
          refer(deps, "fix_records", "로 지난 고친 기록을 읽는다"),
        ],
      };
    }
    case "snapshot":
      return {
        summary: "snapshot 증거를 읽었다",
        data: value,
        next: [refer(deps, "more", "로 log·화면 같은 추가 근거를 읽는다")],
      };
    case "fix_records": {
      const fixes = Array.isArray(value.fixes) ? value.fixes : [];
      const old = fixes.filter((item) => obj(obj(item).fix).ticket === null)
        .length;
      return {
        summary: joined(
          `고친 기록 ${fixes.length}개`,
          old > 0 ? `ticket 없는 과거 기록 ${old}개는 조회만 한다` : "",
          more(value),
        ),
        data: value,
        next: [refer(deps, "show", "로 문제의 현재 상태를 읽는다")],
      };
    }
    case "summary": {
      const summary = obj(value.summary);
      const problems = Array.isArray(summary.problems) ? summary.problems : [];
      return {
        summary: joined(
          `문제 ${problems.length}개 요약`,
          summary.truncated === true ? "상한으로 줄였다" : "",
        ),
        data: value,
        next: [refer(deps, "bundle", "로 전체 수리 자료를 읽는다")],
      };
    }
    case "bundle": {
      const context = obj(value.context);
      return {
        summary: joined(
          `수리 자료 ${context.bytes ?? 0} bytes·${context.lines ?? 0}줄`,
          context.truncated === true
            ? "상한으로 줄였다. 절의 more 참조로 이어 읽는다"
            : "",
        ),
        data: value,
        next: [refer(deps, "more", "로 줄인 근거를 이어 읽는다")],
      };
    }
    case "more": {
      const missing = obj(value.missing);
      return {
        summary: joined(
          missing.reason === undefined
            ? `${str(value.kind) ?? "추가"} 근거를 읽었다`
            : `${str(value.kind) ?? "추가"} 근거는 내용 대신 이유만 있다: ${
              str(missing.reason)
            }`,
          more(value),
        ),
        data: value,
        next: more(value) === ""
          ? [refer(deps, "bundle", "로 전체 수리 자료를 다시 읽는다")]
          : [refer(deps, "more", "에 next_cursor를 넣어 이어 읽는다")],
      };
    }
  }
}

// ---- record_fix --------------------------------------------------------------------

function stageFailure(
  stage: "upload" | "record",
  error: LophnError,
  deps: ProblemOpDeps,
): ProblemOpOutput {
  const base = failure(error, [
    "지정 ticket의 현재 claim과 문제 seq를 다시 읽는다(ticket show, " +
    `${
      refer(deps, "show")
    }). 만료·반납·취소된 claim으로는 기록할 수 없고 통로가 claim을 갱신하지 않는다`,
  ]);
  return {
    ...base,
    summary: stage === "upload"
      ? `summary를 올리지 못했다: ${error.message}`
      : base.summary,
    data: { ...obj(base.data), stage, recorded: false },
  };
}

async function recordFix(
  input: Obj,
  deps: ProblemOpDeps,
): Promise<ProblemOpOutput> {
  const fix = obj(input.fix);
  const bytes = new TextEncoder().encode(String(input.summary));
  const hash = await sha256Hex(bytes);
  const key = str(input.idempotency_key) ?? deps.idempotencyKey();
  // 가리키는 바이트가 저장된 blob이어야 한다: 먼저 올려 준비 참조를 받는다.
  const uploaded = await deps.client.upload(
    problemsUploadFixSummary,
    { blob_hash: hash, bytes: bytes.length },
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  );
  if (!uploaded.ok) return stageFailure("upload", uploaded.error, deps);
  const blob = fixSummaryBlobSchema.safeParse(uploaded.value);
  // 올린 바이트의 hash와 다르면 저장된 blob이 아니다. 그 hash를 기록에 싣지 않는다.
  if (!blob.success || blob.data.hash !== hash) {
    return stageFailure("upload", {
      code: "internal",
      message: "준비된 summary가 올린 바이트와 맞지 않는다",
    }, deps);
  }
  const sent = await deps.client.command(recordProblemFix, {
    input: {
      problem: input.problem,
      idempotency_key: key,
      fix: {
        before: fix.before,
        after: fix.after,
        summary: hash,
        verification: fix.verification,
        ticket: fix.ticket,
        claim_seq: fix.claim_seq,
      },
      summary_blob: blob.data,
    },
    idempotency_key: key,
    compare: { problem_seq: input.problem_seq },
    prepared: [blob.data.preparation],
  });
  if (!sent.ok) return stageFailure("record", sent.error, deps);
  const recorded = obj(sent.value);
  return {
    summary: `고친 기록을 접수했다(seq ${
      str(recorded.seq) ?? "?"
    }). 이 기록은 문제를 닫거나 ticket을 확인됨으로 만들지 않는다`,
    data: {
      problem: input.problem,
      recorded: true,
      seq: recorded.seq ?? null,
      fix: {
        before: fix.before,
        after: fix.after,
        summary_hash: hash,
        verification: fix.verification,
        ticket: fix.ticket,
        claim_seq: fix.claim_seq,
      },
    },
    next: [
      `ticket report의 fix_records에 seq ${
        str(recorded.seq) ?? ""
      }를 넣어 완료 보고한다. 문제 닫힘은 사람과 problems가 정한다`,
      refer(deps, "fix_records", "로 기록을 다시 읽는다"),
    ],
  };
}

// ---- test(reproduction) ------------------------------------------------------------

const NOT_CURRENT = "ticket claim is not current";

// 지정 ticket의 현재 claim인지 본다: 이 앱·이 문제의 repair ticket이고, claimed 상태에서 요청한
// claim_seq가 현재 claim이며 기한 안이고, 요청 connection의 claim이다. 어느 것이 틀려도 같은
// conflict다(없는·범위 밖 ticket도 같다). 통로는 claim을 만들거나 갱신하지 않는다.
async function claimIsCurrent(
  source: Obj,
  input: Obj,
  deps: ProblemOpDeps,
): Promise<Result<true, LophnError>> {
  const read = await deps.client.read(ticketShow, { ticket: source.ticket });
  const conflict = (): Result<true, LophnError> => ({
    ok: false,
    error: { code: "conflict", message: NOT_CURRENT },
  });
  if (!read.ok) return conflict();
  const ticket = obj(obj(read.value).ticket);
  const claim = obj(ticket.claim);
  const problems = Array.isArray(ticket.problems) ? ticket.problems : [];
  const expiresAt = Date.parse(String(claim.expires_at));
  const current = ticket.kind === "repair" && ticket.state === "claimed" &&
    ticket.app === input.app && problems.includes(input.problem) &&
    claim.claim_seq === source.claim_seq &&
    Number.isFinite(expiresAt) && expiresAt > Date.parse(deps.now()) &&
    (deps.connection === undefined || claim.connection === deps.connection);
  return current ? ok(true) : conflict();
}

async function requestReproduction(
  input: Obj,
  deps: ProblemOpDeps,
): Promise<ProblemOpOutput> {
  if (input.kind !== "reproduction") {
    return failure({
      code: "invalid_input",
      message:
        "문제 tool의 test는 reproduction만 요청한다. app test·test command는 app test로 요청한다",
      details: { kind: str(input.kind) ?? null },
    }, ["lophn app test로 app test·test command를 요청한다"]);
  }
  const source = obj(input.ticket_source);
  const checked = await claimIsCurrent(source, input, deps);
  if (!checked.ok) {
    return failure(checked.error, [
      "지정 ticket의 현재 claim을 다시 읽는다(ticket show). 문제 직접 claim은 없다",
    ]);
  }
  // core가 접수 때 이 연결의 현재 claim을 다시 확인한다. ticket_source를 빼면 접수되지 않는다.
  const ran = await runAppOp(
    { ...input, op: "test" },
    {
      client: deps.client,
      idempotencyKey: deps.idempotencyKey,
      surface: deps.surface,
      progress: deps.progress,
      wait: deps.wait,
      sleep: deps.sleep,
    },
  );
  return {
    ...ran,
    data: { ...obj(ran.data), ticket_source: source },
  };
}

// ---- attachment open ---------------------------------------------------------------

// 첨부 field와 snapshot item의 대응이다. 허용 첨부는 보고에 붙은 화면 이미지와 snapshot log뿐이다.
const ATTACHMENT_ITEMS = {
  screen: {
    field: "feedback_screenshot",
    kind: "image",
    media_type: "image/png",
  },
  logs: { field: "snapshot_logs", kind: "log", media_type: "text/plain" },
} as const;

const REPORT_PAGE_CAP = 10;

type ReportRow = { id?: string; snapshot?: string };

export async function openProblemAttachment(
  rawInput: unknown,
  deps: Pick<ProblemOpDeps, "client" | "surface">,
): Promise<ProblemOpOutput> {
  const input = obj(rawInput);
  const absent = (): ProblemOpOutput =>
    failure({ code: "not_found", message: UNREADABLE_MESSAGE }, [
      "lophn problem show로 문제의 보고와 snapshot을 다시 읽는다",
    ]);
  // 이 문제의 보고 중 이 snapshot을 가진 것만 연다. 범위 밖 문제와 없는 snapshot은 같은 답이다.
  let report: string | undefined;
  let cursor: string | undefined;
  for (
    let page = 0;
    page < REPORT_PAGE_CAP && report === undefined;
    page += 1
  ) {
    const listed = await deps.client.read(listReports, {
      problem: input.problem,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return absent();
    const value = obj(listed.value);
    const rows =
      (Array.isArray(value.reports) ? value.reports : []) as ReportRow[];
    report = rows.find((row) => row.snapshot === input.snapshot)?.id;
    const next = str(value.next_cursor);
    if (next === undefined || next === "" || value.next_cursor === null) break;
    cursor = next;
  }
  if (report === undefined) return absent();
  const detail = await deps.client.read(getReport, { report });
  if (!detail.ok) return absent();
  const body = obj(detail.value);
  const snapshot = obj(body.snapshot);
  if (snapshot.id !== input.snapshot) return absent();
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .map(obj);
  const items = input.item === undefined
    ? (Object.keys(ATTACHMENT_ITEMS) as (keyof typeof ATTACHMENT_ITEMS)[])
    : (Object.hasOwn(ATTACHMENT_ITEMS, String(input.item))
      ? [input.item as keyof typeof ATTACHMENT_ITEMS]
      : []);
  const found = items.flatMap((item) => {
    const spec = ATTACHMENT_ITEMS[item];
    const hash = item === "screen"
      ? obj(snapshot.screen).screenshot
      : obj(snapshot.logs).blob;
    const stored = attachments.find((attachment) =>
      attachment.field === spec.field && attachment.hash === hash
    );
    if (stored === undefined) return [];
    return [{
      item,
      kind: spec.kind,
      media_type: spec.media_type,
      size_bytes: stored.size_bytes,
      // 안전한 참조다. 운영 경로·blob hash·저장 위치를 내지 않는다.
      open: {
        kind: "report_attachment",
        problem: input.problem,
        report,
        field: spec.field,
      },
    }];
  });
  if (found.length === 0) return absent();
  return {
    summary: `허용된 첨부 ${found.length}개(${
      found.map((entry) => `${entry.kind} ${entry.size_bytes} bytes`).join(", ")
    }). 내용은 이 통로가 보내지 않고 참조만 낸다`,
    data: {
      problem: input.problem,
      snapshot: input.snapshot,
      report,
      attachments: found,
      content_delivered: false,
    },
    next: found.some((entry) => entry.kind === "log")
      ? [
        `log 본문은 lophn problem more로 읽는다(kind log, source report:${report})`,
      ]
      : [
        "이미지 내용은 redaction이 image/png를 지원할 때까지 보내지 않는다. 크기·종류·참조만 있다",
      ],
  };
}
