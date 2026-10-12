import { z } from "zod";
import { getProblem, getSnapshot, listProblems } from "../problems/mod.ts";
import {
  listProblemFixes,
  recordProblemFix,
  recordProblemFixToolInputSchema,
} from "../problems/fixes.ts";
import { idSchema, seqSchema } from "../platform/mod.ts";
import { requestTest } from "../problems/tests.ts";
import {
  repairContextBundle,
  repairContextMore,
  repairContextSummary,
} from "./repair-context.ts";
import { readOnlyHint, type ScopeMark, type Toolset } from "./output.ts";
import { cliCommonSchema } from "./cli-core.ts";

// 처리 대상이다. 사람이 조정할 문제(선언의 fixer가 user)와 coding agent가 고칠 문제를 나눈다.
// owner list read에는 이 filter가 없어 통로가 문제 요약의 next_action으로 가른다(mcp#R24).
export const PROBLEM_HANDLERS = ["user", "coding_agent"] as const;
export const problemHandlerSchema = z.enum(PROBLEM_HANDLERS);

// record_fix·test의 근거 ticket claim이다. 지정 ticket의 현재 claim이 아니면 쓰지 않는다
// (mcp#R25, cli#R34). 문제 직접 claim·별도 시도 단계는 입력에 없다.
export const problemTicketSourceSchema = z.strictObject({
  ticket: idSchema("tkt"),
  claim_seq: seqSchema,
});
export type ProblemTicketSource = z.infer<typeof problemTicketSourceSchema>;

const listExtra = { handler: problemHandlerSchema.optional() };
const testExtra = { ticket_source: problemTicketSourceSchema };

// tool 입력은 owner route 입력을 다시 적지 않고 고른다(mcp-core·mcp-decisions 같은
// 모양). state 같은 filter 이름도 owner 것이 그대로다. record_fix는 summary 본문을 받고
// 통로가 준비 증거를 만든다(ticket report와 같은 모양). owner 입력(problems/tests)이
// ticket_source를 optional로 둔 additive PR(#456)과 달리 tool 입력은 필수로 묶는다(main
// mcp-problem과 같다). refine 뒤 key 덮기는 extend가 거절하므로 안전 확장(safeExtend)으로 심는다.
const problemTestInput = requestTest.input.safeExtend({
  ...testExtra,
  op: z.literal("test"),
});
const problemInput = z.discriminatedUnion("op", [
  listProblems.input.extend({ ...listExtra, op: z.literal("list") }),
  getProblem.input.extend({ op: z.literal("show") }),
  getSnapshot.input.extend({ op: z.literal("snapshot") }),
  listProblemFixes.input.extend({ op: z.literal("fix_records") }),
  repairContextSummary.input.extend({ op: z.literal("summary") }),
  repairContextBundle.input.extend({ op: z.literal("bundle") }),
  repairContextMore.input.extend({ op: z.literal("more") }),
  recordProblemFixToolInputSchema.extend({ op: z.literal("record_fix") }),
  problemTestInput,
]);

export const MCP_PROBLEM_TOOLS = [
  {
    name: "lophn_problem",
    toolset: "app",
    scope: "S/A",
    input: problemInput,
    ops: [
      "list",
      "show",
      "snapshot",
      "fix_records",
      "summary",
      "bundle",
      "more",
      "record_fix",
      "test",
    ],
  },
] as const satisfies readonly {
  name: string;
  toolset: Toolset;
  // architecture 표는 S/A로 쓴다. connection scope(S)와 app 대상(A) 검사가 둘 다 붙는다.
  scope: ScopeMark | "S/A";
  input: z.ZodType;
  ops: readonly string[];
}[];

export type McpProblemToolName = (typeof MCP_PROBLEM_TOOLS)[number]["name"];

export const MCP_PROBLEM_ROUTES = {
  lophn_problem: {
    list: listProblems,
    show: getProblem,
    snapshot: getSnapshot,
    fix_records: listProblemFixes,
    summary: repairContextSummary,
    bundle: repairContextBundle,
    more: repairContextMore,
    record_fix: recordProblemFix,
    test: requestTest,
  },
} as const;

export function mcpProblemTool(name: string) {
  const tool = MCP_PROBLEM_TOOLS.find((item) => item.name === name);
  if (!tool) return undefined;
  return { ...tool, readOnlyHint: readOnlyHint(tool.name) };
}

const common = cliCommonSchema.shape;
// refine을 가진 owner 입력(record_fix·test 등)은 extend가 key를 덮지 못한다.
// 공통 field가 겹치지 않으므로 refine 뒤에도 안전 확장(safeExtend)을 그대로 쓴다.
const withCommon = <T extends z.ZodRawShape>(
  command: string,
  input: z.ZodObject<T>,
  extra: Record<string, z.ZodType> = {},
) => {
  const extensible = input as z.ZodObject<T> & {
    safeExtend: (schema: Record<string, z.ZodType>) => z.ZodObject<T>;
  };
  return extensible.safeExtend({
    ...extra,
    command: z.literal(command),
    ...common,
  });
};

// MCP가 고른 op 밖의 command를 만들지 않는다(cli-decisions 같은 모양). 위치 인자가
// 없고 선택값만 있다.
export const cliProblemListSchema = withCommon(
  "problem list",
  listProblems.input,
  listExtra,
);
export const cliProblemShowSchema = withCommon(
  "problem show",
  getProblem.input,
);
export const cliProblemSnapshotSchema = withCommon(
  "problem snapshot",
  getSnapshot.input,
);
export const cliProblemFixRecordsSchema = withCommon(
  "problem fix-records",
  listProblemFixes.input,
);
export const cliProblemSummarySchema = withCommon(
  "problem summary",
  repairContextSummary.input,
);
export const cliProblemBundleSchema = withCommon(
  "problem bundle",
  repairContextBundle.input,
);
export const cliProblemMoreSchema = withCommon(
  "problem more",
  repairContextMore.input,
);
// coding 쓰기는 현재 ticket·claim_seq 필수다(repair-context#R25).
export const cliProblemRecordFixSchema = withCommon(
  "problem record-fix",
  recordProblemFixToolInputSchema,
);
export const cliProblemTestSchema = withCommon(
  "problem test",
  requestTest.input,
  testExtra,
);

// 허용된 첨부의 로컬 열기다. 운영 경로 대신 안전한 참조를 받고 scope·redaction 검사는
// host에 남는다(architecture 5.4).
export const cliProblemAttachmentOpenSchema = withCommon(
  "problem attachment open",
  z.strictObject({
    problem: getProblem.input.shape.problem,
    snapshot: getSnapshot.input.shape.snapshot,
    item: getSnapshot.input.shape.item,
  }),
);

// CLI는 feedback을 접수하지 않는다(plan/coding-agent D27). report는 shell의 문제
// 알리기 화면 안내, request-repair는 담당 agent의 ticket 준비 화면 링크, confirm·dismiss는
// 결정 화면 링크와 대기 사실만 낸다. coding credential은 거절이다.
export const cliProblemReportSchema = withCommon(
  "problem report",
  z.strictObject({
    app: getProblem.output.shape.problem.shape.app,
    symptom: z.string().min(1),
  }),
);
export const cliProblemRequestRepairSchema = withCommon(
  "problem request-repair",
  z.strictObject({
    problem: getProblem.input.shape.problem,
  }),
);
export const cliProblemConfirmSchema = withCommon(
  "problem confirm",
  z.strictObject({
    problem: getProblem.input.shape.problem,
    evidence: z.string().min(1),
  }),
);
export const cliProblemDismissSchema = withCommon(
  "problem dismiss",
  z.strictObject({
    problem: getProblem.input.shape.problem,
    reason: z.string().min(1),
    false_alarm: z.boolean().optional(),
  }),
);

export const CLI_PROBLEM_NAMES = [
  "problem list",
  "problem show",
  "problem snapshot",
  "problem fix-records",
  "problem summary",
  "problem bundle",
  "problem more",
  "problem record-fix",
  "problem test",
  "problem attachment open",
  "problem report",
  "problem request-repair",
  "problem confirm",
  "problem dismiss",
] as const;

export type CliProblemName = (typeof CLI_PROBLEM_NAMES)[number];

export const CLI_PROBLEM_COMMANDS = [
  cliProblemListSchema,
  cliProblemShowSchema,
  cliProblemSnapshotSchema,
  cliProblemFixRecordsSchema,
  cliProblemSummarySchema,
  cliProblemBundleSchema,
  cliProblemMoreSchema,
  cliProblemRecordFixSchema,
  cliProblemTestSchema,
  cliProblemAttachmentOpenSchema,
  cliProblemReportSchema,
  cliProblemRequestRepairSchema,
  cliProblemConfirmSchema,
  cliProblemDismissSchema,
] as const;
