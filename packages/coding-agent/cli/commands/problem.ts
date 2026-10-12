// problem command의 route 표와 실행이다(T44, cli#R7, R26, R33, R34, R35). 읽기·record-fix·
// test는 MCP `lophn_problem`과 같은 op·같은 소유 route·같은 흐름(connection/problem-ops)이다: 같은
// credential·입력의 결과와 거절이 같다(cli#R1). `attachment open`은 허용된 첨부의 안전한 참조만 낸다.
//
// 사람 command(`report`·`request-repair`·`confirm`·`dismiss`)는 CLI가 접수하지 않는다(lead 결정 D27,
// problems/feedback#R1). report는 shell의 문제 알리기 화면 안내, request-repair는 담당 agent의 ticket
// 준비 화면 링크, confirm·dismiss는 결정 화면 링크와 대기 사실만 낸다. coding credential은 실행 전
// 거절이고, 요청만으로 문제를 닫거나 coding agent를 띄우지 않으며 사람 확인을 테스트 통과로 적지 않는다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliProblemAttachmentOpenSchema,
  cliProblemBundleSchema,
  cliProblemConfirmSchema,
  cliProblemDismissSchema,
  cliProblemFixRecordsSchema,
  cliProblemListSchema,
  cliProblemMoreSchema,
  cliProblemRecordFixSchema,
  cliProblemReportSchema,
  cliProblemRequestRepairSchema,
  cliProblemShowSchema,
  cliProblemSnapshotSchema,
  cliProblemSummarySchema,
  cliProblemTestSchema,
  decisionLink,
  MCP_PROBLEM_ROUTES,
  problemHandlerSchema,
  problemTicketSourceSchema,
} from "../../../protocol/coding-agent/mod.ts";
import { recordProblemFixToolInputSchema } from "../../../protocol/problems/mod.ts";
import { idSchema } from "../../../protocol/server/mod.ts";
import {
  openProblemAttachment,
  type ProblemOp,
  type ProblemOpDeps,
  type ProblemOpOutput,
  runProblemOp,
} from "../../connection/mod.ts";
import type { CommandEntry } from "./types.ts";

// CLI command 이름 → MCP op다. 이 표 하나로 두 통로의 대응이 정해진다(cli#R1).
export const CLI_PROBLEM_OPS = {
  "problem list": "list",
  "problem show": "show",
  "problem snapshot": "snapshot",
  "problem fix-records": "fix_records",
  "problem summary": "summary",
  "problem bundle": "bundle",
  "problem more": "more",
  "problem record-fix": "record_fix",
  "problem test": "test",
} as const satisfies Record<string, ProblemOp>;

export type CliProblemOpName = keyof typeof CLI_PROBLEM_OPS;

function entry(
  name: CliProblemOpName,
  input: CommandEntry["input"],
): CommandEntry {
  // 표가 가리키는 route는 MCP와 같은 소유 route 표 값이다.
  return {
    name,
    input,
    monoRoute: MCP_PROBLEM_ROUTES.lophn_problem[CLI_PROBLEM_OPS[name]],
  };
}

export const PROBLEM_COMMANDS: readonly CommandEntry[] = [
  entry("problem list", cliProblemListSchema),
  entry("problem show", cliProblemShowSchema),
  entry("problem snapshot", cliProblemSnapshotSchema),
  entry("problem fix-records", cliProblemFixRecordsSchema),
  entry("problem summary", cliProblemSummarySchema),
  entry("problem bundle", cliProblemBundleSchema),
  entry("problem more", cliProblemMoreSchema),
  entry("problem record-fix", cliProblemRecordFixSchema),
  entry("problem test", cliProblemTestSchema),
  // 여러 읽기 route를 지나는 흐름이라 단일 route가 없다. 표 밖 op와 같은 실행 전 거절이 아니고
  // dispatch가 안전한 참조만 만든다.
  { name: "problem attachment open", input: cliProblemAttachmentOpenSchema },
  // 사람 전용이다. route가 없고 안내만 낸다(D27).
  { name: "problem report", input: cliProblemReportSchema },
  { name: "problem request-repair", input: cliProblemRequestRepairSchema },
  { name: "problem confirm", input: cliProblemConfirmSchema },
  { name: "problem dismiss", input: cliProblemDismissSchema },
];

// op마다 소유 입력이 가진 field다. 공통 option과 이름이 같아도 소유 field면 남긴다(list의 app 등).
const OWNED: Record<ProblemOp, Record<string, unknown>> = {
  list: {
    ...MCP_PROBLEM_ROUTES.lophn_problem.list.input.shape,
    handler: problemHandlerSchema,
  },
  show: MCP_PROBLEM_ROUTES.lophn_problem.show.input.shape,
  snapshot: MCP_PROBLEM_ROUTES.lophn_problem.snapshot.input.shape,
  fix_records: MCP_PROBLEM_ROUTES.lophn_problem.fix_records.input.shape,
  summary: MCP_PROBLEM_ROUTES.lophn_problem.summary.input.shape,
  bundle: MCP_PROBLEM_ROUTES.lophn_problem.bundle.input.shape,
  more: MCP_PROBLEM_ROUTES.lophn_problem.more.input.shape,
  record_fix: recordProblemFixToolInputSchema.shape,
  test: {
    ...MCP_PROBLEM_ROUTES.lophn_problem.test.input.shape,
    ticket_source: problemTicketSourceSchema,
  },
};

// 검사한 CLI 입력에서 공통 option(출력·연결·daemon·CAS·입력 source)을 떼면 MCP op 입력이다.
export function problemOpInput(
  name: CliProblemOpName,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const op = CLI_PROBLEM_OPS[name];
  const owned = OWNED[op];
  const body: Record<string, unknown> = { op };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && key in owned) body[key] = value;
  }
  return body;
}

export type ProblemRunDeps = Omit<ProblemOpDeps, "surface">;

export function isProblemOpName(name: string): name is CliProblemOpName {
  return Object.hasOwn(CLI_PROBLEM_OPS, name);
}

// command 하나를 실행한다. 결과 모양은 MCP와 같은 {summary, data, next}이고 isError면 CLI는
// 성공 exit로 처리하지 않는다(cli#R26).
export async function runProblem(
  name: CliProblemOpName | "problem attachment open",
  input: Record<string, unknown>,
  deps: ProblemRunDeps,
): Promise<Result<ProblemOpOutput, LophnError>> {
  if (name === "problem attachment open") {
    return ok(
      await openProblemAttachment(
        {
          problem: input.problem,
          snapshot: input.snapshot,
          item: input.item,
        },
        { client: deps.client, surface: "cli" },
      ),
    );
  }
  return ok(
    await runProblemOp(problemOpInput(name, input), {
      ...deps,
      surface: "cli",
    }),
  );
}

export const PROBLEM_HUMAN_ONLY = [
  "problem report",
  "problem request-repair",
  "problem confirm",
  "problem dismiss",
] as const;
export type ProblemHumanOnly = (typeof PROBLEM_HUMAN_ONLY)[number];

export function isProblemHumanOnly(name: string): name is ProblemHumanOnly {
  return (PROBLEM_HUMAN_ONLY as readonly string[]).includes(name);
}

function linkOf(
  prefix: "app" | "prb",
  value: unknown,
): Result<string, LophnError> {
  const id = idSchema(prefix).safeParse(value);
  if (!id.success) {
    return err({
      code: "invalid_input",
      message: prefix === "app"
        ? "대상 앱 ID가 필요하다(--app)"
        : "대상 문제 ID가 필요하다",
    });
  }
  return ok(decisionLink(id.data));
}

// 사람 전용 문제 command다. coding credential(연결 참조로 시작한 context)은 실행 전 거절이다. 사람의
// CLI도 feedback·수리 요청·확인·무시를 접수하지 않는다: 결정 화면 링크와 대기 사실만 내고 이 호출은
// 아무것도 만들거나 닫지 않았다(D27, cli#R7, R35). 요청만으로 coding agent를 띄우지도 않는다.
export function problemHumanOnly(
  name: ProblemHumanOnly,
  input: Record<string, unknown>,
  caller: { actor: "user" | "coding_agent"; connected: boolean },
): Result<ProblemOpOutput, LophnError> {
  if (caller.actor !== "user" || caller.connected) {
    return err({
      code: "forbidden",
      message: "이 command는 사람 전용이다",
    });
  }
  const none = {
    command: name,
    human_only: true,
    applied: false,
    window_opened: false,
    agent_started: false,
    problem_closed: false,
  };
  if (name === "problem report") {
    const link = linkOf("app", input.app);
    if (!link.ok) return link;
    return ok({
      summary:
        "문제 알리기는 사람이 shell의 문제 알리기 화면에서 쓴다. CLI는 feedback을 접수하지 않는다",
      data: {
        ...none,
        app: input.app,
        feedback_accepted: false,
        link: link.value,
      },
      next: [
        `사람이 ${link.value}에서 앱 화면을 열고 문제 알리기로 한 줄 증상을 쓴다. 이 호출은 아무것도 접수하지 않았다`,
      ],
      isError: true,
    });
  }
  const link = linkOf("prb", input.problem);
  if (!link.ok) return link;
  if (name === "problem request-repair") {
    return ok({
      summary:
        "수리 요청은 담당 agent의 ticket 준비 화면에서 이어진다. 요청은 coding agent를 띄우지 않고 문제도 닫지 않는다",
      data: { ...none, problem: input.problem, link: link.value },
      next: [
        `사람이 ${link.value}에서 담당 agent가 준비한 ticket을 보고 지정 ticket 지시 또는 [Start]를 고른다`,
      ],
      isError: true,
    });
  }
  if (name === "problem confirm") {
    return ok({
      summary:
        '사람 확인은 결정 화면에서만 한다. 확인은 "내가 확인함"이고 테스트 통과가 아니다. 지금은 대기 중이다',
      data: {
        ...none,
        problem: input.problem,
        link: link.value,
        human_confirmation: "pending",
      },
      next: [
        `사람이 ${link.value}에서 현재 문제와 근거를 보고 확인한다. 이 호출은 문제를 닫지 않았다`,
      ],
      isError: true,
    });
  }
  return ok({
    summary:
      "무시·false alarm은 사람이 결정 화면에서 정한다. 지금은 대기 중이고 문제는 그대로 열려 있다",
    data: {
      ...none,
      problem: input.problem,
      link: link.value,
      decision: "pending",
    },
    next: [
      `사람이 ${link.value}에서 사유를 보고 정한다. 이 호출은 문제를 닫지 않았다`,
    ],
    isError: true,
  });
}
