// `createModelResolver`에 replay fetch를 꽂아 protocol별 ModelBinding을 만들고 한 번 부른다.
// provider는 인증 없는 loopback 기록으로 직접 만든다(내장 정의와 대조하지 않는다).

import { err, manualClock, ok } from "../../../packages/base/mod.ts";
import {
  providerRead,
  type ProviderRecord,
  userModelInfoRead,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import { routePath } from "../../../packages/protocol/base/mod.ts";
import type { CatalogEntry } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { ModelCallOutput } from "../../../packages/core/lophn-agent/providers/work.ts";
import { snapshotCatalogEntry } from "../../../packages/core/lophn-agent/models/mod.ts";
import type { ModelBinding } from "../../../packages/core/lophn-agent/models/binding.ts";
import type { IdleDeps } from "../../../packages/core/lophn-agent/providers/invoke.ts";
import { createModelResolver } from "../../../packages/core/lophn-agent/models/resolve.ts";
import type { PromptTool } from "../../../packages/core/lophn-agent/prompt-assembly/mod.ts";

export type WireProtocol =
  | "anthropic-messages"
  | "openai-responses"
  | "openai-chat-completions";

const PROVIDER_ID = "pvd_00000000000000000000000000";

const TARGET = {
  "anthropic-messages": { key: "anthropic", model: "claude-sonnet-4-5" },
  "openai-responses": { key: "openai", model: "gpt-5" },
  "openai-chat-completions": { key: "openai", model: "gpt-5" },
} as const;

// 시각은 고정이다. retry_at 같은 기대 값을 이 시각에서 계산한다.
export const WIRE_START_MS = Date.parse("2026-01-01T00:00:00.000Z");

export function wireClock() {
  return manualClock(WIRE_START_MS);
}

export async function wireBinding(
  protocol: WireProtocol,
  fetch: typeof globalThis.fetch,
  clock = wireClock(),
  idle?: IdleDeps,
): Promise<ModelBinding> {
  const target = TARGET[protocol];
  const provider: ProviderRecord = {
    id: PROVIDER_ID,
    name: "wire test",
    definition: {
      key: target.key,
      display_name: target.key,
      protocols: [protocol],
      auth_kinds: ["none"],
      models_endpoint: null,
      oauth: null,
      revision: "test",
    },
    endpoint: "http://127.0.0.1:1",
    protocol,
    credential: {
      kind: "none",
      secret_ref: null,
      revision: 1,
      state: "available",
      unavailable_reason: null,
      until: null,
      expires_at: null,
      logged_in_at: null,
      refreshed_at: null,
      model_blocks: [],
      reported_models: null,
    },
    revision: 1,
  };
  const entry = snapshotCatalogEntry(target.key, target.model);
  if (entry === undefined) throw new Error("snapshot lacks the wire model");
  const catalog: readonly CatalogEntry[] = [entry];
  const resolve = createModelResolver({
    machine: (path) =>
      Promise.resolve(
        path === routePath(providerRead)
          ? ok({ provider, as_of_seq: "0", next_cursor: null })
          : path === routePath(userModelInfoRead)
            ? ok({ seq: "0", items: [], as_of_seq: "0", next_cursor: null })
            : err({ code: "not_found", message: path }),
      ),
    catalog: () => Promise.resolve(ok(catalog)),
    fetch,
    nowMs: () => clock.nowMs(),
    idle,
  });
  const bound = await resolve({
    model: {
      provider: PROVIDER_ID,
      model_name: target.model,
      option_values: {},
    },
  });
  if (!bound.ok) throw new Error(`resolve failed: ${bound.error.message}`);
  return bound.value;
}

export async function callWire(
  binding: ModelBinding,
  input: { tools?: PromptTool[]; user?: string } = {},
): Promise<ModelCallOutput> {
  const packed = binding.pack({
    system: [{ layer: "role", text: "You are a test agent." }],
    tools: input.tools ?? [],
    messages: [
      {
        role: "user",
        parts: [{ kind: "text", text: input.user ?? "hello" }],
      },
    ],
  });
  const called = await binding.invoke(
    {
      callId: "mcl_wire",
      turn: null,
      session: null,
      purpose: "judgment",
      model: binding.call,
      endpoint: binding.endpoint,
      inputHash: "h",
      contextBasisHash: "h",
      body: packed.body as Record<string, unknown>,
      usageRevision: binding.usageRevision,
    },
    new AbortController().signal,
  );
  if (!called.ok) throw new Error(`invoke failed: ${called.error.message}`);
  return called.value;
}
