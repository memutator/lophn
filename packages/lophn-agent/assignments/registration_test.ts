import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
import type { McpServerConfig } from "../../contracts/lophn-agent/mod.ts";
import {
  createPresetCommands,
  createPresetReads,
  presetSchemaSteps,
  type ValidateDeps,
} from "../presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "./mod.ts";

// assignment ledger 테스트 등록. preset 표와 같은 wire에 assignment 명령·읽기를
// 붙인다. preset 검증 deps는 leaf 경계로 catalog 대체다(presets/registration_test.ts와
// 같은 모양, cs#T10 catalog 대체는 reader worker 등록 경로다). 실제 provider를
// 부르지 않는다.

export function presetValidateDeps(
  overrides?: Partial<ValidateDeps>,
): ValidateDeps {
  return {
    bundles: new Map([
      ["read-only", ["doc.read", "doc.list"]],
      ["write-tools", ["doc.write", "doc.revert"]],
    ]),
    mcpServers: new Map<string, McpServerConfig>([
      [
        "notes",
        {
          transport: "http",
          name: "notes",
          revision: 1,
          enabled: true,
          call_timeout_ms: 60_000,
          http: {
            url: "http://127.0.0.1:6001/mcp",
            headers: {},
            auth: { kind: "none" },
          },
          classifications: {
            "notes.read": {
              effect: "read",
              schema_hash: "a".repeat(64),
              reversible: true,
            },
            "notes.write": {
              effect: "write",
              schema_hash: "b".repeat(64),
              reversible: true,
            },
            "notes.purge": {
              effect: "write",
              schema_hash: "c".repeat(64),
              reversible: false,
            },
          },
        },
      ],
    ]),
    roleCaps: new Map([
      ["lophn", { tools: ["doc.read", "doc.list"] }],
      ["app_engineer", {
        tools: ["doc.read", "doc.list", "doc.write", "doc.revert"],
      }],
      ["context_engineer", {
        tools: ["doc.read", "doc.list", "doc.write", "doc.revert"],
      }],
      ["operator", {
        tools: ["doc.read", "doc.list", "doc.write", "doc.revert"],
      }],
    ]),
    definitionKey: (provider) =>
      provider === "pvd_01arz3ndektsv4rrffq69g5fav" ? "anthropic" : undefined,
    modelListed: (providerDefinition, modelName) =>
      providerDefinition === "anthropic"
        ? modelName === "claude-haiku-4-5"
        : false,
    credentialKeys: (provider) =>
      provider === "pvd_01arz3ndektsv4rrffq69g5fav"
        ? ["key-main", "key-backup"]
        : [],
    catalogEntry: (providerDefinition, modelName) =>
      providerDefinition === "anthropic" && modelName === "claude-haiku-4-5"
        ? {
          provider_definition: "anthropic",
          model_name: "claude-haiku-4-5",
          context_limit: 200_000,
          input_limit: 200_000,
          output_limit: 64_000,
          supports_tools: true,
          input_media: ["text", "image"],
          output_media: ["text"],
          reasoning: {
            mode: "named",
            levels: ["off", "low", "medium", "high"],
            minimum_budget: null,
            maximum_budget: null,
            default_level: "high",
          },
          preview: false,
          deprecated: false,
          source: "models_dev",
          source_revision: "2026-01-01",
          checked_at: "2026-01-01T00:00:00.000Z",
          received_at: "2026-01-01T00:00:00.000Z",
          price_basis: null,
        }
        : undefined,
    ...overrides,
  };
}

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const deps = presetValidateDeps();
  const presetCommands = createPresetCommands(deps);
  const presetReads = createPresetReads();
  const assignmentCommands = createAssignmentCommands();
  const assignmentReads = createAssignmentReads();
  return {
    schemaSteps: [...presetSchemaSteps, ...assignmentSchemaSteps],
    commands: [
      presetCommands.registerDefault,
      presetCommands.create,
      presetCommands.revise,
      assignmentCommands.createBuiltin,
      assignmentCommands.createAppEngineer,
      assignmentCommands.applyOperator,
      assignmentCommands.changePreset,
      assignmentCommands.pause,
      assignmentCommands.resume,
      assignmentCommands.withdraw,
    ],
    reads: [
      presetReads.read,
      presetReads.list,
      presetReads.instructionAttachments,
      assignmentReads.read,
      assignmentReads.list,
      assignmentReads.outputs,
    ],
  };
}
