import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
import {
  createProviderCommands,
  createProviderReads,
  providerSchemaSteps,
} from "../harness/provider/mod.ts";
import type { McpServerConfig } from "../../contracts/lophn-agent/mod.ts";
import { DOCUMENT_READ_TOOLS, ROLE_CAPS } from "../agents/mod.ts";
import {
  createPresetCommands,
  createPresetReads,
  presetSchemaSteps,
} from "./mod.ts";
import type { ValidateDeps } from "./validate.ts";

// preset ledger 테스트 등록. provider 표와 같은 wire에 preset 명령·읽기를 붙인다.
// 실제 provider를 부르지 않는다(R6). catalog는 파일 자료라 ledger 열에 없으므로
// 검증 deps는 테스트 값 대체다(R10, R13). catalog 대체는 T4 파생 파일 read 자리로
// reader worker 등록 경로다(plan/lophn-agent Q28).

export function presetValidateDeps(
  overrides?: Partial<ValidateDeps>,
): ValidateDeps {
  return {
    bundles: new Map([
      ["read-only", [...DOCUMENT_READ_TOOLS.slice(0, 2)]],
      ["write-tools", ["context.add_item", "context.remove_item"]],
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
    roleCaps: ROLE_CAPS,
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
          options: [{
            id: "effort",
            label: "Effort",
            values: [
              { value: "off", label: "Off", wire: null },
              { value: "low", label: "Low", wire: null },
              { value: "medium", label: "Medium", wire: null },
              { value: "high", label: "High", wire: null },
            ],
            default_value: "high",
            budget: null,
          }],
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
  const providerCommands = createProviderCommands();
  const providerReads = createProviderReads();
  const presetCommands = createPresetCommands(deps);
  const presetReads = createPresetReads();
  return {
    schemaSteps: [...providerSchemaSteps, ...presetSchemaSteps],
    commands: [
      providerCommands.register,
      presetCommands.registerDefault,
      presetCommands.create,
      presetCommands.revise,
    ],
    reads: [
      providerReads.read,
      presetReads.read,
      presetReads.list,
      presetReads.instructionAttachments,
    ],
  };
}
