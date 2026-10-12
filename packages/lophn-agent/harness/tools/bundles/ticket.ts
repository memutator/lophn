import { z } from "zod";
import { ok, type Result } from "../../../../base/mod.ts";
import {
  ticketCreate,
  ticketCreateInputSchema,
  ticketList,
  ticketListInputSchema,
  ticketMakeReady,
  ticketMakeReadyInputSchema,
  ticketShow,
  ticketShowInputSchema,
  ticketStateSchema,
} from "../../../../protocol/coding-agent/mod.ts";
import { readCursorSchema } from "../../../../protocol/projects/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { fitJson, PAGE_SIZE } from "../result.ts";
import type { ToolDefinition } from "../registry.ts";
import type { RunCredential, ToolHandler } from "../work.ts";
import {
  type ContractCall,
  defineBuiltin,
  type DefineOptions,
  READ,
  toolIdempotencyKey,
} from "./common.ts";
import { bodyOf, pageThrough, scopeOf } from "./paging.ts";

// ticket 묶음(concern harness/tools R9). 읽기(`ticket.list`, `ticket.read`), 생성(`ticket.create`),
// 확인 필요 ticket의 실행 준비 전환(`ticket.make_ready`)만 있다. claim·연장·완료 보고·release 연결·
// 취소·[Start]는 정의 자체가 없다(coding-agent/mcp-server와 사람 경로). 앱 하나에 묶인 자격은 소유
// contract(coding-agent/tickets)가 그 앱의 ticket만 보여 주고 다른 앱은 없는 대상과 같은 답이다.

export const TICKET_TOOL_REVISION = "2026-10-07";

function define(
  name: string,
  description: string,
  input: z.ZodType,
  contract: string,
  options: DefineOptions,
): ToolDefinition {
  return defineBuiltin(
    TICKET_TOOL_REVISION,
    name,
    description,
    input,
    contract,
    options,
  );
}

const create = ticketCreateInputSchema.shape;
const ready = ticketMakeReadyInputSchema.shape;

// readiness는 모델이 고르지 않는다. 근거·채택 질문·실행 가능한 acceptance check가 모두 있고 모델이
// 따로 적은 확인할 것이 없을 때만 실행 준비다(roles/app-engineer#R17). 모자란 것은 handler가
// 확인 필요 목록에 적는다.
export const TICKET_EXTRA_NEEDS_MAX = 9;

const createInput = z.strictObject({
  app: create.app,
  kind: create.kind,
  title: create.title,
  what: create.what,
  why: create.why,
  references: create.references,
  adoption_questions: create.adoption_questions,
  conditions: create.conditions,
  inspect: create.inspect,
  preserve: create.preserve,
  problems: create.problems,
  needs: create.needs.max(TICKET_EXTRA_NEEDS_MAX),
});

const readInput = ticketShowInputSchema;
const listInput = z.strictObject({
  app: ticketListInputSchema.shape.app,
  state: ticketStateSchema.optional(),
  cursor: readCursorSchema.optional(),
});
const makeReadyInput = z.strictObject({
  ticket: ready.ticket,
  base_revision: ready.base_revision,
  references: ready.references,
  adoption_questions: ready.adoption_questions,
  conditions: ready.conditions,
  inspect: ready.inspect,
  preserve: ready.preserve,
});

const OWN = "tickets of the app the assignment serves";

export const ticketListTool = define(
  "ticket.list",
  "List tickets, optionally of one app or one state: id, app, kind, title, state, readiness, and problem count. This changes nothing.",
  listInput,
  ticketList.name,
  { ...READ, scopeCheck: OWN },
);
export const ticketReadTool = define(
  "ticket.read",
  "Read one ticket: what and why, readiness and what still needs confirmation, fixed references, adoption questions, acceptance checks, and its revision. This changes nothing and starts nothing.",
  readInput,
  ticketShow.name,
  { ...READ, scopeCheck: OWN },
);
// 되돌릴 수 있는 변경이다: claim 전의 ticket은 사람이 취소한다(소유 contract가 판정). approval은 묻지
// 않는다(harness/tool-judgment#R10).
export const ticketCreateTool = define(
  "ticket.create",
  "Create a ticket for a coding request or feedback of one app. Evidence, adoption questions or an executable acceptance check that is missing leaves the ticket as needs_confirmation with the list of what to confirm; it never starts anything.",
  createInput,
  ticketCreate.name,
  {
    effect: "write",
    scopeCheck: "the app the assignment serves",
    reversible: true,
    idempotent: true,
  },
);
export const ticketMakeReadyTool = define(
  "ticket.make_ready",
  "Fill the evidence, adoption questions and acceptance checks of a ticket that needs confirmation and mark it ready. The base revision is the one read from the ticket. It does not claim, start, report or cancel.",
  makeReadyInput,
  ticketMakeReady.name,
  {
    effect: "write",
    scopeCheck: "the app the assignment serves",
    reversible: true,
    idempotent: false,
  },
);

export const TICKET_READ_TOOLS: readonly ToolDefinition[] = [
  ticketListTool,
  ticketReadTool,
];
export const TICKET_WRITE_TOOLS: readonly ToolDefinition[] = [
  ticketCreateTool,
  ticketMakeReadyTool,
];
export const TICKET_TOOLS: readonly ToolDefinition[] = [
  ...TICKET_READ_TOOLS,
  ...TICKET_WRITE_TOOLS,
];
export const TICKET_READ_TOOL_NAMES: readonly string[] = TICKET_READ_TOOLS.map(
  (tool) => tool.name,
);
export const TICKET_WRITE_TOOL_NAMES: readonly string[] = TICKET_WRITE_TOOLS
  .map((tool) => tool.name);

export type TicketToolPorts = ContractCall;

type Condition = { kind: string; problem?: string };

// 실행 준비에 모자란 것이다(coding-agent/tickets R8·R9의 같은 규칙을 입력에서 미리 읽는다. 소유
// contract가 전환 때 다시 검사한다). 모자라면 ticket을 버리지 않고 확인 필요로 남긴다.
export function missingForReady(input: {
  kind: "implementation" | "repair";
  problems: readonly string[];
  references: readonly unknown[];
  adoption_questions: readonly unknown[];
  conditions: readonly Condition[];
}): string[] {
  const missing: string[] = [];
  if (input.references.length === 0) {
    missing.push("fixed design evidence is missing");
  }
  if (input.adoption_questions.length === 0) {
    missing.push("an adopted decision question is missing");
  }
  const kinds = new Set(input.conditions.map((condition) => condition.kind));
  if (!kinds.has("app_test") || !kinds.has("test_command")) {
    missing.push("an executable acceptance check is missing");
  }
  if (input.kind === "repair") {
    if (!kinds.has("problems_closed")) {
      missing.push("the problems_closed check is missing");
    }
    for (const problem of input.problems) {
      const covered = input.conditions.some((condition) =>
        condition.problem === problem &&
        (condition.kind === "reproduction_test" ||
          condition.kind === "human_confirmation")
      );
      if (!covered) {
        missing.push(`no reproduction or human confirmation for ${problem}`);
      }
    }
  }
  return missing;
}

type TicketRecord = Record<string, unknown> & {
  claim?: { expires_at?: string } | null;
};

function fitted(summary: string, value: Record<string, unknown>): ToolResult {
  const limited = fitJson(value, ["conditions", "references"]);
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

export function createTicketToolHandlers(
  ports: TicketToolPorts,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set(ticketListTool.name, (input, credential) => {
    const { cursor, ...rest } = input as {
      cursor?: string;
      app?: string;
      state?: string;
    };
    return pageThrough(
      ports,
      "tickets listed",
      ticketListTool.contract,
      scopeOf(ticketListTool.name, rest),
      cursor,
      { ...rest, limit: PAGE_SIZE },
      ["tickets"],
      credential,
    );
  });

  // 읽기 결과에서 claim한 coding agent의 연결 정보는 뺀다. 남은 기한만 보인다.
  handlers.set(
    ticketReadTool.name,
    async (input, credential): Promise<Result<ToolResult>> => {
      const read = await ports.call(
        ticketReadTool.contract,
        input,
        credential.run,
      );
      if (!read.ok) return read;
      const body = bodyOf(read.value);
      const ticket = body["ticket"] as TicketRecord;
      return ok(fitted("ticket read", {
        ticket: {
          ...ticket,
          claim: ticket.claim === null || ticket.claim === undefined
            ? null
            : { expires_at: ticket.claim.expires_at ?? null },
        },
        as_of_seq: body.as_of_seq ?? null,
      }));
    },
  );

  // 변경의 공통 길이다. 같은 ToolCall의 재전송은 같은 key라 ticket을 하나만 만든다. 응답이 없으면
  // 반영 여부를 알 수 없으므로 완료도 실패도 아닌 효과 불명확으로 돌려준다.
  async function change(
    tool: ToolDefinition,
    input: unknown,
    body: Record<string, unknown>,
    compare: Record<string, unknown>,
    summary: string,
    credential: RunCredential,
  ): Promise<Result<ToolResult>> {
    const key = await toolIdempotencyKey(tool.name, input, credential);
    const sent = await ports.call(tool.contract, body, credential.run, {
      compare,
      idempotency_key: key,
    });
    if (!sent.ok) {
      if (sent.error.code === "unavailable") {
        return ok({
          status: "uncertain",
          summary: "the change may or may not have been confirmed",
          content: { accepted: null, confirmed: false, idempotency_key: key },
          complete: true,
          source: null,
          continuation: null,
          pending: ["change_confirmation"],
        });
      }
      return sent;
    }
    return ok(fitted(summary, { ...(sent.value as Record<string, unknown>) }));
  }

  handlers.set(ticketCreateTool.name, async (input, credential) => {
    const { needs: extra, ...rest } = input as z.infer<typeof createInput>;
    const needs = [...missingForReady(rest), ...extra];
    const confirming = needs.length > 0;
    const created = await change(
      ticketCreateTool,
      input,
      {
        ...rest,
        readiness: confirming ? "needs_confirmation" : "ready",
        needs,
      },
      {},
      confirming
        ? "ticket created, it needs confirmation before it is ready"
        : "ticket created and ready",
      credential,
    );
    if (!created.ok || !confirming || created.value.status !== "success") {
      return created;
    }
    return ok({
      ...created.value,
      content: {
        ...(created.value.content as object),
        needs,
      } as ToolResult["content"],
    });
  });

  handlers.set(ticketMakeReadyTool.name, (input, credential) => {
    const { base_revision: base, ...rest } = input as z.infer<
      typeof makeReadyInput
    >;
    return change(
      ticketMakeReadyTool,
      input,
      { ...rest, base_revision: base },
      { base_revision: base },
      "ticket is ready",
      credential,
    );
  });
  return handlers;
}
