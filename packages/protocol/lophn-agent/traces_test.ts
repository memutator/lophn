import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../base/route.ts";
import {
  agentTraceExport,
  agentTraceExportInputSchema,
  agentTraceRead,
  agentTraceReadInputSchema,
  agentTraceReadOutputSchema,
  agentUsageRead,
  agentUsageReadInputSchema,
  agentUsageReadOutputSchema,
  TRACE_ROUTES,
} from "./traces.ts";
import { callCostSchema, tokenUsageSchema } from "./model-call-values.ts";

const run = "run_01arz3ndektsv4rrffq69g5fav";
const hash = "ab".repeat(32);
const from = "2026-10-01T00:00:00.000Z";
const through = "2026-10-05T00:00:00.000Z";

const usage = {
  input: 10,
  output: 2,
  cache_read: null,
  cache_write: 0,
  reasoning: null,
  cache_in_input: true,
  reasoning_in_output: null,
  definition_revision: "usage-1",
};

Deno.test("lophn-agent/observability#R1: trace and usage reads are reference views", () => {
  assertEquals(TRACE_ROUTES.map(routePath), [
    "/v1/agent-traces/read",
    "/v1/agent-traces/export",
    "/v1/agent-usage/read",
  ]);
  assertEquals(agentTraceRead.actors, ["user", "agent", "machine"]);
  assertEquals(agentTraceExport.actors, ["user"]);
  assertEquals(agentUsageRead.actors, ["user", "agent", "machine"]);
  for (const route of TRACE_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
  assert(TRACE_ROUTES.every((route) => !("events" in route)));
});

Deno.test("lophn-agent/observability#R14: export is local ndjson version 1 without a ledger event", () => {
  assert(
    agentTraceExportInputSchema.safeParse({
      targets: [{ kind: "run", run }],
      format: "ndjson",
      format_version: 1,
      destination: "/tmp/trace.ndjson",
      content_kinds: [],
    }).success,
  );
  assert(
    !agentTraceExportInputSchema.safeParse({
      targets: [{ kind: "run", run }],
      format: "json",
      format_version: 1,
      destination: "/tmp/trace.ndjson",
      content_kinds: [],
    }).success,
  );
  assert(
    !agentTraceExportInputSchema.safeParse({
      targets: [{ kind: "run", run }],
      format: "ndjson",
      format_version: 1,
      destination: "https://example.test/trace",
      content_kinds: ["message"],
    }).success,
  );
  assertEquals(agentTraceExport.kind, "command");
});

Deno.test("lophn-agent/observability#R16: content kinds are chosen per export", () => {
  assert(
    agentTraceExportInputSchema.safeParse({
      targets: [{ kind: "session", session: "ses_01arz3ndektsv4rrffq69g5fav" }],
      format: "ndjson",
      format_version: 1,
      destination: "/tmp/trace.ndjson",
      content_kinds: ["message", "tool_output"],
    }).success,
  );
  assert(
    !agentTraceExportInputSchema.safeParse({
      targets: [],
      format: "ndjson",
      format_version: 1,
      destination: "/tmp/trace.ndjson",
      content_kinds: ["prompt"],
    }).success,
  );
});

Deno.test("lophn-agent/harness/usage#R6: unknown token counts stay null and cost kinds stay apart", () => {
  assert(tokenUsageSchema.safeParse(usage).success);
  assert(
    !tokenUsageSchema.safeParse({ ...usage, input: "10" }).success,
  );
  assert(
    callCostSchema.safeParse({
      kind: "unknown",
      amount: null,
      currency: null,
      basis: null,
      confirmed_at: null,
    }).success,
  );
  for (
    const kind of ["reported", "estimated", "subscription", "free", "unknown"]
  ) {
    const priced = kind === "reported" || kind === "free";
    const ok = callCostSchema.safeParse({
      kind,
      amount: kind === "free" ? "0" : priced ? "1.5" : null,
      currency: priced ? "USD" : null,
      basis: kind === "estimated" ? { price: hash } : null,
      confirmed_at: null,
    }).success;
    assertEquals(ok, kind !== "estimated");
  }
  assert(
    callCostSchema.safeParse({
      kind: "estimated",
      amount: "1.5",
      currency: "USD",
      basis: { price: hash },
      confirmed_at: null,
    }).success,
  );
  assert(
    !callCostSchema.safeParse({
      kind: "free",
      amount: "1",
      currency: "USD",
      basis: null,
      confirmed_at: null,
    }).success,
  );
});

Deno.test("lophn-agent/harness/usage#R10: a usage total marks missing records incomplete", () => {
  const total = {
    group: {
      run,
      session: null,
      role: "lophn",
      model: null,
      from_at: from,
      through_at: through,
      currency: "USD",
    },
    calls: 2,
    tokens: { known: usage, unknown_calls: 1 },
    costs: [{ kind: "unknown", currency: null, amount: null, calls: 1 }],
    missing_records: 1,
    complete: false,
  };
  assert(
    agentUsageReadOutputSchema.safeParse({
      totals: [total],
      as_of_seq: "3",
      next_cursor: null,
    }).success,
  );
  assert(
    !agentUsageReadOutputSchema.safeParse({
      totals: [{ ...total, complete: true }],
      as_of_seq: "3",
      next_cursor: null,
    }).success,
  );
});

Deno.test("lophn-agent/observability#R18: trace read rejects an unknown field and a wrong id prefix", () => {
  assert(
    agentTraceReadInputSchema.safeParse({ target: { kind: "run", run } })
      .success,
  );
  assert(
    !agentTraceReadInputSchema.safeParse({
      target: { kind: "run", run },
      score: 1,
    }).success,
  );
  assert(
    !agentTraceReadInputSchema.safeParse({
      target: { kind: "run", run: "ses_01arz3ndektsv4rrffq69g5fav" },
    }).success,
  );
  assert(
    !agentUsageReadInputSchema.safeParse({
      run: "mcl_01arz3ndektsv4rrffq69g5fav",
      from_at: from,
      through_at: through,
    }).success,
  );
  assert(
    !agentUsageReadInputSchema.safeParse({
      from_at: through,
      through_at: from,
    }).success,
  );
  assert(
    agentTraceReadOutputSchema.safeParse({
      trace: {
        run,
        session: "ses_01arz3ndektsv4rrffq69g5fav",
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        state: "finished",
        started_at: from,
        finished_at: through,
        basis: hash,
        events: ["1", "2"],
        messages: [],
        model_calls: [],
        tool_calls: [],
        handoff_links: [],
        activity: {
          model: {
            attempts: 0,
            failed: [],
            partial: [],
            cancelled: [],
            uncertain: [],
            unfinished: [],
          },
          tools: {
            steps: 0,
            succeeded: 0,
            failed: [],
            denied: [],
            not_executed: [],
            uncertain: [],
            unfinished: [],
            external: [],
          },
        },
        times: {
          wall_ms: 1,
          active_ms: 1,
          waiting_ms: 0,
          model_ms: 0,
          first_output_ms: null,
          tool_ms: 0,
        },
        reason: null,
        missing: [],
      },
      as_of_seq: "2",
      next_cursor: null,
    }).success,
  );
});
