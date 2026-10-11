import { assert, assertEquals } from "@std/assert";
import { routePath } from "../platform/mod.ts";
import {
  finishModelCallInputSchema,
  MODEL_CALL_EVENTS,
  MODEL_CALL_ROUTES,
  startModelCallInputSchema,
  supplementModelCallInputSchema,
} from "./model-calls.ts";
import {
  callCostSchema,
  callModelOutputSchema,
  callModelSchema,
  modelCallRecordSchema,
} from "./model-call-values.ts";
import { priceBasisSchema } from "./resolved-model.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const call = `mcl_${suffix}`;
const run = `run_${suffix}`;
const session = `ses_${suffix}`;
const hash = "ab".repeat(32);
const at = "2026-10-05T00:00:00.000Z";

const price = {
  currency: "USD" as const,
  rates: [{
    context_from: null,
    context_through: null,
    cache_ttl_ms: null,
    input: "3",
    output: "15",
    cache_read: "0.3",
    cache_write: "3.75",
    reasoning: null,
  }],
  source: "models.dev",
  revision: "2026-10",
  checked_at: at,
};

const model = {
  provider: `pvd_${suffix}`,
  name: "gpt",
  protocol: "openai-responses" as const,
  credential_key: "personal",
  credential_revision: 1,
  option_values: { requested: {}, applied: {} },
  limits: {
    context_limit: 128000,
    input_limit: 120000,
    output_limit: 8000,
    supports_tools: true,
  },
  catalog_basis: { source: "models_dev" },
  price_basis: price,
  billing_route: "api" as const,
};

const usage = {
  input: null,
  output: null,
  cache_read: null,
  cache_write: null,
  reasoning: null,
  cache_in_input: null,
  reasoning_in_output: null,
  definition_revision: "2026-10",
};

const started = {
  id: call,
  run,
  session,
  model_use: "judgment" as const,
  agent_hash: hash,
  purpose: "judgment" as const,
  test_request: null,
  attempt_kind: "initial" as const,
  attempt_order: 1,
  retry_of: null,
  credential_change_of: null,
  model,
  input: hash,
  context_basis: hash,
  output: null,
  state: "started" as const,
  started_at: at,
  finished_at: null,
  duration_ms: null,
  first_output_ms: null,
  outcome: null,
  usage,
  cost: {
    kind: "unknown" as const,
    amount: null,
    currency: null,
    basis: null,
    confirmed_at: null,
  },
};

Deno.test("lophn-agent/harness/usage#R2: model call routes and the three call events", () => {
  assertEquals(MODEL_CALL_ROUTES.map(routePath), [
    "/v1/model-calls/start",
    "/v1/model-calls/finish",
    "/v1/model-calls/supplement",
    "/v1/model-calls/read",
    "/v1/model-calls/list",
  ]);
  assertEquals(MODEL_CALL_EVENTS.map((event) => event.type), [
    "ModelCallStarted",
    "ModelCallFinished",
    "ModelCallSupplemented",
  ]);
});

Deno.test("lophn-agent/harness/usage#R1: a started call has no result and an unknown cost", () => {
  assert(
    startModelCallInputSchema.safeParse({
      call: started,
      applied_messages: [`msg_${suffix}`],
      state_seq: "4",
      timeout_ms: null,
    }).success,
  );
  assert(
    !startModelCallInputSchema.safeParse({
      call: {
        ...started,
        cost: { ...started.cost, kind: "free", amount: "0", currency: "USD" },
      },
      applied_messages: [],
      state_seq: "4",
      timeout_ms: null,
    }).success,
  );
});

Deno.test("lophn-agent/harness/usage#R3: a finished call names one of the five outcomes", () => {
  assert(
    finishModelCallInputSchema.safeParse({
      call,
      output: hash,
      outcome: {
        kind: "partial",
        code: null,
        retry_at: null,
        finish_reason: "max_tokens",
        http_status: null,
        provider_code: null,
      },
      usage,
      cost: started.cost,
      duration_ms: 1200,
      first_output_ms: 300,
      state_seq: "5",
    }).success,
  );
  assert(
    !finishModelCallInputSchema.safeParse({
      call,
      output: null,
      outcome: {
        kind: "partial",
        code: null,
        retry_at: null,
        finish_reason: null,
        http_status: null,
        provider_code: null,
      },
      usage,
      cost: started.cost,
      duration_ms: null,
      first_output_ms: null,
      state_seq: "5",
    }).success,
  );
  assert(
    !finishModelCallInputSchema.safeParse({
      call: `run_${suffix}`,
      output: hash,
      outcome: {
        kind: "complete",
        code: null,
        retry_at: null,
        finish_reason: "stop",
        http_status: null,
        provider_code: null,
      },
      usage,
      cost: started.cost,
      duration_ms: 1,
      first_output_ms: 1,
      state_seq: "5",
    }).success,
  );
});

Deno.test("lophn-agent/harness/usage#R7: cost kinds keep amount, currency and basis apart", () => {
  assert(
    callCostSchema.safeParse({
      kind: "estimated",
      amount: "0.003",
      currency: "USD",
      basis: { price },
      confirmed_at: null,
    }).success,
  );
  assert(
    !callCostSchema.safeParse({
      kind: "estimated",
      amount: "0.003",
      currency: "USD",
      basis: null,
      confirmed_at: null,
    }).success,
  );
  assert(
    !callCostSchema.safeParse({
      kind: "subscription",
      amount: "0",
      currency: "USD",
      basis: null,
      confirmed_at: null,
    }).success,
  );
});

Deno.test("lophn-agent/harness/usage#R9: a supplement adds a late fact without a new call", () => {
  assert(
    supplementModelCallInputSchema.safeParse({
      call,
      supplement_key: "invoice-1",
      usage: { ...usage, input: 20, output: 5 },
      cost: null,
      outcome: null,
      basis: hash,
    }).success,
  );
  assert(
    !supplementModelCallInputSchema.safeParse({
      call,
      supplement_key: "invoice-1",
      usage: null,
      cost: null,
      outcome: null,
      basis: null,
    }).success,
  );
});

Deno.test("lophn-agent/harness/usage#R2: a connection test has no run and the fixed timeout", () => {
  const test = {
    ...started,
    run: null,
    session: null,
    model_use: null,
    agent_hash: null,
    purpose: "connection_test" as const,
    test_request: { command_key: "test-1", test_kind: "tool_call" as const },
  };
  assert(modelCallRecordSchema.safeParse(test).success);
  assert(
    startModelCallInputSchema.safeParse({
      call: test,
      applied_messages: [],
      state_seq: "4",
      timeout_ms: 30_000,
    }).success,
  );
  assert(
    !startModelCallInputSchema.safeParse({
      call: { ...started, secret: "raw" },
      applied_messages: [],
      state_seq: "4",
      timeout_ms: null,
    }).success,
  );
});

Deno.test("lophn-agent/harness/model#R7: a call reuses the resolved price basis", () => {
  assert(priceBasisSchema.safeParse(price).success);
  assert(!priceBasisSchema.safeParse({ ...price, currency: "KRW" }).success);
});

Deno.test("lophn-agent/harness/usage#R2 [agent-I10b]: a run call names the agent hash and a connection test has none", () => {
  const start = (call: unknown) =>
    startModelCallInputSchema.safeParse({
      call,
      applied_messages: [],
      state_seq: "4",
      timeout_ms: null,
    }).success;
  assert(start(started));
  assert(!start({ ...started, agent_hash: null }));
  assert(!start({ ...started, agent_hash: "not-a-hash" }));
  // 옛 preset ref 칸은 기록에 없다.
  assert(!start({ ...started, preset: { id: `pst_${suffix}`, revision: 1 } }));
  const test = {
    ...started,
    run: null,
    session: null,
    model_use: null,
    agent_hash: null,
    purpose: "connection_test" as const,
    test_request: { command_key: "test-1", test_kind: "text" as const },
  };
  assert(modelCallRecordSchema.safeParse(test).success);
  assert(
    !modelCallRecordSchema.safeParse({ ...test, agent_hash: hash }).success,
  );
});

Deno.test("lophn-agent/harness/usage#R4 [agent-I10b]: a call keeps the requested and the applied option values", () => {
  const withValues = (option_values: unknown) => ({
    ...started,
    model: { ...model, option_values },
  });
  const both = {
    requested: { effort: "very_high" },
    applied: { effort: "high", speed: "standard" },
  };
  const parsed = modelCallRecordSchema.safeParse(withValues(both));
  assert(parsed.success);
  assertEquals(parsed.data.model.option_values, both);
  assert(
    !modelCallRecordSchema.safeParse(withValues({ requested: {} })).success,
  );
  assert(
    !modelCallRecordSchema.safeParse(
      withValues({ requested: { effort: 3 }, applied: {} }),
    ).success,
  );
});

Deno.test("lophn-agent/harness/usage#R4 [agent-R12]: a call keeps its option values in option_values only, with no second options field", () => {
  assert(callModelSchema.safeParse(model).success);
  assert(!callModelSchema.safeParse({ ...model, options: {} }).success);
  const parsed = callModelOutputSchema.parse({ ...model, options: { a: "b" } });
  assert(!("options" in parsed));
});
