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
  type AuthKind,
  type AuthTransport,
  createAuthTransport,
  createFetchTransport,
  createInvokeModelCall,
  credentialUsable,
  providerSecretDestination,
  type SecretAttachLike,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";
import {
  anthropicPacker,
  chatPacker,
  type ModelBinding,
  responsesPacker,
} from "./model-binding.ts";

// preset의 model 선택을 현재 provider·catalog로 검증해 run이 쓸 model 묶음으로 만든다
// (lophn-agent/harness/model R10~R13, harness/provider R10). preset에 선택이 없으면 사람이 정한 기본
// 선택(judgment)을 쓴다. 닿는 protocol은 Anthropic Messages·OpenAI Responses·OpenAI Chat Completions다.
// 계정 없는 loopback provider는 붙일 값이 없고, API key 계정은 core가 감독 pipe로 건네는 값을 인증
// transport가 전송 직전에만 붙인다(platform/secrets#R5). 값을 받지 못하면 요청을 보내지 않는다. OAuth는
// 로그인·갱신(provider#R12~R18)이 runtime에 이어지기 전까지 `unavailable`이다.

const MAX_OUTPUT_TOKENS = 4096;

type Selection = NonNullable<
  Awaited<
    ReturnType<typeof modelDefaultsRead.output.parse>
  >["defaults"]["judgment"]
>;

export type ModelResolverDeps = {
  machine: CoreCall;
  // API key 계정의 값을 전송 직전에 붙이는 port. 없으면 값이 있는 계정은 쓸 수 없다.
  attach?: SecretAttachLike;
  // 마지막 정상 catalog와 동봉 snapshot의 합(derived catalog).
  catalog(): Promise<Result<readonly CatalogEntry[]>>;
  fetch?: typeof fetch;
  nowMs?: () => number;
  timeoutMs?: number | null;
};

export function createModelResolver(deps: ModelResolverDeps) {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const fetching = createFetchTransport(deps.fetch);

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
    if (credential === null && provider.credentials.length > 0) {
      return err({ code: "unavailable", message: "no credential is chosen" });
    }
    // 값이 있는 계정의 전송: API key만 닿고 값은 전송 직전에만 붙는다.
    let transport: AuthTransport = { send: fetching };
    if (credential !== null && credential.kind !== "none") {
      const destination = providerSecretDestination(provider.endpoint);
      if (
        credential.kind !== "api_key" || credential.secret_ref === null ||
        deps.attach === undefined || destination === undefined
      ) {
        return err({
          code: "unavailable",
          message: "this credential cannot be sent from the runtime yet",
        });
      }
      transport = createAuthTransport({
        attach: deps.attach,
        transport: fetching,
        context: {} as never,
        use: {
          sealed_ref: credential.secret_ref.sealed_ref,
          revision: credential.secret_ref.revision,
          purpose: "provider_credential",
          destination,
        },
        operation: "model.call",
        // protocol이 정한 인증 header다. Anthropic은 x-api-key, OpenAI 계열은 Bearer다.
        ...(provider.protocol === "anthropic-messages"
          ? { headerName: "x-api-key", kind: "api_key" as AuthKind }
          : { headerName: "authorization", kind: "bearer" as AuthKind }),
      });
    }
    const invoke = createInvokeModelCall({ transport, nowMs, at: formatAt });

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

    const maxTokens = Math.min(MAX_OUTPUT_TOKENS, limits.output_limit);
    const pack = provider.protocol === "anthropic-messages"
      ? anthropicPacker({ model: selection.model_name, maxTokens })
      : provider.protocol === "openai-responses"
      ? responsesPacker({ model: selection.model_name, maxTokens })
      : chatPacker({
        model: selection.model_name,
        maxTokens,
        provider: provider.definition.key,
      });

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
      // API key는 API 과금이고 계정 없는 연결은 청구를 모른다(provider#R27).
      billing_route: credential?.kind === "api_key" ? "api" : "unknown",
    };
    return ok({
      call,
      preset: input.preset,
      endpoint: provider.endpoint,
      usageRevision: limits.price_basis?.revision ?? "unknown",
      timeoutMs: deps.timeoutMs ?? null,
      pack,
      invoke,
      // provider가 켜져 있고 고른 계정이 그대로 켜져 있으며 값의 판이 바뀌지 않았을 때만 보낸다(R4).
      available: async () => {
        const again = await readOf(deps.machine, providerRead, {
          provider: selection.provider,
        });
        if (!again.ok || !again.value.provider.enabled) return false;
        if (credential === null) return true;
        const current = again.value.provider.credentials.find((entry) =>
          entry.key === credential.key
        );
        return current !== undefined && current.enabled &&
          current.secret_ref?.revision === credential.secret_ref?.revision;
      },
    });
  };
}
