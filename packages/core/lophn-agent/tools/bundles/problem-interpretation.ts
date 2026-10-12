import { z } from "zod";
import { ok, type Result } from "../../../../base/mod.ts";
import {
  documentGet,
  documentRead,
} from "../../../../protocol/projects/mod.ts";
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

// 문제 해석 참조 설정 묶음(concern harness/tools R8). tool 하나는 소유 contract
// 하나다(problems/grouping의 LinkProblemInterpretation, ToolCall과 같은 transaction에서
// tx.call로 부른다). 연결은 해석 문서의 고정 version·절 참조뿐이고 문제 상태(claim·닫힘)는
// command가 바꾸지 않는다.
//
// version 존재·호출자 읽기 가능·절 존재는 command가 보지 않으므로 handler가 command
// 전에 읽어 확인한다(problems#T19에서 넘어온 것). reader는 documents의 get(version
// 존재·읽기 가능)과 document.read(ver·section 지정, 절 상태)를 부르는 통로로 만들고,
// 검사는 version이 readable이고 절이 found일 때만 통과한다: missing·unsupported·
// unverified 절은 invalid_input이고, 없거나 읽기 권한 밖 version은 not_found다.
// 없는 문제는 command가 not_found로 거절하고, 문제 표는 이 묶음이 읽지 않는다.

export const PROBLEM_INTERPRETATION_TOOL_REVISION = "2026-10-08";

const setInput = z.strictObject({
  problem: linkProblemInterpretationInputSchema.shape.problem,
  // 해석 문서의 ID다. version·절 참조는 이 해석 문서의 판을 가리킨다.
  document: documentGet.input.shape.document,
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

// 문서 reader다(problems/grouping#R13의 같은 검사를 documents 읽기 통로로 만든다).
// readable은 version이 그 문서에 있고 호출자가 읽을 수 있는지 documents get으로
// 확인하고, section은 document.read(ver·section 지정)가 낸 절 상태를 그대로 돌려준다.
// outline.document는 절을 고르지 않아 항상 whole을 낸다.
// 이 단계는 문서나 문제 상태를 바꾸지 않는다.
type LinkReader = {
  readable(version: string): Promise<Result<boolean>>;
  section(version: string, section: string): Promise<Result<string>>;
};

function readerOf(
  ports: ProblemInterpretationToolPorts,
  run: string,
  document: string,
): LinkReader {
  return {
    async readable(version) {
      const read = await ports.call(
        documentGet.name,
        { document, version },
        run,
      );
      if (!read.ok) {
        // 없는 version과 읽기 권한 밖은 같은 false다.
        return read.error.code === "not_found" ? ok(false) : read;
      }
      const versionId = (read.value as { version?: { id?: unknown } }).version
        ?.id;
      return ok(versionId === version);
    },
    async section(version, section) {
      const read = await ports.call(documentRead.name, {
        reference: { document, version, section: null },
        section,
      }, run);
      if (!read.ok) return read;
      const state = (read.value as { section_status?: unknown }).section_status;
      return ok(typeof state === "string" ? state : "missing");
    },
  };
}

// command 전 read 단계의 검사(problems#T19에서 넘어온 것).
// 연결할 version과 절이 readable이고 found일 때만 통과한다.
async function checkLink(
  reader: LinkReader,
  interpretation: { version: string; section: string | null } | null,
): Promise<Result<void>> {
  if (interpretation === null) return ok(undefined);
  const readable = await reader.readable(interpretation.version);
  if (!readable.ok) return readable;
  if (!readable.value) {
    return {
      ok: false,
      error: { code: "not_found", message: "없는 version이다" },
    };
  }
  if (interpretation.section === null) return ok(undefined);
  const state = await reader.section(
    interpretation.version,
    interpretation.section,
  );
  if (!state.ok) return state;
  if (state.value !== "found") {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: `해석 절을 연결할 수 없다: ${state.value}`,
      },
    };
  }
  return ok(undefined);
}

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
      const reader = readerOf(ports, credential.run, value.document);
      const checked = await checkLink(reader, value.interpretation);
      if (!checked.ok) return checked;
      // compare는 {problem_seq, previous}다(problems#T19에서 넘어온 것). 문제의
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
