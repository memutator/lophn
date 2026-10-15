import { z } from "zod";
import { ok, type Result } from "../../../../base/mod.ts";
import {
  getProblem,
  interpretationLinkInputSchema,
  linkProblemInterpretation,
  linkProblemInterpretationInputSchema,
} from "../../../../protocol/problems/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { fitJson } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  toolIdempotencyKey,
} from "./common.ts";

// 문제 해석 참조 설정 묶음(concern harness/tools). tool 하나는 소유 contract
// 하나다(problems/grouping의 LinkProblemInterpretation, ToolCall과 같은 transaction에서
// tx.call로 부른다). 연결은 해석 문서의 고정 version·절 참조뿐이고 문제 상태(claim·닫힘)는
// command가 바꾸지 않는다.
//
// 없는 문제는 command가 not_found로 거절하고, 문제 표는 이 묶음이 읽지 않는다.

export const PROBLEM_INTERPRETATION_TOOL_REVISION = "2026-10-08";

const setInput = z.strictObject({
  problem: linkProblemInterpretationInputSchema.shape.problem,
  interpretation: interpretationLinkInputSchema.nullable(),
  // 연결의 해설이다. 이전 참조와 다음 참조가 왜 연결되는지 남긴다.
  explanation: z.string().regex(/\S/).max(500),
});

export const problemSetInterpretationTool = defineBuiltin(
  PROBLEM_INTERPRETATION_TOOL_REVISION,
  "problem.set_interpretation",
  "Set one problem's interpretation reference: the fixed version and section of an interpretation document that explains the cause. This changes the reference only, not the problem status, claim or closure.",
  setInput,
  linkProblemInterpretation.name,
  {
    effect: "write",
    scopeCheck: "problems of the app the assignment serves",
    reversible: true,
    idempotent: true,
  },
);

export const PROBLEM_INTERPRETATION_TOOLS: readonly ToolDefinition[] = [
  problemSetInterpretationTool,
];
export const PROBLEM_INTERPRETATION_TOOL_NAMES: readonly string[] =
  PROBLEM_INTERPRETATION_TOOLS.map((tool) => tool.name);

export type ProblemInterpretationToolPorts = ContractCall;

function fitted(summary: string, value: Record<string, unknown>): ToolResult {
  const limited = fitJson(value, []);
  return {
    status: "success",
    summary,
    content: limited.content as ToolResult["content"],
    complete: limited.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

export function createProblemInterpretationToolHandlers(
  ports: ProblemInterpretationToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set(
    problemSetInterpretationTool.name,
    async (input, credential): Promise<Result<ToolResult>> => {
      const value = input as z.infer<typeof setInput>;
      // compare는 {problem_seq, previous}다. 문제의
      // 현재 해석 참조는 problems.get으로 읽어 compare.previous에 싣는다.
      const compare = await previousOf(ports, value, credential);
      if (!compare.ok) return compare;
      const key = await toolIdempotencyKey(
        problemSetInterpretationTool.name,
        input,
        credential,
      );
      const sent = await ports.call(
        problemSetInterpretationTool.contract,
        { problem: value.problem, interpretation: value.interpretation },
        credential.run,
        { compare: compare.value, idempotency_key: key },
      );
      if (!sent.ok) return sent;
      return ok(fitted(value.explanation, {
        ...(sent.value as Record<string, unknown>),
      }));
    },
  );
  return handlers;
}

// 문제의 현재 해석 참조와 seq다. 없는 문제는 command가 not_found로 거절한다.
async function previousOf(
  ports: ProblemInterpretationToolPorts,
  value: z.infer<typeof setInput>,
  credential: RunCredential,
): Promise<Result<{ problem_seq: string; previous: unknown }>> {
  const read = await ports.call(getProblem.name, {
    problem: value.problem,
  }, credential.run);
  if (!read.ok) return read;
  const body = read.value as {
    problem?: { seq?: unknown; interpretation?: unknown } | undefined;
    as_of_seq?: unknown;
  };
  if (
    body.problem === undefined || typeof body.problem.seq !== "string" ||
    typeof body.as_of_seq !== "string"
  ) {
    return ok({ problem_seq: "0", previous: null });
  }
  return ok({
    problem_seq: body.problem.seq,
    previous: body.problem.interpretation ?? null,
  });
}
