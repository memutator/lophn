import { err, formatAt, ok, type Result } from "../../packages/base/mod.ts";
import {
  type CallModel,
  type CatalogEntry,
  effortValueSchema,
  type ModelChoice,
  OPTION_AXIS_EFFORT,
  providerRead,
  type ProviderRecord,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  resolveSelection,
  translateOptions,
} from "../../packages/lophn-agent/harness/model/mod.ts";
import {
  type AuthKind,
  type AuthTransport,
  createAuthTransport,
  createFetchTransport,
  createInvokeModelCall,
  credentialUsable,
  providerSecretDestination,
  type SecretAttachLike,
  withRequestHeaders,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";
import {
  anthropicPacker,
  chatPacker,
  type ModelBinding,
  responsesPacker,
} from "./model-binding.ts";

// resolved agent가 정한 model 선택을 현재 provider·catalog로 검증해 run이 쓸 model 묶음으로 만든다
// (lophn-agent/harness/model R9~R13, R16, R22~R24, harness/provider R10). 어느 층의 선택인지는
// agents가 정했고 여기서는 받은 선택만 본다. 고른 option 값은 default를
// 채운 뒤 호출 형식의 표로 요청 body 조각·header·보낼 model 이름이 되고, catalog에 없는 값이면 요청을
// 보내지 않고 실패한다. 계정은 provider의 순서에서 첫 usable 계정이다. 닿는 protocol은 Anthropic Messages·OpenAI Responses·OpenAI Chat
// Completions다.
// 계정 없는 loopback provider는 붙일 값이 없고, API key 계정은 core가 감독 pipe로 건네는 값을 인증
// transport가 전송 직전에만 붙인다(platform/secrets#R5). 값을 받지 못하면 요청을 보내지 않는다. OAuth는
// 로그인·갱신(provider#R12~R18)이 runtime에 이어지기 전까지 `unavailable`이다.

const MAX_OUTPUT_TOKENS = 4096;

// Anthropic은 thinking 예산보다 max_tokens가 커야 요청을 받는다. 예산이 있으면 답에 쓸 몫을 그 위에 더한다.
function anthropicMaxTokens(
  request_patch: { thinking?: unknown },
  outputLimit: number,
): number {
  const thinking = request_patch.thinking as
    | { budget_tokens?: unknown }
    | undefined;
  const budget = typeof thinking?.budget_tokens === "number"
    ? thinking.budget_tokens
    : 0;
  return Math.min(outputLimit, MAX_OUTPUT_TOKENS + budget);
}

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
    // model call 기록의 preset 칸이 agent hash로 바뀔 때까지 기록이 쓰는 값이다.
    preset: { id: string; revision: number };
    model: ModelChoice;
  }): Promise<Result<ModelBinding>> {
    const selection = input.model;
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
    // 계정은 provider가 고른다: provider의 순서에서 켜진 계정 가운데 첫 usable 계정이다. 계정이 없는
    // 연결(loopback)만 계정 없이 간다.
    const at = nowMs();
    const keys = [...provider.credentials]
      .sort((a, b) => a.order - b.order)
      .filter((entry) => entry.enabled)
      .map((entry) => entry.key);
    const credential =
      keys.map((key) =>
        provider.credentials.find((entry) => entry.key === key) ?? null
      ).find((entry) =>
        credentialUsable(entry, { modelName: selection.model_name, nowMs: at })
      ) ?? null;
    if (credential === null && provider.credentials.length > 0) {
      return err({ code: "unavailable", message: "no usable credential" });
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

    const catalog = await deps.catalog();
    if (!catalog.ok) return catalog;
    const entry = catalog.value.find((candidate) =>
      candidate.provider_definition === provider.definition.key &&
      candidate.model_name === selection.model_name
    );
    // catalog에 없는 model은 한계와 option 축을 알 수 없어 쓰지 않는다(R13). 명시 한계 보완은 아직 없다.
    if (entry === undefined) {
      return err({
        code: "invalid_input",
        message: "the model is not in the catalog, so its limits are unknown",
      });
    }
    const resolved = resolveSelection(
      {
        purpose: "judgment",
        provider: selection.provider,
        credentials: keys,
        model_name: selection.model_name,
        option_values: selection.option_values,
        needs_tools: true,
      },
      entry,
      { modelListed: () => true },
      undefined,
    );
    if (!resolved.ok) return resolved;
    // default를 채운 option 값을 호출 형식의 표로 옮긴다. 표에 없는 값은 가까운 값으로 바꾸지 않고 실패한다(R24).
    const wire = translateOptions({
      protocol: provider.protocol,
      entry,
      option_values: resolved.value.option_values,
    });
    if (!wire.ok) return wire;
    const limits = { ...resolved.value, ...wire.value };

    const invoke = createInvokeModelCall({
      transport: withRequestHeaders(transport, limits.request_headers),
      nowMs,
      at: formatAt,
    });
    const requestPatch = limits.request_patch;
    const pack = provider.protocol === "anthropic-messages"
      ? anthropicPacker({
        model: limits.sent_model_name,
        maxTokens: anthropicMaxTokens(requestPatch, limits.output_limit),
        requestPatch,
      })
      : provider.protocol === "openai-responses"
      ? responsesPacker({
        model: limits.sent_model_name,
        maxTokens: Math.min(MAX_OUTPUT_TOKENS, limits.output_limit),
        requestPatch,
      })
      : chatPacker({
        model: limits.sent_model_name,
        maxTokens: Math.min(MAX_OUTPUT_TOKENS, limits.output_limit),
        provider: provider.definition.key,
        requestPatch,
      });

    const effort = effortValueSchema.safeParse(
      limits.option_values[OPTION_AXIS_EFFORT],
    );
    const call: CallModel = {
      provider: selection.provider,
      name: selection.model_name,
      protocol: provider.protocol,
      credential_key: credential?.key ?? null,
      credential_revision: credential?.revision ?? null,
      options: limits.option_values,
      // 호출 기록의 reasoning 칸은 option 값 기록으로 바뀔 때까지 effort 값을 그대로 옮긴다.
      requested_reasoning: effort.success ? effort.data : "provider_default",
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
