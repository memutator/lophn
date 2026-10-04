import { assert, assertEquals } from "@std/assert";
import { routePath } from "../platform/mod.ts";
import {
  CATALOG_REFRESH_INTERVAL_MS,
  catalogEntrySchema,
  catalogStateSchema,
  changeModelDefaults,
  INSTRUCTION_CALL_MAX_BYTES,
  INSTRUCTION_FILE_MAX_BYTES,
  MODEL_EVENTS,
  MODEL_ROUTES,
  modelDefaultsSchema,
  orderedLevels,
  REASONING_BUDGET_TOKENS,
  reasoningSupportSchema,
  runBasisModelSchema,
} from "./models.ts";
import { resolvedModelSchema } from "./resolved-model.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const at = "2026-10-05T00:00:00.000Z";
const hash = "ab".repeat(32);

const entry = {
  provider_definition: "openai",
  model_name: "gpt",
  context_limit: 128000,
  input_limit: 120000,
  output_limit: 8000,
  supports_tools: true,
  input_media: ["text" as const],
  output_media: ["text" as const],
  reasoning: {
    mode: "named" as const,
    levels: ["low" as const, "high" as const],
    minimum_budget: null,
    maximum_budget: null,
    default_level: "low" as const,
  },
  preview: false,
  deprecated: null,
  source: "models_dev" as const,
  source_revision: "2026-10",
  checked_at: at,
  received_at: at,
  price_basis: null,
};

Deno.test("lophn-agent/harness/model#R2: model catalog routes and the defaults event", () => {
  assertEquals(MODEL_ROUTES.map(routePath), [
    "/v1/agent-model-defaults/change",
    "/v1/agent-model-defaults/read",
    "/v1/agent-model-catalog/read",
    "/v1/agent-model-catalog/refresh",
  ]);
  assertEquals(MODEL_EVENTS.map((event) => event.type), [
    "ModelDefaultsChanged",
  ]);
  assertEquals(changeModelDefaults.actors, ["user"]);
});

Deno.test("lophn-agent/harness/model#R1: a catalog entry is a provider definition and model name", () => {
  assert(catalogEntrySchema.safeParse(entry).success);
  assert(!catalogEntrySchema.safeParse({ ...entry, extra: true }).success);
  assert(
    !catalogEntrySchema.safeParse({ ...entry, context_limit: 0 }).success,
  );
});

Deno.test("lophn-agent/harness/model#R5: catalog state keeps the last good snapshot hash", () => {
  assert(
    catalogStateSchema.safeParse({
      auto_update: true,
      etag: "etag-1",
      last_checked_at: at,
      last_received_at: at,
      last_failure: null,
      snapshot_hash: hash,
    }).success,
  );
  assert(
    !catalogStateSchema.safeParse({
      auto_update: true,
      etag: null,
      last_checked_at: null,
      last_received_at: null,
      last_failure: "invalid_input",
      snapshot_hash: "ABC",
    }).success,
  );
  assertEquals(CATALOG_REFRESH_INTERVAL_MS, 86_400_000);
});

Deno.test("lophn-agent/harness/model#R9: defaults start empty and copy a preset selection", () => {
  assert(
    modelDefaultsSchema.safeParse({
      judgment: null,
      organizing: null,
      settings_seq: "0",
    }).success,
  );
  assert(
    modelDefaultsSchema.safeParse({
      judgment: {
        provider: `pvd_${suffix}`,
        credentials: ["personal"],
        model_name: "gpt",
        reasoning_level: "provider_default",
        options: {},
      },
      organizing: null,
      settings_seq: "1",
    }).success,
  );
  assert(
    !modelDefaultsSchema.safeParse({
      judgment: null,
      organizing: null,
      settings_seq: "1",
      propagate: true,
    }).success,
  );
});

Deno.test("lophn-agent/harness/model#R15: reasoning levels keep provider default outside the order", () => {
  assertEquals([...orderedLevels], [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "very_high",
    "maximum",
  ]);
  assertEquals(REASONING_BUDGET_TOKENS, {
    low: 2048,
    medium: 8192,
    high: 16384,
    maximum: 32768,
  });
  assert(
    !reasoningSupportSchema.safeParse({
      ...entry.reasoning,
      mode: "budget",
      minimum_budget: null,
      maximum_budget: null,
    }).success,
  );
});

Deno.test("lophn-agent/harness/model#R13: a run basis reuses the resolved model schema", () => {
  assertEquals(runBasisModelSchema, resolvedModelSchema);
  assert(
    !runBasisModelSchema.safeParse({
      purpose: "judgment",
      credentials: [],
      provider: `ses_${suffix}`,
      model_name: "gpt",
      verification: "unverified",
      options: {},
      reasoning_level: "provider_default",
      context_limit: 1,
      input_limit: 1,
      output_limit: 1,
      supports_tools: false,
      input_media: ["text"],
      output_media: ["text"],
      price_basis: null,
      basis: {},
    }).success,
  );
});

Deno.test("lophn-agent/instructions#R7: instruction bytes stay within the fixed caps", () => {
  assertEquals(INSTRUCTION_FILE_MAX_BYTES, 32_768);
  assertEquals(INSTRUCTION_CALL_MAX_BYTES, 131_072);
});
