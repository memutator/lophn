import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
import {
  EFFORT_VALUES,
  effortValueSchema,
  priceBasisOutputSchema,
  priceBasisSchema,
  priceRateSchema,
  REASONING_LEVELS,
  resolvedModelOutputSchema,
  resolvedModelSchema,
} from "./resolved-model.ts";
import { runBasisOutputSchema, runBasisSchema } from "./run-values.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const hash = "a".repeat(64);
const at = "2026-10-04T00:00:00.000Z";
const rate = {
  context_from: null,
  context_through: null,
  cache_ttl_ms: null,
  input: "0",
  output: "0.000000000000000001",
  cache_read: null,
  cache_write: null,
  reasoning: null,
};
const price = {
  currency: "USD",
  rates: [rate],
  source: "catalog",
  revision: "hash",
  checked_at: at,
};
const model = {
  purpose: "judgment",
  credentials: ["primary"],
  provider: `pvd_${suffix}`,
  model_name: "model",
  verification: "unverified",
  sent_model_name: "model-fast",
  option_values: { effort: "high", speed: "fast" },
  request_patch: { reasoning: { effort: "high" }, service_tier: "priority" },
  request_headers: { "anthropic-beta": "fast-mode-2026-02-01" },
  context_limit: 32768,
  input_limit: 16000,
  output_limit: 8192,
  supports_tools: true,
  input_media: ["text"],
  output_media: ["text"],
  price_basis: price,
  basis: { context_limit: { source: "user" } },
};
const place = { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" };
const agentSources = Object.fromEntries(
  [
    "name",
    "profile",
    "agent_instructions",
    "model",
    "tools",
    "skills",
    "mcp",
    "contexts",
    "app_reads",
    "safe_tools",
  ].map((field) => [
    field,
    field === "model"
      ? { layer: "place", place }
      : { layer: "default", place: null },
  ]),
);
const basis = {
  agent: { hash, sources: agentSources },
  assignment: {
    id: `asg_${suffix}`,
    revision: 2,
    snapshot_hash: hash,
    basis_seq: "2",
  },
  tools: { revision: 3, definitions_hash: hash },
  extensions: {
    settings_revision: 1,
    skill_hashes: [],
    mcp_config_revisions: [2],
    mcp_tool_definition_hashes: [],
  },
  models: { judgment: model, organizing: { ...model, purpose: "organizing" } },
  initial_work_place: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
  limits: { model_attempts: 30, stall_ms: 300000, active_ms: 1800000 },
  tool_result_limits: { bytes: 24576, lines: 300, list: 20 },
};

Deno.test("lophn-agent/harness/run-loop#R7 lophn-agent/agents#R25: RunBasis pins the resolved agent by hash and sources, not a preset", () => {
  assert(runBasisSchema.safeParse(basis).success);
  assert(runBasisOutputSchema.safeParse(basis).success);
  // 옛 preset 칸은 받지 않고 agent 칸은 필수다.
  const { agent: _agent, ...withoutAgent } = basis;
  assert(!runBasisSchema.safeParse(withoutAgent).success);
  assert(
    !runBasisSchema.safeParse({
      ...basis,
      preset: {
        id: `pst_${suffix}`,
        revision: 1,
        snapshot_hash: hash,
        basis_seq: "1",
      },
    }).success,
  );
  assert(
    !runBasisSchema.safeParse({
      ...basis,
      extensions: { ...basis.extensions, preset_selection: hash },
    }).success,
  );
  // 전체 값은 blob이라 기준에는 hash와 칸별 출처만 있다.
  assert(
    !runBasisSchema.safeParse({
      ...basis,
      agent: { hash, sources: agentSources, model: {} },
    }).success,
  );
  assert(!runBasisSchema.safeParse({ ...basis, agent: { hash } }).success);
  assert(
    !runBasisSchema.safeParse({
      ...basis,
      agent: { hash: "short", sources: agentSources },
    }).success,
  );
  assert(
    !runBasisSchema.safeParse({
      ...basis,
      agent: {
        hash,
        sources: { ...agentSources, model: { layer: "boss", place: null } },
      },
    }).success,
  );
});

Deno.test("lophn-agent/harness/run-loop#R7: RunBasis pins full resolved models and numeric revisions", () => {
  assert(runBasisSchema.safeParse(basis).success);
  for (
    const value of [
      { ...model, credentials: ["primary", "primary"] },
      { ...model, model_name: " " },
      { ...model, context_limit: 0 },
      { ...model, input_limit: 1.5 },
      { ...model, input_media: ["image"] },
      { ...model, output_media: ["text", "text"] },
      { ...model, request_patch: [] },
      { ...model, request_headers: { "anthropic-beta": 1 } },
      { ...model, request_headers: undefined },
      { ...model, option_values: { effort: 1 } },
      { ...model, sent_model_name: " " },
      { ...model, options: {}, reasoning_level: "provider_default" },
      { ...model, basis: null },
      { ...model, extra: true },
    ]
  ) assert(!resolvedModelSchema.safeParse(value).success);
  assert(
    resolvedModelSchema.safeParse({
      ...model,
      credentials: [],
      price_basis: null,
    }).success,
  );
  assert(
    !runBasisSchema.safeParse({
      ...basis,
      models: {
        ...basis.models,
        judgment: {
          provider: model.provider,
          model: "model",
          purpose: "judgment",
        },
      },
    }).success,
  );
  assert(
    !runBasisSchema.safeParse({
      ...basis,
      tools: { ...basis.tools, revision: "3" },
    }).success,
  );
  assert(
    !runBasisSchema.safeParse({
      ...basis,
      models: { ...basis.models, organizing: model },
    }).success,
  );
  assert(
    runBasisOutputSchema.safeParse({
      ...basis,
      models: {
        ...basis.models,
        judgment: {
          ...model,
          future: true,
          price_basis: { ...price, future: true },
        },
      },
      future: true,
    }).success,
  );
  assertEquals(
    resolvedModelOutputSchema.parse({ ...model, future: true }),
    resolvedModelSchema.parse(model),
  );
});

Deno.test("lophn-agent/harness/model#R5: price values preserve decimal strings and inclusive nonoverlapping intervals", () => {
  assert(priceBasisSchema.safeParse(price).success);
  assert(
    priceBasisSchema.safeParse({
      ...price,
      rates: [
        { ...rate, context_from: 0, context_through: 100 },
        { ...rate, context_from: 101, context_through: null },
      ],
    }).success,
  );
  for (
    const value of [
      { ...rate, input: 0 },
      { ...rate, input: "-1" },
      { ...rate, input: "Infinity" },
      { ...rate, context_from: -1 },
      { ...rate, context_through: 0 },
      { ...rate, context_from: 10, context_through: 9 },
      { ...rate, cache_ttl_ms: 0 },
    ]
  ) assert(!priceRateSchema.safeParse(value).success);
  for (
    const value of [
      { ...price, currency: "EUR" },
      { ...price, rates: [] },
      { ...price, rates: [rate, rate] },
      {
        ...price,
        rates: [{ ...rate, context_through: 100 }, {
          ...rate,
          context_from: 100,
        }],
      },
    ]
  ) assert(!priceBasisSchema.safeParse(value).success);
  assert(
    priceBasisOutputSchema.safeParse({
      ...price,
      future: true,
      rates: [{ ...rate, future: true }],
    }).success,
  );
});

Deno.test("lophn-agent/harness/run-loop#R7: request patch and basis preserve exact own and nested JSON keys", () => {
  const exact = JSON.parse(
    '{"__proto__":{"own":true},"nested":{"__proto__":{"value":1}}}',
  );
  const value = { ...model, request_patch: exact, basis: exact };
  for (const schema of [resolvedModelSchema, resolvedModelOutputSchema]) {
    const parsed = schema.parse(value);
    assertEquals(canonicalize(parsed), canonicalize(value));
    assert(Object.hasOwn(parsed.request_patch, "__proto__"));
    assert(Object.hasOwn(parsed.basis, "__proto__"));
  }
});

Deno.test("lophn-agent/harness/model#R15: a call record names the seven effort values plus leaving it to the model", () => {
  assertEquals([...REASONING_LEVELS], [...EFFORT_VALUES, "provider_default"]);
  assert(!effortValueSchema.safeParse("provider_default").success);
});
