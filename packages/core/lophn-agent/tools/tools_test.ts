import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import type { Result } from "../../../base/mod.ts";
import { ok } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import {
  BUILTIN_TOOLS,
  checkInput,
  executeTool,
  findTool,
  FORBIDDEN_TOOL_NAMES,
  limitJson,
  limitText,
  listTools,
  PAGE_SIZE,
  pageOf,
  type RunCredential,
  TEXT_MAX_BYTES,
  TEXT_MAX_LINES,
  type ToolDefinition,
  unchanged,
} from "./mod.ts";

// harness 값 타입만 선언한다. platform ledger 모듈을 type-check하지 않기 위해서다.
type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
};
type CommandSuccess = { result: unknown; replayed: boolean };
type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<unknown>>;
  close(): Promise<void>;
};
async function createLedgerHarness(options: {
  registrationModules: readonly URL[];
  credentials: readonly AuthenticatedContext[];
}): Promise<Result<LedgerHarness>> {
  const specifier = "../../testing/ledger.ts";
  const harness = await import(specifier);
  return harness.createLedgerHarness(options);
}

const registration = new URL(
  "./tools_registration_test.ts",
  import.meta.url,
);

const operations = [
  "RecordToolRequest",
  "DecideToolCall",
  "StartToolCall",
  "FinishToolCall",
  "RecordReadToolCall",
  "SupplementToolCall",
  "ReadToolCall",
  "ListToolCalls",
  "CommandResult",
];

function credential(actor = "machine"): AuthenticatedContext {
  return {
    actor,
    principal: "test-runtime",
    credential_ref: `test:test-runtime:${actor}`,
    scope: { operations, targets: {} },
    conditions: {},
  };
}

const machine = credential();
const user = credential("user");

let idempotency = 0;

function envelope(
  command: string,
  input: unknown,
  compare: unknown = {},
): CommandEnvelope {
  idempotency += 1;
  return {
    command,
    input,
    compare,
    idempotency_key: `k-${idempotency}`,
    prepared: [],
  };
}

function keep<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  assert(!result.ok, "expected a rejection");
  assertEquals(result.error.code, expected);
}

const HASH = "a".repeat(64);
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const CALL = "mcl_01arz3ndektsv4rrffq69g5fav";

function requestInput(over: Record<string, unknown> = {}) {
  return {
    id: "tcl_01arz3ndektsv4rrffq69g5fav",
    run: RUN,
    model_call: CALL,
    response_key: "call-1",
    response_order: 0,
    tool: "document.read",
    definition_revision: "2026-01-01",
    effect: "read",
    confirm: false,
    extension: null,
    input: HASH,
    retry_of: null,
    attempt: 0,
    ...over,
  };
}

async function harness(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [machine, user],
  });
  return keep(opened);
}

Deno.test("lophn-agent/harness/tools#R1: 금지 통로는 내장 목록에 없다", () => {
  const names = new Set(BUILTIN_TOOLS.map((tool) => tool.name));
  for (const forbidden of FORBIDDEN_TOOL_NAMES) {
    assertEquals(names.has(forbidden), false, forbidden);
  }
  const listed = listTools(
    {
      builtin: BUILTIN_TOOLS,
      app: [],
      external: [{ ...sample("web.search"), origin: "external" }],
    },
    { presetTools: ["web.search"], roleTools: ["web.search"] },
  );
  assertEquals(listed.map((tool) => tool.name), []);
});

Deno.test("lophn-agent/harness/tools#R2: 정의 하나가 목록과 실행에 함께 쓰인다", async () => {
  const definition = sample("document.read");
  const listed = listTools(
    { builtin: [definition], app: [], external: [] },
    { presetTools: ["document.read"], roleTools: ["document.read"] },
  );
  const found = findTool(listed, "document.read");
  assert(found !== undefined);
  assertEquals(found.input, definition.input);
  let called = 0;
  const outcome = await executeTool(
    {
      listed,
      handlers: new Map([[
        "document.read",
        () => {
          called += 1;
          return Promise.resolve(ok(successResult("success")));
        },
      ]]),
      credential: runCredential(["document.read"]),
    },
    "document.read",
    { target: "doc-1" },
  );
  assertEquals(called, 1);
  assertEquals(outcome.executed, true);
  assertEquals(outcome.definitionRevision, definition.revision);
});

Deno.test("lophn-agent/harness/tools#R3: 모르는 필드·숫자 문자열·허용 밖 값은 거절하고 변환하지 않는다", async () => {
  const schema = z.strictObject({
    count: z.number().int(),
    kind: z.enum(["a", "b"]),
  });
  const extra = checkInput(schema, { count: 1, kind: "a", extra: true });
  assert(!extra.ok);
  assertEquals(extra.error.code, "invalid_input");
  const numeric = checkInput(schema, { count: "1", kind: "a" });
  assert(!numeric.ok);
  const outside = checkInput(schema, { count: 1, kind: "c" });
  assert(!outside.ok);
  const valid = checkInput(schema, { count: 1, kind: "a" });
  assert(valid.ok);
  assertEquals(unchanged({ count: 1, kind: "a" }, valid.value), true);

  let called = 0;
  const outcome = await executeTool(
    {
      listed: [sample("document.read", schema)],
      handlers: new Map([[
        "document.read",
        () => {
          called += 1;
          return Promise.resolve(ok(successResult("success")));
        },
      ]]),
      credential: runCredential(["document.read"]),
    },
    "document.read",
    { count: "1", kind: "a" },
  );
  assertEquals(called, 0);
  assertEquals(outcome.executed, false);
  assertEquals(outcome.outcome.code, "invalid_input");
});

Deno.test("lophn-agent/harness/tools#R4: 효과 선언 없는 tool은 제공하지 않고 조회 기록은 read다", () => {
  const read = sample("document.list");
  const write = {
    ...sample("document.save_version"),
    effect: "write" as const,
  };
  const external = { ...sample("notes.fetch"), effect: "external" as const };
  const listed = listTools(
    { builtin: [read, write], app: [], external: [external] },
    {
      presetTools: ["document.list", "document.save_version", "notes.fetch"],
      roleTools: ["document.list", "document.save_version", "notes.fetch"],
    },
  );
  assertEquals(listed.map((tool) => [tool.name, tool.effect]), [
    ["document.list", "read"],
    ["document.save_version", "write"],
    ["notes.fetch", "external"],
  ]);
});

Deno.test("lophn-agent/harness/tools#R5: 목록은 preset과 역할 상한의 교집합이고 내장·앱·외부 순서를 유지한다", () => {
  const source = {
    builtin: [sample("document.read"), sample("ticket.create")],
    app: [sample("app.note")],
    external: [sample("ext_notes_read")],
  };
  const scope = {
    presetTools: [
      "document.read",
      "app.note",
      "ext_notes_read",
      "ticket.create",
    ],
    roleTools: ["document.read", "app.note", "ext_notes_read"],
  };
  const first = listTools(source, scope).map((tool) => tool.name);
  const second = listTools(source, scope).map((tool) => tool.name);
  assertEquals(first, ["document.read", "app.note", "ext_notes_read"]);
  assertEquals(second, first);
  assertEquals(
    listTools(source, { presetTools: null, roleTools: scope.roleTools }),
    [],
  );
});

Deno.test("lophn-agent/harness/tools#R11: 결과는 성공·실패·미실행·불명확을 구별한다", async () => {
  const kinds = ["success", "failure", "not_executed", "uncertain"] as const;
  for (const kind of kinds) {
    const outcome = await executeTool(
      {
        listed: [sample("document.read")],
        handlers: new Map([[
          "document.read",
          () => Promise.resolve(ok({ ...successResult(kind), status: kind })),
        ]]),
        credential: runCredential(["document.read"]),
      },
      "document.read",
      { target: "doc-1" },
    );
    assertEquals(outcome.result.status, kind);
    assertEquals(outcome.outcome.kind, kind);
  }
});

Deno.test("lophn-agent/harness/tools#R12: 실패 종류를 구별하고 범위 밖은 없는 대상과 같다", async () => {
  const cases: Array<[string, string]> = [
    ["invalid_input", "invalid_input"],
    ["forbidden", "forbidden"],
    ["not_found", "not_found"],
    ["conflict", "conflict"],
    ["unavailable", "unavailable"],
  ];
  for (const [handlerCode, expected] of cases) {
    const outcome = await executeTool(
      {
        listed: [sample("document.read")],
        handlers: new Map([[
          "document.read",
          () =>
            Promise.resolve({
              ok: false as const,
              error: {
                code: handlerCode as "not_found",
                message: "secret doc-9 exists",
              },
            }),
        ]]),
        credential: runCredential(["document.read"]),
      },
      "document.read",
      { target: "doc-9" },
    );
    assertEquals(outcome.outcome.code, expected, handlerCode);
    assertEquals(outcome.result.summary.includes("secret"), false);
    assertEquals(outcome.result.summary.includes("exists"), false);
  }
  const missing = await executeTool(
    {
      listed: [sample("document.read")],
      handlers: new Map(),
      credential: runCredential([]),
    },
    "shell.exec",
    {},
  );
  assertEquals(missing.outcome.code, "not_found");
  assertEquals(missing.executed, false);
});

Deno.test("lophn-agent/harness/tools#R13: 45개 목록은 20·20·5로 읽고 조건을 유지한다", () => {
  const items = Array.from({ length: 45 }, (_, index) => `item-${index}`);
  const first = pageOf(items, null);
  assertEquals(first.items.length, PAGE_SIZE);
  assertEquals(first.hasMore, true);
  const second = pageOf(items, first.nextCursor);
  assertEquals(second.items.length, PAGE_SIZE);
  assertEquals(second.items[0], "item-20");
  const third = pageOf(items, second.nextCursor);
  assertEquals(third.items.length, 5);
  assertEquals(third.hasMore, false);
  const seen = [...first.items, ...second.items, ...third.items];
  assertEquals(seen, items);
});

Deno.test("lophn-agent/harness/tools#R14: 24 KiB·300줄 상한에서 문서 앞·log 뒤를 남기고 JSON·한글을 깨지 않는다", () => {
  const longLine = "가".repeat(TEXT_MAX_BYTES);
  const head = limitText(longLine, "head");
  assertEquals(head.complete, false);
  assert(new TextEncoder().encode(head.text).byteLength <= TEXT_MAX_BYTES);
  assertEquals(head.text.includes("�"), false);
  assert(head.originalBytes > TEXT_MAX_BYTES);

  const lines = Array.from(
    { length: TEXT_MAX_LINES + 40 },
    (_, index) => `l${index}`,
  );
  const document = limitText(lines.join("\n"), "head");
  assertEquals(document.text.startsWith("l0\n"), true);
  assertEquals(document.complete, false);
  const log = limitText(lines.join("\n"), "tail");
  assertEquals(log.text.endsWith(`l${TEXT_MAX_LINES + 39}`), true);

  const small = { name: "문서", n: 1 };
  const kept = limitJson(small);
  assertEquals(kept.complete, true);
  assertEquals(kept.content, small);
  const huge = { body: "x".repeat(TEXT_MAX_BYTES + 10) };
  const dropped = limitJson(huge);
  assertEquals(dropped.complete, false);
  assertEquals(dropped.content, null);
});

Deno.test("lophn-agent/harness/tools#R15: 요청·판정·시작·마침이 한 번씩 기록되고 같은 요청은 거절된다", async () => {
  const h = await harness();
  try {
    const requested = keep(
      await h.command(
        machine,
        envelope("RecordToolRequest", requestInput(), {
          run_state_seq: "1",
          model_call_finished_seq: "2",
        }),
      ),
    );
    assertEquals(requested.replayed, false);
    const again = await h.command(
      machine,
      envelope("RecordToolRequest", requestInput(), {
        run_state_seq: "1",
        model_call_finished_seq: "2",
      }),
    );
    code(again, "conflict");

    const decided = keep(
      await h.command(
        machine,
        envelope("DecideToolCall", {
          tool_call: "tcl_01arz3ndektsv4rrffq69g5fav",
          decision: decision("allow"),
        }, { state_seq: "0" }),
      ),
    );
    assertEquals(
      (decided.result as { decision: string }).decision,
      "allow",
    );
    const started = keep(
      await h.command(
        machine,
        envelope("StartToolCall", {
          tool_call: "tcl_01arz3ndektsv4rrffq69g5fav",
          started_at: "2026-01-01T00:00:01.000Z",
          approval: null,
        }, { state_seq: "1", run_state_seq: "3", assignment_revision: 1 }),
      ),
    );
    assertEquals(
      (started.result as { idempotency_key: string }).idempotency_key,
      "tcl_01arz3ndektsv4rrffq69g5fav",
    );
    keep(
      await h.command(
        machine,
        envelope("FinishToolCall", {
          tool_call: "tcl_01arz3ndektsv4rrffq69g5fav",
          outcome: { kind: "success", code: "ok" },
          output: HASH,
          result: successResult("success"),
          finished_at: "2026-01-01T00:00:02.000Z",
          duration_ms: 1000,
        }, { state_seq: "2" }),
      ),
    );
    const rows = keep(
      await h.inspect(
        "select state, input, output from tool_calls where id = ?",
        ["tcl_01arz3ndektsv4rrffq69g5fav"],
      ),
    ) as Array<Record<string, unknown>>;
    assertEquals(rows[0]?.["state"], "finished");
    assertEquals(rows[0]?.["input"], HASH);
    assertEquals(rows[0]?.["output"], HASH);

    const userAttempt = await h.command(
      user,
      envelope(
        "RecordToolRequest",
        requestInput({
          id: "tcl_01arz3ndektsv4rrffq69g5faw",
          response_key: "call-2",
        }),
        { run_state_seq: "1", model_call_finished_seq: "2" },
      ),
    );
    code(userAttempt, "forbidden");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/tools#R15: read는 후행 기록으로 한 번에 끝나고 write는 기록 전 시작이 없다", async () => {
  const h = await harness();
  try {
    const recorded = keep(
      await h.command(
        machine,
        envelope("RecordReadToolCall", {
          request: requestInput({
            id: "tcl_01arz3ndektsv4rrffq69g5fb0",
            response_key: "read-1",
          }),
          decision: decision("allow"),
          started_at: "2026-01-01T00:00:01.000Z",
          finished_at: "2026-01-01T00:00:01.000Z",
          duration_ms: 0,
          outcome: { kind: "success", code: "ok" },
          output: HASH,
          result: successResult("success"),
        }),
      ),
    );
    assertEquals(
      (recorded.result as { tool_call: string }).tool_call,
      "tcl_01arz3ndektsv4rrffq69g5fb0",
    );
    const events = keep(
      await h.inspect(
        "select type from events where subject = ? order by seq",
        ["tcl_01arz3ndektsv4rrffq69g5fb0"],
      ),
    ) as Array<Record<string, unknown>>;
    assertEquals(events.map((row) => row["type"]), [
      "ToolCallRequested",
      "ToolCallDecided",
      "ToolCallStarted",
      "ToolCallFinished",
    ]);

    const write = requestInput({
      id: "tcl_01arz3ndektsv4rrffq69g5fb1",
      response_key: "write-1",
      tool: "document.save_version",
      effect: "write",
    });
    const early = await h.command(
      machine,
      envelope("StartToolCall", {
        tool_call: write.id,
        started_at: "2026-01-01T00:00:01.000Z",
        approval: null,
      }, { state_seq: "0", run_state_seq: "3", assignment_revision: 1 }),
    );
    code(early, "not_found");
    keep(
      await h.command(
        machine,
        envelope("RecordToolRequest", write, {
          run_state_seq: "1",
          model_call_finished_seq: "2",
        }),
      ),
    );
    const beforeDecision = await h.command(
      machine,
      envelope("StartToolCall", {
        tool_call: write.id,
        started_at: "2026-01-01T00:00:01.000Z",
        approval: null,
      }, { state_seq: "0", run_state_seq: "3", assignment_revision: 1 }),
    );
    code(beforeDecision, "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/tools#R15: 실행 중인 call은 재시작 뒤 같은 상태로 읽힌다", async () => {
  const h = await harness();
  try {
    const id = "tcl_01arz3ndektsv4rrffq69g5fb2";
    keep(
      await h.command(
        machine,
        envelope(
          "RecordToolRequest",
          requestInput({
            id,
            response_key: "running-1",
            effect: "write",
            tool: "document.save_version",
          }),
          { run_state_seq: "1", model_call_finished_seq: "2" },
        ),
      ),
    );
    keep(
      await h.command(
        machine,
        envelope("DecideToolCall", {
          tool_call: id,
          decision: decision("allow"),
        }, {
          state_seq: "0",
        }),
      ),
    );
    keep(
      await h.command(
        machine,
        envelope("StartToolCall", {
          tool_call: id,
          started_at: "2026-01-01T00:00:03.000Z",
          approval: null,
        }, { state_seq: "1", run_state_seq: "3", assignment_revision: 1 }),
      ),
    );
    const read = keep(
      await h.read(
        { resource: "tool-calls", method: "read" },
        machine,
        { tool_call: id },
      ),
    ) as { tool_call: { state: string; started_at: string } };
    assertEquals(read.tool_call.state, "started");
    assertEquals(read.tool_call.started_at, "2026-01-01T00:00:03.000Z");
  } finally {
    await h.close();
  }
});

function sample(
  name: string,
  input: z.ZodType = z.strictObject({ target: z.string() }),
): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    revision: "2026-01-01",
    input,
    effect: "read",
    confirm: false,
    contract: name,
    scopeCheck: "scope",
    reversible: true,
    idempotent: true,
    errors: [
      "invalid_input",
      "not_found",
      "forbidden",
      "conflict",
      "unavailable",
    ],
    origin: "builtin",
  };
}

function successResult(status: ToolResult["status"]): ToolResult {
  return {
    status,
    summary: "done",
    content: { ok: true },
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}

function decision(value: "allow" | "ask" | "deny") {
  return {
    decision: value,
    reason: "scope allows it",
    effect: "read" as const,
    assignment_revision: 1,
    agent_hash: "ab".repeat(32),
    contract_revision: "2026-01-01",
    comparison_basis: null,
    approval: null,
    session_grant: null,
  };
}

function runCredential(operations: readonly string[]): RunCredential {
  return {
    run: RUN,
    targets: new Set(["doc-1"]),
    operations: new Set(operations),
  };
}
