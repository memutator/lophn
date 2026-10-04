import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { visualBlockInputSchema } from "./visuals.ts";
import { tableBlock } from "./message-fixtures.ts";
import {
  decideToolCall,
  decideToolCallInputSchema,
  finishToolCall,
  finishToolCallInputSchema,
  recordReadToolCallInputSchema,
  recordToolRequest,
  recordToolRequestInputSchema,
  startToolCall,
  supplementToolCallInputSchema,
  TOOL_CALL_EVENTS,
  TOOL_CALL_ROUTES,
  toolCallListInputSchema,
  toolCallReadOutputSchema,
  toolCallRequested,
} from "./tool-calls.ts";
import {
  canonicalExternalToolSchema,
  toolCallSchema,
  toolOutcomeSchema,
} from "./tool-values.ts";

const tcl = "tcl_01arz3ndektsv4rrffq69g5fav";
const run = "run_01arz3ndektsv4rrffq69g5fav";
const mcl = "mcl_01arz3ndektsv4rrffq69g5fav";
const hash = "ab".repeat(32);
const at = "2026-10-05T00:00:00.000Z";

const request = {
  id: tcl,
  run,
  model_call: mcl,
  response_key: "call_0",
  response_order: 0,
  tool: "document.read_version",
  definition_revision: "tools-1",
  effect: "read",
  confirm: false,
  extension: null,
  input: hash,
  retry_of: null,
  attempt: 0,
};

const decision = {
  decision: "allow",
  reason: "in scope read",
  effect: "read",
  assignment_revision: 1,
  preset_revision: 1,
  contract_revision: "documents-1",
  comparison_basis: null,
  approval: null,
};

const finished = {
  ...request,
  app_command: null,
  output: hash,
  retry_at: null,
  decision,
  state: "finished",
  started_at: at,
  finished_at: at,
  duration_ms: 4,
  outcome: { kind: "success", code: "ok" },
};

Deno.test("lophn-agent/harness/tools#R15: eight tool call routes and five events", () => {
  assertEquals(TOOL_CALL_ROUTES.map(routePath), [
    "/v1/tool-calls/request",
    "/v1/tool-calls/decide",
    "/v1/tool-calls/start",
    "/v1/tool-calls/finish",
    "/v1/tool-calls/record-read",
    "/v1/tool-calls/supplement",
    "/v1/tool-calls/read",
    "/v1/tool-calls/list",
  ]);
  assertEquals(TOOL_CALL_EVENTS.map((event) => event.type), [
    "ToolCallRequested",
    "ToolCallDecided",
    "ToolCallStarted",
    "ToolCallFinished",
    "ToolCallSupplemented",
  ]);
  assertEquals(recordToolRequest.actors, ["machine"]);
  assertEquals(decideToolCall.actors, ["machine"]);
  assertEquals(startToolCall.actors, ["machine"]);
  assertEquals(finishToolCall.actors, ["machine"]);
  for (const route of TOOL_CALL_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    assert(!route.errors.includes("internal"));
  }
});

Deno.test("lophn-agent/harness/tools#R11: outcome is success, failure, not_executed or uncertain", () => {
  for (const kind of ["success", "failure", "not_executed", "uncertain"]) {
    assert(toolOutcomeSchema.safeParse({ kind, code: "ok" }).success);
  }
  assert(!toolOutcomeSchema.safeParse({ kind: "partial", code: "ok" }).success);
  assert(toolCallSchema.safeParse(finished).success);
  assert(
    !toolCallSchema.safeParse({
      ...finished,
      outcome: { kind: "success", code: "ok" },
      output: null,
    }).success,
  );
  assert(
    toolCallSchema.safeParse({
      ...finished,
      state: "requested",
      started_at: null,
      finished_at: null,
      outcome: null,
      output: null,
      duration_ms: null,
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R23: canonical external name keeps server and tool", () => {
  const extension = {
    server_name: "notes",
    configuration_revision: 3,
    original_tool: "search",
    canonical_name: "ext_notes_search",
  };
  assert(canonicalExternalToolSchema.safeParse("ext_notes_search").success);
  assert(!canonicalExternalToolSchema.safeParse("notes.search").success);
  assert(
    !canonicalExternalToolSchema.safeParse("ext_" + "a".repeat(61)).success,
  );
  assert(
    recordToolRequestInputSchema.safeParse({ ...request, extension }).success,
  );
  assert(
    toolCallRequested.payload.safeParse({
      run,
      model_call: mcl,
      response_key: "call_0",
      tool: "ext_notes_search",
      input: hash,
      retry_of: null,
    }).success,
  );
});

Deno.test("lophn-agent/harness/tools#R3: request rejects an unknown field and a wrong id prefix", () => {
  assert(
    !recordToolRequestInputSchema.safeParse({ ...request, actor: "user" })
      .success,
  );
  assert(
    !recordToolRequestInputSchema.safeParse({
      ...request,
      id: "mcl_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    !recordToolRequestInputSchema.safeParse({
      ...request,
      run: "ses_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    !decideToolCallInputSchema.safeParse({
      tool_call: "apr_01arz3ndektsv4rrffq69g5fav",
      decision,
    }).success,
  );
  assert(
    !decideToolCallInputSchema.safeParse({
      tool_call: tcl,
      decision: {
        ...decision,
        decision: "deny",
        approval: "apr_01arz3ndektsv4rrffq69g5fav",
      },
    }).success,
  );
});

Deno.test("lophn-agent/harness/tools#R15: a confirm-false read is one trailing record", () => {
  assert(
    recordReadToolCallInputSchema.safeParse({
      request,
      decision,
      started_at: at,
      finished_at: at,
      duration_ms: 1,
      outcome: { kind: "success", code: "ok" },
      output: hash,
      result: {
        status: "success",
        summary: "read",
        content: { text: "a" },
        complete: true,
        source: {
          target: "doc",
          version: "1",
          range: null,
          original_bytes: 1,
          original_lines: 1,
          omitted_count: 0,
        },
        continuation: null,
        pending: [],
      },
    }).success,
  );
  assert(
    !recordReadToolCallInputSchema.safeParse({
      request: { ...request, effect: "write" },
      decision,
      started_at: at,
      finished_at: at,
      duration_ms: null,
      outcome: { kind: "success", code: "ok" },
      output: hash,
      result: {
        status: "success",
        summary: "wrote",
        content: null,
        complete: true,
        source: null,
        continuation: null,
        pending: [],
      },
    }).success,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R5: supplement is an audit append and uncertain stays unfinished", () => {
  assert(
    supplementToolCallInputSchema.safeParse({
      tool_call: tcl,
      supplement_key: "late-1",
      fact: hash,
      note: null,
    }).success,
  );
  assert(
    !supplementToolCallInputSchema.safeParse({
      tool_call: "run_01arz3ndektsv4rrffq69g5fav",
      supplement_key: "late-1",
      fact: hash,
      note: null,
    }).success,
  );
  assert(
    finishToolCallInputSchema.safeParse({
      tool_call: tcl,
      outcome: { kind: "uncertain", code: "delivery_unknown" },
      output: null,
      result: null,
      finished_at: at,
      duration_ms: null,
    }).success,
  );
  assert(
    !finishToolCallInputSchema.safeParse({
      tool_call: tcl,
      outcome: { kind: "success", code: "ok" },
      output: null,
      result: null,
      finished_at: at,
      duration_ms: null,
      guessed: true,
    }).success,
  );
});

Deno.test("lophn-agent/harness/tools#R15: list needs a run or model call and read returns the call", () => {
  assert(toolCallListInputSchema.safeParse({ run }).success);
  assert(!toolCallListInputSchema.safeParse({ cursor: "1" }).success);
  assert(
    !toolCallListInputSchema.safeParse({ run: "tcl_" + "0".repeat(26) })
      .success,
  );
  assert(
    toolCallReadOutputSchema.safeParse({
      tool_call: finished,
      as_of_seq: "9",
      next_cursor: null,
    }).success,
  );
});

Deno.test("lophn-agent/visuals#R1: message visual blocks stay the T26 schema", () => {
  assert(visualBlockInputSchema.safeParse(tableBlock).success);
  assert(
    !visualBlockInputSchema.safeParse({ ...tableBlock, kind: "html" }).success,
  );
});
