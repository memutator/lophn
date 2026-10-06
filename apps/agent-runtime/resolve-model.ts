import { err, formatAt, ok, type Result } from "../../packages/base/mod.ts";
import {
  type CallModel,
  type CatalogEntry,
  modelDefaultsRead,
  providerRead,
  type ProviderRecord,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { resolveSelection } from "../../packages/lophn-agent/harness/model/mod.ts";
import {
  createAuthTransport,
  createFetchTransport,
  createInvokeModelCall,
  credentialUsable,
  type SecretAttachLike,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";
import { anthropicPacker, type ModelBinding } from "./model-binding.ts";

// preset의 model 선택을 현재 provider·catalog로 검증해 run이 쓸 model 묶음으로 만든다
// (lophn-agent/harness/model R10~R13, harness/provider R10). preset에 선택이 없으면 사람이 정한 기본
// 선택(judgment)을 쓴다. 지금 닿는 protocol은 Anthropic Messages뿐이고 계정 없는 loopback provider만
// 보낸다. 값이 있는 계정(API key·OAuth)의 전송 부착은 platform secret 전송 부착이 runtime에 이어진 뒤에
// 채운다. 그 전에는 그 선택이 있는 run을 `unavailable`로 둔다.

const MAX_OUTPUT_TOKENS = 4096;

type Selection = NonNullable<
  Awaited<
    ReturnType<typeof modelDefaultsRead.output.parse>
  >["defaults"]["judgment"]
>;

export type ModelResolverDeps = {
  machine: CoreCall;
  // 마지막 정상 catalog와 동봉 snapshot의 합(derived catalog).
  catalog(): Promise<Result<readonly CatalogEntry[]>>;
  fetch?: typeof fetch;
  nowMs?: () => number;
  timeoutMs?: number | null;
};

export function createModelResolver(deps: ModelResolverDeps) {
  const nowMs = deps.nowMs ?? (() => Date.now());
  // 계정이 없는 loopback provider에는 붙일 값이 없다.
  const attach: SecretAttachLike = {
    send: (_input, transmit) => transmit(""),
  };
  const invoke = createInvokeModelCall({
    transport: createAuthTransport({
      attach,
      transport: createFetchTransport(deps.fetch),
      context: {} as never,
      use: {} as never,
      operation: "model.call",
      headerName: "x-api-key",
      kind: "api_key",
    }),
    nowMs,
    at: formatAt,
  });

  return async function resolveModel(input: {
    preset: { id: string; revision: number };
    definition: unknown;
  }): Promise<Result<ModelBinding>> {
    const preset = input.definition as { model?: Selection | null };
    let selection: Selection | null = preset.model ?? null;
    if (selection === null) {
      const defaults = await readOf(deps.machine, modelDefaultsRead, {});
      if (!defaults.ok) return defaults;
      selection = defaults.value.defaults.judgment;
    }
    if (selection === null) {
      return err({
        code: "unavailable",
        message: "no model is chosen for this preset",
      });
    }
    const read = await readOf(deps.machine, providerRead, {
      provider: selection.provider,
    });
    if (!read.ok) return read;
    const provider: ProviderRecord = read.value.provider;
    if (!provider.enabled) {
      return err({
        code: "unavailable",
        message: "the provider is turned off",
      });
    }
    if (provider.protocol !== "anthropic-messages") {
      return err({
        code: "unavailable",
        message: "this provider protocol is not connected to the runtime yet",
      });
    }

    // 계정은 preset이 적은 순서의 첫 usable 계정이다. 적지 않았고 provider에도 없으면 계정 없이 간다.
    const at = nowMs();
    const keys = selection.credentials;
    const credential =
      keys.map((key) =>
        provider.credentials.find((entry) => entry.key === key) ?? null
      ).find((entry) =>
        credentialUsable(entry, { modelName: selection.model_name, nowMs: at })
      ) ?? null;
    if (keys.length > 0 && credential === null) {
      return err({ code: "unavailable", message: "no usable credential" });
    }
    if (credential !== null && credential.kind !== "none") {
      return err({
        code: "unavailable",
        message: "sending a credential is not connected to the runtime yet",
      });
    }
    if (credential === null && provider.credentials.length > 0) {
      return err({ code: "unavailable", message: "no credential is chosen" });
    }

    const catalog = await deps.catalog();
    if (!catalog.ok) return catalog;
    const entry = catalog.value.find((candidate) =>
      candidate.provider_definition === provider.definition.key &&
      candidate.model_name === selection.model_name
    );
    const resolved = resolveSelection(
      {
        purpose: "judgment",
        provider: selection.provider,
        credentials: selection.credentials,
        model_name: selection.model_name,
        reasoning_level: selection.reasoning_level,
        needs_tools: true,
        options: selection.options,
      },
      entry,
      { modelListed: () => (entry === undefined ? null : true) },
      undefined,
    );
    if (!resolved.ok) return resolved;
    const limits = resolved.value;

    const call: CallModel = {
      provider: selection.provider,
      name: selection.model_name,
      protocol: provider.protocol,
      credential_key: credential?.key ?? null,
      credential_revision: credential?.revision ?? null,
      options: selection.options,
      requested_reasoning: limits.reasoning_level,
      applied_reasoning: null,
      limits: {
        context_limit: limits.context_limit,
        input_limit: limits.input_limit,
        output_limit: limits.output_limit,
        supports_tools: limits.supports_tools,
      },
      catalog_basis: limits.basis as Record<string, never>,
      price_basis: limits.price_basis,
      billing_route: "unknown",
    };
    return ok({
      call,
      preset: input.preset,
      endpoint: provider.endpoint,
      usageRevision: limits.price_basis?.revision ?? "unknown",
      timeoutMs: deps.timeoutMs ?? null,
      pack: anthropicPacker({
        model: selection.model_name,
        maxTokens: Math.min(MAX_OUTPUT_TOKENS, limits.output_limit),
      }),
      invoke,
      available: async () => {
        const again = await readOf(deps.machine, providerRead, {
          provider: selection.provider,
        });
        return again.ok && again.value.provider.enabled;
      },
    });
  };
}
