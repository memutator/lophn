import type { ValidateDeps } from "../../../presets/mod.ts";

// run ledger 테스트 fixture. preset·assignment 행을 심는 데 필요한 만큼만 둔다.
// 제품 코드와 mod.ts는 import하지 않는다. 실제 provider를 부르지 않는다.

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";

let counter = 0;

export function envelope(
  command: string,
  input: unknown,
  compare: unknown = {},
) {
  counter++;
  return {
    command,
    input,
    compare,
    idempotency_key: `run-k-${counter}`,
    prepared: [] as string[],
  };
}

export function presetDefinitionJson(kind: string) {
  return {
    kind,
    name: "Review",
    origin: "product",
    prompt: "a".repeat(64),
    capability: { bundles: [{ name: "read-only", revision: 1 }], tools: [] },
    context: [{ kind: "document", target: DOC, section: null }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: {
      provider: PROVIDER,
      credentials: ["key-main"],
      model_name: "claude-haiku-4-5",
      reasoning_level: "medium",
      options: {},
    },
    organizing_model: null,
    instructions: [],
  };
}

export function presetValidateDeps(): ValidateDeps {
  const tools = ["doc.read", "doc.list", "doc.write", "doc.revert"];
  return {
    bundles: new Map([["read-only", ["doc.read", "doc.list"]]]),
    mcpServers: new Map(),
    roleCaps: new Map([
      ["lophn", { tools: ["doc.read", "doc.list"] }],
      ["app_engineer", { tools }],
      ["context_engineer", { tools }],
      ["operator", { tools }],
    ]),
    definitionKey: (provider) =>
      provider === PROVIDER ? "anthropic" : undefined,
    modelListed: (definition, name) =>
      definition === "anthropic" && name === "claude-haiku-4-5",
    credentialKeys: (provider) => provider === PROVIDER ? ["key-main"] : [],
    catalogEntry: (definition, name) =>
      definition === "anthropic" && name === "claude-haiku-4-5"
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
  };
}
