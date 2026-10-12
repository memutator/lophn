import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import type {
  AgentRole,
  CatalogEntry,
  ModelChoice,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { providerRead } from "../../packages/contracts/lophn-agent/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import { CATALOG_OPTIONS } from "../../packages/contracts/lophn-agent/testing/mod.ts";
import type { PromptRequest } from "../../packages/lophn-agent/harness/prompt-assemble/mod.ts";
import type { ModelBinding } from "./model-binding.ts";
import { createModelResolver } from "./resolve-model.ts";

// harness/model#R9, R16, R22~R24: resolved agent가 정한 model 선택을 provider·catalog로 검증하고 option 값을 요청에 싣는다.
// 어느 층의 선택을 쓰는지(Workspace role slot, 자리, 정의, session)는 agents가 정하고 여기는 받은 선택만 본다.
// core 호출과 provider 전송은 fake다. 네트워크를 쓰지 않는다.

const OPENAI = "pvd_01arz3ndektsv4rrffq69g5fav";
const ANTHROPIC = "pvd_01arz3ndektsv4rrffq69g5faw";
const XAI = "pvd_01arz3ndektsv4rrffq69g5fax";

const PROVIDERS = {
  [OPENAI]: {
    key: "openai",
    protocol: "openai-responses",
    protocols: ["openai-responses", "openai-chat-completions"],
  },
  [ANTHROPIC]: {
    key: "anthropic",
    protocol: "anthropic-messages",
    protocols: ["anthropic-messages"],
  },
  [XAI]: {
    key: "xai",
    protocol: "openai-chat-completions",
    protocols: ["openai-chat-completions"],
  },
} as const;

function providerRecord(id: keyof typeof PROVIDERS) {
  const known = PROVIDERS[id];
  return {
    id,
    name: `${known.key} loopback`,
    definition: {
      key: known.key,
      display_name: known.key,
      protocols: known.protocols,
      auth_kinds: ["none"],
      models_endpoint: null,
      oauth: null,
      revision: "1",
    },
    endpoint: "http://127.0.0.1:9/v1",
    protocol: known.protocol,
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
    },
    revision: 1,
  };
}

function choice(
  provider: string,
  model: string,
  option_values: Record<string, string> = {},
) {
  return { provider, model_name: model, option_values };
}

type World = {
  model: ModelChoice;
  // false인 provider는 Disconnect해 연결이 없다.
  providers?: Partial<Record<keyof typeof PROVIDERS, boolean>>;
  catalog?: readonly CatalogEntry[];
};

function setup(world: World) {
  const sent: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }[] = [];
  const fakeFetch: typeof fetch = (input, init) => {
    sent.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(String(init?.body)),
    });
    return Promise.resolve(new Response("{}", { status: 500 }));
  };
  const machine = (path: string, body: unknown): Promise<Result<unknown>> => {
    if (path === routePath(providerRead)) {
      const id = (body as { provider: keyof typeof PROVIDERS }).provider;
      if (!(id in PROVIDERS) || world.providers?.[id] === false) {
        return Promise.resolve(err({ code: "not_found", message: "no" }));
      }
      return Promise.resolve(ok({
        provider: providerRecord(id),
        as_of_seq: "3",
        next_cursor: null,
      }));
    }
    return Promise.resolve(err({ code: "not_found", message: path }));
  };
  const resolver = createModelResolver({
    machine,
    catalog: () => Promise.resolve(ok(world.catalog ?? CATALOG_OPTIONS)),
    fetch: fakeFetch,
  });
  const resolve = (_input: { role: AgentRole }) =>
    resolver({ model: world.model });
  return { sent, resolve };
}

const REQUEST: PromptRequest = {
  system: [{ layer: "product", text: "rules" }],
  tools: [],
  messages: [{ role: "user", parts: [{ kind: "text", text: "hi" }] }],
};

async function fire(binding: ModelBinding) {
  const packed = binding.pack(REQUEST);
  const body = packed.body as Record<string, unknown>;
  const result = await binding.invoke({
    callId: "mcl_01arz3ndektsv4rrffq69g5fav",
    run: null,
    session: null,
    purpose: "judgment",
    model: binding.call,
    endpoint: binding.endpoint,
    inputHash: "a".repeat(64),
    contextBasisHash: "a".repeat(64),
    body,
    timeoutMs: null,
    usageRevision: binding.usageRevision,
  }, new AbortController().signal);
  assert(result.ok, JSON.stringify(result));
  return body;
}

async function bind(
  world: World,
  role: "lophn" | "context_engineer" | "app_engineer" | "operator" = "lophn",
) {
  const { sent, resolve } = setup(world);
  const resolved = await resolve({ role });
  assert(resolved.ok, JSON.stringify(resolved));
  return { binding: resolved.value, sent };
}

async function fails(
  world: World,
  role: "lophn" | "context_engineer" | "app_engineer" | "operator" = "lophn",
) {
  const { resolve } = setup(world);
  const resolved = await resolve({ role });
  assert(!resolved.ok, "expected a failure");
  return resolved.error;
}

Deno.test("lophn-agent/harness/model#R9 [agent-I10a]: the run takes the model choice the resolved agent gives, whatever the provider protocol", async () => {
  const lophn = await bind({ model: choice(OPENAI, "gpt-4-1") }, "lophn");
  assertEquals(lophn.binding.call.provider, OPENAI);
  assertEquals(lophn.binding.call.name, "gpt-4-1");
  const operator = await bind(
    { model: choice(ANTHROPIC, "claude-sonnet-4-5") },
    "operator",
  );
  assertEquals(operator.binding.call.provider, ANTHROPIC);
  assertEquals(operator.binding.call.protocol, "anthropic-messages");
  assertEquals(operator.binding.call.name, "claude-sonnet-4-5");
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: an OpenAI Speed Fast choice puts the priority tier and the effort in the request body", async () => {
  const { binding, sent } = await bind({
    model: choice(OPENAI, "gpt-5-5", { effort: "very_high", speed: "fast" }),
  });
  assertEquals(binding.call.option_values.applied, {
    effort: "very_high",
    speed: "fast",
  });
  assertEquals(binding.call.option_values, {
    requested: { effort: "very_high", speed: "fast" },
    applied: { effort: "very_high", speed: "fast" },
  });
  const body = await fire(binding);
  assertEquals(body.model, "gpt-5-5");
  assertEquals(body.reasoning, { effort: "xhigh" });
  assertEquals(body.service_tier, "priority");
  assertEquals(sent[0].body, { ...body, stream: true });
  assertEquals(sent[0].url, "http://127.0.0.1:9/v1/responses");
});

Deno.test("lophn-agent/harness/model#R16 [agent-I15]: an axis the choice leaves out takes the catalog default and an unknown default sends nothing", async () => {
  const { binding } = await bind({
    model: choice(OPENAI, "gpt-5-5"),
  });
  // effort는 확인된 기본값 medium이 채워지고 speed는 기본값이 없어 필드가 없다.
  assertEquals(binding.call.option_values.applied, { effort: "medium" });
  // 기록은 고른 값(없음)과 default를 채워 실제로 실은 값을 따로 남긴다.
  assertEquals(binding.call.option_values, {
    requested: {},
    applied: { effort: "medium" },
  });
  const body = await fire(binding);
  assertEquals(body.reasoning, { effort: "medium" });
  assertEquals("service_tier" in body, false);
  // option 축이 없는 model은 option 필드가 하나도 없다.
  const plain = await bind({
    model: choice(OPENAI, "gpt-4-1"),
  });
  assertEquals(plain.binding.call.option_values.applied, {});
  assertEquals(plain.binding.call.option_values, {
    requested: {},
    applied: {},
  });
  // 기록에 옛 추론 수준 칸과 preset 칸은 없다.
  assertEquals("requested_reasoning" in plain.binding.call, false);
  assertEquals("preset" in plain.binding, false);
  const plainBody = await fire(plain.binding);
  assertEquals("reasoning" in plainBody, false);
  assertEquals("service_tier" in plainBody, false);
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: Anthropic Speed Fast carries the body piece and the beta header", async () => {
  const { binding, sent } = await bind({
    model: choice(ANTHROPIC, "claude-opus-4-8", {
      effort: "high",
      speed: "fast",
    }),
  }, "app_engineer");
  const body = await fire(binding);
  assertEquals(body.speed, "fast");
  assertEquals(body.thinking, { type: "adaptive" });
  assertEquals(body.output_config, { effort: "high" });
  assertEquals(sent[0].headers["anthropic-beta"], "fast-mode-2026-02-01");
  assertEquals(sent[0].url, "http://127.0.0.1:9/v1/messages");
  // 같은 model의 Standard는 요청에 더할 것이 없고 header도 없다.
  const standard = await bind({
    model: choice(ANTHROPIC, "claude-opus-4-8", {
      effort: "high",
      speed: "standard",
    }),
  }, "app_engineer");
  const standardBody = await fire(standard.binding);
  assertEquals("speed" in standardBody, false);
  assertEquals("anthropic-beta" in standard.sent[0].headers, false);
});

Deno.test("lophn-agent/harness/model#R22 [agent-I15]: a model id wire changes only the name that is sent", async () => {
  const { binding, sent } = await bind({
    model: choice(XAI, "grok-4", { speed: "fast" }),
  }, "context_engineer");
  // 기록하는 model 이름은 고른 이름 그대로고 요청에 가는 이름만 바뀐다.
  assertEquals(binding.call.name, "grok-4");
  const body = await fire(binding);
  assertEquals(body.model, "grok-4-fast");
  assertEquals(sent[0].body, { ...body, stream: true });
});

Deno.test("lophn-agent/harness/model#R17 [agent-I15]: a budget effort is clamped to the confirmed range and leaves room for the answer", async () => {
  const { binding } = await bind({
    model: choice(ANTHROPIC, "claude-sonnet-4-5", { effort: "maximum" }),
  });
  const body = await fire(binding);
  // 기준 예산 32768이 확인된 최대 24000 안으로 줄어든다.
  assertEquals(body.thinking, { type: "enabled", budget_tokens: 24000 });
  // 답에 쓸 token이 예산 뒤에 남아야 요청이 받아들여진다.
  assert((body.max_tokens as number) > 24000);
  assert((body.max_tokens as number) <= 64000);
  const off = await bind({
    model: choice(ANTHROPIC, "claude-sonnet-4-5", { effort: "off" }),
  });
  const offBody = await fire(off.binding);
  assertEquals(offBody.thinking, { type: "disabled" });
  assertEquals(offBody.max_tokens, 4096);
});

Deno.test("lophn-agent/harness/model#R24 [agent-I15]: a stored value the catalog no longer declares fails before any request and is not replaced", async () => {
  const { sent, resolve } = setup({
    model: choice(OPENAI, "gpt-5-5", { effort: "maximum" }),
  });
  const resolved = await resolve({ role: "lophn" });
  assert(!resolved.ok);
  assertEquals(resolved.error.code, "invalid_input");
  assertEquals(sent.length, 0);
});

Deno.test("lophn-agent/harness/model#R9 [agent-I15]: a model without catalog facts or a disconnected provider does not start", async () => {
  // catalog에 없는 model은 확인된 한계가 없어 쓸 수 없다(R13).
  const missing = await fails({
    model: choice(OPENAI, "gpt-9"),
  });
  assertEquals(missing.code, "invalid_input");
  const off = await fails({
    model: choice(OPENAI, "gpt-4-1"),
    providers: { [OPENAI]: false },
  });
  assertEquals(off.code, "unavailable");
});
