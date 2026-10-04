import { z } from "zod";
import { getProblem, getSnapshot, listProblems } from "../problems/mod.ts";
import { listProblemFixes, recordProblemFix } from "../problems/fixes.ts";
import { requestTest } from "../problems/tests.ts";
import {
  repairContextBundle,
  repairContextMore,
  repairContextSummary,
} from "./repair-context.ts";
import { readOnlyHint, type ScopeMark, type Toolset } from "./output.ts";
import { cliCommonSchema } from "./cli-core.ts";

// tool 입력은 owner route 입력을 다시 적지 않고 고른다(mcp-core·mcp-decisions 같은
// 모양). state·handler 같은 filter 이름도 owner 것이 그대로다.
const problemInput = z.discriminatedUnion("op", [
  listProblems.input.extend({ op: z.literal("list") }),
  getProblem.input.extend({ op: z.literal("show") }),
  getSnapshot.input.extend({ op: z.literal("snapshot") }),
  listProblemFixes.input.extend({ op: z.literal("fix_records") }),
  repairContextSummary.input.extend({ op: z.literal("summary") }),
  repairContextBundle.input.extend({ op: z.literal("bundle") }),
  repairContextMore.input.extend({ op: z.literal("more") }),
  recordProblemFix.input.extend({ op: z.literal("record_fix") }),
  requestTest.input.extend({ op: z.literal("test") }),
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
) => {
  const extensible = input as z.ZodObject<T> & {
    safeExtend: (schema: Record<string, z.ZodType>) => z.ZodObject<T>;
  };
  return extensible.safeExtend({ command: z.literal(command), ...common });
};

// MCP가 고른 op 밖의 command를 만들지 않는다(cli-decisions 같은 모양). 위치 인자가
// 없고 선택값만 있다.
export const cliProblemListSchema = withCommon(
  "problem list",
  listProblems.input,
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
  recordProblemFix.input,
);
export const cliProblemTestSchema = withCommon(
  "problem test",
  requestTest.input,
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
