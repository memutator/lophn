import process from "node:process";
import { err, formatAt, ok, type Result } from "../../../base/mod.ts";
import {
  type CallModel,
  type CatalogEntry,
  entitlementAllows,
  type ModelChoice,
  providerRead,
  type ProviderRecord,
  userModelInfoRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { resolveSelection, translateOptions } from "./mod.ts";
import { userEntryOf } from "./user-entry.ts";
import {
  type AuthKind,
  type AuthTransport,
  createAuthTransport,
  createFetchTransport,
  createInvokeModelCall,
  credentialUsable,
  type SecretAttachLike,
  withRequestHeaders,
} from "../providers/mod.ts";
import type { IdleDeps } from "../providers/invoke.ts";
import {
  type ClaudeHost,
  claudeCodeProfile,
  claudeHostOf,
} from "../providers/adapters/claude-code.ts";
import {
  antigravityUserAgent,
  cloudCodeShape,
} from "../providers/adapters/cloud-code.ts";
import { codexShape } from "../providers/adapters/codex.ts";
import { secretDestinationOf } from "../../../protocol/secrets/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import { supportsDeferredTools } from "../providers/definitions.ts";
import {
  anthropicPacker,
  cappedOutput,
  chatPacker,
  cloudCodePacker,
  deferralHeaders,
  type ModelBinding,
  OUTPUT_CAP,
  responsesPacker,
} from "./binding.ts";

// resolved agent가 정한 model 선택을 현재 provider·catalog로 검증해 turn이 쓸 model 묶음으로 만든다
// 어느 층의 선택인지는
// agents가 정했고 여기서는 받은 선택만 본다. 고른 option 값은 default를
// 채운 뒤 호출 형식의 표로 요청 body 조각·header·보낼 model 이름이 되고, catalog에 없는 값이면 요청을
// 보내지 않고 실패한다. provider에는 credential이 하나라 고르지 않는다: 연결이 없거나(Disconnect 포함)
// 그 credential을 쓸 수 없으면 turn은 시작하지 않고 다른 provider·model로 넘어가지 않는다. 닿는 protocol은
// Anthropic Messages·OpenAI Responses·OpenAI Chat Completions다.
// 인증 없는 loopback provider는 붙일 값이 없고, API key와 구독 OAuth access token은 core가 감독 pipe로
// 건네는 값을 인증 transport가 전송 직전에만 붙인다. OAuth token은 core가 건네기 직전에 만료가 가까우면
// 갱신한다. 값을 받지 못하면 요청을 보내지 않는다.

// Anthropic은 thinking 예산보다 max_tokens가 커야 요청을 받는다. 예산이 있으면 답에 쓸 몫을 그 위에 더한다.
function anthropicMaxTokens(
  request_patch: { thinking?: unknown },
  outputLimit: number,
): number {
  const thinking = request_patch.thinking as
    | { budget_tokens?: unknown }
    | undefined;
  const budget =
    typeof thinking?.budget_tokens === "number" ? thinking.budget_tokens : 0;
  return Math.min(outputLimit, OUTPUT_CAP + budget);
}

// catalog에 없는 model, 그리고 사람이 안 적은 칸에 쓰는 기본 한계다. agent의 기본 prompt와 tool 정의만 수십 KB라
// 이보다 작으면 turn이 시작하지 못한다. output은 모르는 server에 큰 max_tokens를 보내 거절당하지 않게 작게 둔다.
const UNLISTED_LIMITS = {
  context_limit: 131072,
  input_limit: 131072,
  output_limit: 4096,
  supports_tools: true,
};

// 사람이 적은 항목의 안 적은 한도(null)를 칸마다 기본값으로 채운다. input은 정해진 context를 따른다.
function withDefaultLimits(entry: CatalogEntry): CatalogEntry {
  if (entry.source !== "user") return entry;
  const context = entry.context_limit ?? UNLISTED_LIMITS.context_limit;
  return {
    ...entry,
    context_limit: context,
    input_limit: entry.input_limit ?? context,
    output_limit: entry.output_limit ?? UNLISTED_LIMITS.output_limit,
    supports_tools: entry.supports_tools ?? UNLISTED_LIMITS.supports_tools,
  };
}

// option 축을 모르는 model의 자리표시 항목이다(wire 변환이 항목을 읽는다).
function unlistedEntry(
  definition: string,
  selection: ModelChoice,
): CatalogEntry {
  return {
    provider_definition: definition,
    model_name: selection.model_name,
    context_limit: null,
    input_limit: null,
    output_limit: null,
    supports_tools: null,
    input_media: ["text"],
    output_media: ["text"],
    options: null,
    preview: null,
    deprecated: null,
    source: "user",
    source_revision: "unlisted",
    checked_at: null,
    received_at: null,
    price_basis: null,
  };
}

type ModelResolverDeps = {
  machine: CoreCall;
  // API key의 값을 전송 직전에 붙이는 port. 없으면 값이 있는 credential은 쓸 수 없다.
  attach?: SecretAttachLike;
  // 마지막 정상 catalog와 동봉 snapshot의 합(derived catalog).
  catalog(): Promise<Result<readonly CatalogEntry[]>>;
  fetch?: typeof fetch;
  nowMs?: () => number;
  idle?: IdleDeps;
  // Claude Code client profile이 싣는 OS·CPU 값이다. 없으면 이 프로세스의 것이다.
  host?: ClaudeHost;
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
    // 연결이 없는 provider(Disconnect 포함)를 고른 agent는 일을 시작하지 않는다.
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
    // 값이 있는 credential의 전송: 값은 전송 직전에만 붙는다.
    let transport: AuthTransport = { send: fetching };
    if (credential.kind !== "none") {
      const destination = secretDestinationOf(provider.endpoint);
      if (
        credential.secret_ref === null ||
        deps.attach === undefined ||
        destination === undefined
      ) {
        return err({
          code: "unavailable",
          message: "this credential cannot be sent from the runtime",
        });
      }
      transport = createAuthTransport({
        attach: deps.attach,
        transport: fetching,
        context: {} as never,
        use: { name: credential.secret_ref.name, destination },
        operation: "model.call",
        // OAuth access token은 Bearer다. API key는 protocol이 정한다: Anthropic은 x-api-key, OpenAI 계열은 Bearer다.
        ...(credential.kind === "api_key" &&
        provider.protocol === "anthropic-messages"
          ? { headerName: "x-api-key", kind: "api_key" as AuthKind }
          : { headerName: "authorization", kind: "bearer" as AuthKind }),
      });
    }

    const catalog = await deps.catalog();
    if (!catalog.ok) return catalog;
    // 사람이 적은 정보가 user 층이라 같은 열쇠의 catalog 항목을 이긴다.
    const typed = await readOf(deps.machine, userModelInfoRead, {});
    if (!typed.ok) return typed;
    const record = typed.value.items.find(
      (item) =>
        item.provider_definition === provider.definition.key &&
        item.model_name === selection.model_name,
    );
    const found =
      record !== undefined
        ? withDefaultLimits(userEntryOf(record))
        : catalog.value.find(
            (candidate) =>
              candidate.provider_definition === provider.definition.key &&
              candidate.model_name === selection.model_name,
          );
    // catalog에 없는 이름은 어느 provider에서든 한계와 option 축을 알 수 없다. 직접 적은 이름은 받고 기본 한계로
    // 돌며 option은 고를 수 없다. 이름이 틀렸으면 provider 호출이 거절한다. 거절하는 것은 구독 계정의 허락 목록
    // 밖 이름뿐이고 resolveSelection의 modelListed가 본다.
    const unlisted = found === undefined;
    const entry = found ?? unlistedEntry(provider.definition.key, selection);
    const resolved = resolveSelection(
      {
        purpose: input.purpose ?? "judgment",
        provider: selection.provider,
        credential_revision:
          credential.kind === "none" ? null : credential.revision,
        model_name: selection.model_name,
        option_values: selection.option_values,
        needs_tools: true,
      },
      found,
      {
        // false는 구독 계정의 허락 목록 밖이다. true는 catalog나 provider가 알려 준 목록에 있는 이름이고, 아무도
        // 올리지 않은 직접 적은 이름은 null(미확인)이다.
        modelListed: (name) =>
          !entitlementAllows(credential.kind, credential.reported_models, name)
            ? false
            : (found !== undefined && found.source !== "user") ||
                credential.reported_models?.includes(name) === true
              ? true
              : null,
      },
      unlisted ? UNLISTED_LIMITS : undefined,
    );
    if (!resolved.ok) return resolved;
    // default를 채운 option 값을 호출 형식의 표로 옮긴다. 표에 없는 값은 가까운 값으로 바꾸지 않고 실패한다.
    const wire = translateOptions({
      protocol: provider.protocol,
      entry,
      option_values: resolved.value.option_values,
    });
    if (!wire.ok) return wire;
    const limits = { ...resolved.value, ...wire.value };

    const deferrable = supportsDeferredTools(
      provider.definition.key,
      selection.model_name,
    );
    const optionHeaders = deferralHeaders(limits.request_headers, deferrable);
    // Claude 구독 token은 Claude Code client profile로만 보낸다. API key 요청 모양은 그대로다.
    const claude =
      credential.kind === "oauth" &&
      provider.definition.oauth?.product === "claude";
    // ChatGPT 구독 token은 Codex backend 모양으로 보낸다.
    const codex =
      credential.kind === "oauth" &&
      provider.definition.oauth?.product === "chatgpt";
    const cloudCode = provider.protocol === "cloud-code-assist";
    const project = credential.account?.project_id ?? null;
    if (cloudCode && project === null) {
      return err({
        code: "unavailable",
        message: "the Antigravity account has no project; sign in again",
      });
    }
    const platform = deps.host ?? claudeHostOf(process.platform, process.arch);
    const invoke = createInvokeModelCall({
      transport: withRequestHeaders(transport, optionHeaders),
      nowMs,
      at: formatAt,
      idle: deps.idle,
      ...(claude
        ? {
            shape: claudeCodeProfile({
              provider: provider.id,
              account: credential.account,
              host: platform,
              betas: Object.entries(optionHeaders).find(
                ([name]) => name.toLowerCase() === "anthropic-beta",
              )?.[1],
            }),
          }
        : codex
          ? {
              shape: codexShape({
                provider: provider.id,
                account: credential.account,
              }),
            }
          : cloudCode && project !== null
            ? {
                shape: cloudCodeShape({
                  project,
                  model: limits.sent_model_name,
                  userAgent: antigravityUserAgent(process.platform),
                  nowMs,
                }),
              }
            : {}),
    });
    const requestPatch = limits.request_patch;
    const images = limits.input_media.includes("image");
    const pack =
      provider.protocol === "anthropic-messages"
        ? anthropicPacker({
            model: limits.sent_model_name,
            images,
            maxTokens: anthropicMaxTokens(requestPatch, limits.output_limit),
            native: deferrable,
            requestPatch,
          })
        : provider.protocol === "openai-responses"
          ? responsesPacker({
              model: limits.sent_model_name,
              images,
              maxTokens: cappedOutput(limits),
              requestPatch,
            })
          : provider.protocol === "cloud-code-assist"
            ? cloudCodePacker({
                model: limits.sent_model_name,
                images,
                requestPatch,
              })
            : chatPacker({
                model: limits.sent_model_name,
                images,
                maxTokens: cappedOutput(limits),
                provider: provider.definition.key,
                requestPatch,
              });

    const call: CallModel = {
      provider: selection.provider,
      name: selection.model_name,
      protocol: provider.protocol,
      credential_revision:
        credential.kind === "none" ? null : credential.revision,
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
      // API key는 API 과금이고 인증 없는 연결은 청구를 모른다.
      billing_route:
        credential.kind === "api_key"
          ? "api"
          : credential.kind === "oauth"
            ? "subscription"
            : "unknown",
    };
    return ok({
      call,
      inputMedia: limits.input_media,
      endpoint: provider.endpoint,
      usageRevision: limits.price_basis?.revision ?? "unknown",
      pack,
      invoke,
      deferrable,
      // provider가 아직 연결돼 있고 같은 연결일 때만 보낸다. Disconnect하면 읽기가 없다고 답하고,
      // 같은 ID로 다시 Connect하면 logged_in_at이 달라진다.
      available: async () => {
        const again = await readOf(deps.machine, providerRead, {
          provider: selection.provider,
        });
        if (!again.ok) return false;
        const current = again.value.provider.credential;
        return (
          current.kind === credential.kind &&
          current.secret_ref?.name === credential.secret_ref?.name &&
          current.logged_in_at === credential.logged_in_at
        );
      },
    });
  };
}
