import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  InstructionAttachments,
  instructionAttachmentSchema,
  instructionLocationSchema,
} from "./instructions.ts";
import {
  capabilitySelectionSchema,
  contextSelectionSchema,
  mcpSelectionSchema,
  presetDefinitionSchema,
  presetInstructionSchema,
  presetModelSelectionSchema,
  presetRecordSchema,
} from "./preset-values.ts";
import {
  createPreset,
  createPresetInputSchema,
  PRESET_EVENTS,
  PRESET_ROUTES,
  presetCreated,
  presetInstructionAttachments,
  presetRead,
  registerDefaultPreset,
  registerDefaultPresetInputSchema,
  revisePreset,
  revisePresetCompareSchema,
  revisePresetInputSchema,
} from "./presets.ts";

const pst = "pst_01arz3ndektsv4rrffq69g5fav";
const pst2 = "pst_01arz3ndektsv4rrffq69g5faw";
const doc = "doc_01arz3ndektsv4rrffq69g5fav";
const pvd = "pvd_01arz3ndektsv4rrffq69g5fav";
const hash = "ab".repeat(32);

const definition = {
  kind: "lophn",
  name: "lophn",
  origin: "user",
  prompt: hash,
  capability: { bundles: [], tools: [] },
  context: [{ kind: "all", target: null, section: null }],
  mcp: { servers: [], tools: [] },
  safe_tools: [],
  skills: [],
  model: null,
  organizing_model: null,
  instructions: [],
};

Deno.test("lophn-agent/presets#R1: six preset routes and two preset events keep assignment state out", () => {
  assertEquals(PRESET_ROUTES.map(routePath), [
    "/v1/presets/register-default",
    "/v1/presets/create",
    "/v1/presets/revise",
    "/v1/presets/read",
    "/v1/presets/list",
    "/v1/presets/instruction-attachments",
  ]);
  assertEquals(PRESET_EVENTS.map((event) => event.type), [
    "PresetCreated",
    "PresetRevised",
  ]);
  assertEquals(createPreset.actors, ["user"]);
  assertEquals(registerDefaultPreset.actors, ["machine"]);
  assertEquals(revisePreset.actors, ["user"]);
  for (const route of PRESET_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
  assert(
    presetRecordSchema.safeParse({
      id: pst,
      revision: 1,
      definition,
      definition_hash: hash,
    }).success,
  );
  assert(
    !presetDefinitionSchema.safeParse({ ...definition, schedule: null })
      .success,
  );
});

Deno.test("lophn-agent/presets#R2: a blank name is rejected with the rest of the definition", () => {
  assert(
    !presetDefinitionSchema.safeParse({ ...definition, name: "  " }).success,
  );
  assert(
    !presetDefinitionSchema.safeParse({ ...definition, name: "" }).success,
  );
});

Deno.test("lophn-agent/presets#R5: context target is required only for an explicit selection", () => {
  assert(
    contextSelectionSchema.safeParse({
      kind: "document",
      target: doc,
      section: "scope",
    }).success,
  );
  assert(
    !contextSelectionSchema.safeParse({
      kind: "all",
      target: doc,
      section: null,
    }).success,
  );
  assert(
    !contextSelectionSchema.safeParse({
      kind: "project",
      target: null,
      section: null,
    }).success,
  );
  assert(
    !contextSelectionSchema.safeParse({
      kind: "document",
      target: doc,
      section: null,
      follow: true,
    }).success,
  );
});

Deno.test("lophn-agent/presets#R6: model selection keeps credential keys and rejects a secret value field", () => {
  const model = {
    provider: pvd,
    credentials: ["account-a", "account-b"],
    model_name: "model",
    reasoning_level: "provider_default",
    options: {},
  };
  assert(presetModelSelectionSchema.safeParse(model).success);
  assert(
    !presetModelSelectionSchema.safeParse({
      ...model,
      credentials: ["account-a", "account-a"],
    }).success,
  );
  assert(
    !presetModelSelectionSchema.safeParse({ ...model, api_key: "secret" })
      .success,
  );
  assert(
    presetDefinitionSchema.safeParse({
      ...definition,
      model,
      organizing_model: null,
    })
      .success,
  );
});

Deno.test("lophn-agent/presets#R7: capability tools are an exact list and a bundle name is unique", () => {
  assert(
    capabilitySelectionSchema.safeParse({
      bundles: [{ name: "documents", revision: 1 }],
      tools: [{ tool: "document.read_version", app_command: null }],
    }).success,
  );
  assert(
    !capabilitySelectionSchema.safeParse({
      bundles: [{ name: "documents", revision: 1 }, {
        name: "documents",
        revision: 2,
      }],
      tools: [],
    }).success,
  );
  assert(
    !capabilitySelectionSchema.safeParse({
      bundles: [],
      tools: [{ tool: "document.list" }],
    }).success,
  );
});

Deno.test("lophn-agent/presets#R9: product seed and a user copy are different origins", () => {
  assert(
    registerDefaultPresetInputSchema.safeParse({
      id: pst,
      definition: { ...definition, origin: "product" },
      definition_hash: hash,
    }).success,
  );
  assert(
    !registerDefaultPresetInputSchema.safeParse({
      id: pst,
      definition,
      definition_hash: hash,
    }).success,
  );
  assert(
    createPresetInputSchema.safeParse({
      id: pst2,
      definition,
      copied_from: { preset: pst, revision: 1 },
    }).success,
  );
  assert(
    !createPresetInputSchema.safeParse({
      id: pst2,
      definition: { ...definition, origin: "product" },
      copied_from: null,
    }).success,
  );
});

Deno.test("lophn-agent/presets#R11: create rejects an unknown field and a wrong id prefix", () => {
  assert(
    !createPresetInputSchema.safeParse({
      id: pst,
      definition,
      copied_from: null,
      grant: true,
    }).success,
  );
  assert(
    !createPresetInputSchema.safeParse({
      id: "asg_01arz3ndektsv4rrffq69g5fav",
      definition,
      copied_from: null,
    }).success,
  );
  assert(
    !revisePresetInputSchema.safeParse({
      preset: "doc_01arz3ndektsv4rrffq69g5fav",
      definition,
      reason: "rename",
    }).success,
  );
  assert(revisePresetCompareSchema.safeParse({ revision: 2 }).success);
  assert(!revisePresetCompareSchema.safeParse({ revision: 0 }).success);
});

Deno.test("lophn-agent/presets#R13: a created event keeps the whole pinned definition", () => {
  assert(
    presetCreated.payload.safeParse({
      kind: "operator",
      origin: "user",
      revision: 1,
      definition_hash: hash,
      definition: { ...definition, kind: "operator", origin: "user" },
    }).success,
  );
  assert(
    !presetCreated.payload.safeParse({
      kind: "lophn",
      origin: "user",
      revision: 1,
      definition_hash: hash,
    }).success,
  );
});

Deno.test("lophn-agent/presets#R15: operator review reads the pinned preset, not a summary", () => {
  assert(
    presetRead.output.safeParse({
      preset: {
        id: pst,
        revision: 3,
        definition: { ...definition, kind: "operator" },
        definition_hash: hash,
      },
      as_of_seq: "4",
      next_cursor: null,
    }).success,
  );
  assert(!presetRead.input.safeParse({ preset: pst, summary: true }).success);
});

Deno.test("lophn-agent/presets#R16: a safe tool must be an exact selected mcp pair", () => {
  const pair = { server_name: "notes", original_tool: "search" };
  const selected = {
    ...definition,
    mcp: { servers: ["notes"], tools: [pair] },
    safe_tools: [pair],
  };
  assert(presetDefinitionSchema.safeParse(selected).success);
  assert(
    !presetDefinitionSchema.safeParse({
      ...selected,
      safe_tools: [{
        server_name: "notes",
        original_tool: "*",
      }],
    }).success,
  );
  assert(
    !mcpSelectionSchema.safeParse({
      servers: ["notes"],
      tools: [{ server_name: "other", original_tool: "search" }],
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R30: skill names are exact and unique", () => {
  assert(
    presetDefinitionSchema.safeParse({ ...definition, skills: ["review"] })
      .success,
  );
  assert(
    !presetDefinitionSchema.safeParse({ ...definition, skills: ["*"] }).success,
  );
  assert(
    !presetDefinitionSchema.safeParse({
      ...definition,
      skills: ["review", "review"],
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R31: mcp selection is exact server and tool pairs", () => {
  assert(
    !mcpSelectionSchema.safeParse({
      servers: ["notes", "notes"],
      tools: [],
    }).success,
  );
  assert(
    !presetDefinitionSchema.safeParse({
      ...definition,
      mcp: { servers: ["*"], tools: [] },
    }).success,
  );
});

Deno.test("lophn-agent/instructions#R1: an attachment names a document and rejects a path", () => {
  assert(
    presetInstructionSchema.safeParse({ document: doc, order: 0 }).success,
  );
  assert(
    !presetInstructionSchema.safeParse({
      document: doc,
      order: 0,
      path: "/tmp/LOPHN.md",
    }).success,
  );
  assert(
    instructionAttachmentSchema.safeParse({
      preset: pst,
      revision: 2,
      document: doc,
      order: 0,
    }).success,
  );
  assert(
    !instructionAttachmentSchema.safeParse({
      preset: "ses_01arz3ndektsv4rrffq69g5fav",
      revision: 2,
      document: doc,
      order: 0,
    }).success,
  );
});

Deno.test("lophn-agent/instructions#R2: a location is a layer and a place, not a guessed path", () => {
  assert(
    instructionLocationSchema.safeParse({
      layer: "project",
      place: "prj_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    !instructionLocationSchema.safeParse({
      layer: "cwd",
      place: ".",
    }).success,
  );
  assert(
    !instructionLocationSchema.safeParse({
      layer: "global",
      place: "home",
      path: "~/.lophn/LOPHN.md",
    }).success,
  );
});

Deno.test("lophn-agent/instructions#R3: instruction attachments read lists preset revisions for one document", () => {
  assertEquals(
    routePath(presetInstructionAttachments),
    "/v1/presets/instruction-attachments",
  );
  assert(
    presetInstructionAttachments.output.safeParse({
      attachments: [{
        attachment: { preset: pst, revision: 2, document: doc, order: 1 },
        in_use: true,
      }],
      as_of_seq: "9",
      next_cursor: null,
    }).success,
  );
  assert(
    !presetInstructionAttachments.input.safeParse({
      document: "pst_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(InstructionAttachments.name === "InstructionAttachments");
});
