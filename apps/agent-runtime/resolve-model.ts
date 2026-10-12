import { err, formatAt, ok, type Result } from "../../packages/base/mod.ts";
import {
  type CallModel,
  type CatalogEntry,
  type ModelChoice,
  providerRead,
  type ProviderRecord,
} from "../../packages/protocol/lophn-agent/mod.ts";
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
// (lophn-agent/harness/model R9~R13, R16, R22~R24, harness/provider R4, R10, R28). 어느 층의 선택인지는
// agents가 정했고 여기서는 받은 선택만 본다. 고른 option 값은 default를
// 채운 뒤 호출 형식의 표로 요청 body 조각·header·보낼 model 이름이 되고, catalog에 없는 값이면 요청을
// 보내지 않고 실패한다. provider에는 credential이 하나라 고르지 않는다: 연결이 없거나(Disconnect 포함)
// 그 credential을 쓸 수 없으면 run은 시작하지 않고 다른 provider·model로 넘어가지 않는다. 닿는 protocol은
// Anthropic Messages·OpenAI Responses·OpenAI Chat Completions다.
// 인증 없는 loopback provider는 붙일 값이 없고, API key는 core가 감독 pipe로 건네는 값을 인증
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
  // API key의 값을 전송 직전에 붙이는 port. 없으면 값이 있는 credential은 쓸 수 없다.
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
    model: ModelChoice;
    // 판단이 아니라 정리(제목·요약·압축)에 쓰는 model이면 organizing이다. 검증 규칙은 같다.
    purpose?: "judgment" | "organizing";
  }): Promise<Result<ModelBinding>> {
    const selection = input.model;
    const read = await readOf(deps.machine, providerRead, {
      provider: selection.provider,
    });
    // 연결이 없는 provider(Disconnect 포함)를 고른 agent는 일을 시작하지 않는다(provider#R28).
    if (!read.ok) {
      return read.error.code === "not_found"
        ? err({ code: "unavailable", message: "the provider is not connected" })
        : read;
    }
    const provider: ProviderRecord = read.value.provider;
    const at = nowMs();
    const credential = provider.credential;
    if (
      !credentialUsable(credential, {
        modelName: selection.model_name,
        nowMs: at,
      })
    ) {
      return err({ code: "unavailable", message: "no usable credential" });
    }
    // 값이 있는 credential의 전송: API key만 닿고 값은 전송 직전에만 붙는다.
    let transport: AuthTransport = { send: fetching };
    if (credential.kind !== "none") {
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
        purpose: input.purpose ?? "judgment",
        provider: selection.provider,
        credential_revision: credential.kind === "none"
          ? null
          : credential.revision,
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

    const call: CallModel = {
      provider: selection.provider,
      name: selection.model_name,
      protocol: provider.protocol,
      credential_revision: credential.kind === "none"
        ? null
        : credential.revision,
      // 고른 값과 default를 채운 뒤 요청에 실제로 실은 값을 따로 남긴다.
      option_values: {
        requested: selection.option_values,
        applied: limits.option_values,
      },
      limits: {
        context_limit: limits.context_limit,
        input_limit: limits.input_limit,
        output_limit: limits.output_limit,
        supports_tools: limits.supports_tools,
      },
      catalog_basis: limits.basis as Record<string, never>,
      price_basis: limits.price_basis,
      // API key는 API 과금이고 인증 없는 연결은 청구를 모른다(provider#R27).
      billing_route: credential.kind === "api_key" ? "api" : "unknown",
    };
    return ok({
      call,
      endpoint: provider.endpoint,
      usageRevision: limits.price_basis?.revision ?? "unknown",
      timeoutMs: deps.timeoutMs ?? null,
      pack,
      invoke,
      // provider가 아직 연결돼 있고 credential의 secret 판이 바뀌지 않았을 때만 보낸다(R4). Disconnect하면
      // 읽기가 없다고 답하고, 같은 ID로 다시 Connect하면 secret 참조가 달라진다.
      available: async () => {
        const again = await readOf(deps.machine, providerRead, {
          provider: selection.provider,
        });
        if (!again.ok) return false;
        const current = again.value.provider.credential;
        return current.kind === credential.kind &&
          current.secret_ref?.sealed_ref ===
            credential.secret_ref?.sealed_ref &&
          current.secret_ref?.revision === credential.secret_ref?.revision;
      },
    });
  };
}
