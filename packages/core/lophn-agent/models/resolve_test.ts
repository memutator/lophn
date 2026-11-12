import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  providerRead,
  type ProviderRecord,
  userModelInfoRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { builtinProviderDefinition } from "../providers/definitions.ts";
import { bundledSnapshot } from "./snapshot-catalog.ts";
import { createModelResolver } from "./resolve.ts";

type Account = {
  kind: "none" | "oauth";
  reported_models: string[] | null;
};

function resolverFor(
  definitionKey: string,
  account: Account = { kind: "none", reported_models: null },
) {
  // 구독 OAuth provider는 내장 ChatGPT 정의를 쓴다(record 모양 검사가 oauth 정의를 요구한다).
  const subscription =
    account.kind === "oauth" ? builtinProviderDefinition("openai") : null;
  if (subscription && !subscription.ok) throw new Error("no openai definition");
  const provider: ProviderRecord = {
    id: "pvd_00000000000000000000000000",
    name: "mine",
    definition: subscription?.ok
      ? subscription.value
      : {
          key: definitionKey,
          display_name: definitionKey,
          protocols: ["openai-chat-completions"],
          auth_kinds: ["none"],
          models_endpoint: null,
          oauth: null,
          revision: "test",
        },
    endpoint: subscription
      ? "https://chatgpt.example/v1"
      : "http://127.0.0.1:1",
    protocol: subscription
      ? subscription.value.protocols[0]
      : "openai-chat-completions",
    credential: {
      kind: account.kind,
      secret_ref: account.kind === "oauth" ? ({ name: "sub" } as never) : null,
      revision: 1,
      state: "available",
      unavailable_reason: null,
      until: null,
      expires_at: null,
      logged_in_at: null,
      refreshed_at: null,
      model_blocks: [],
      reported_models: account.reported_models,
      account: null,
    },
    revision: 1,
  };
  return createModelResolver({
    machine: (path) =>
      Promise.resolve(
        path === routePath(providerRead)
          ? ok({ provider, as_of_seq: "0", next_cursor: null })
          : path === routePath(userModelInfoRead)
            ? ok({ seq: "0", items: [], as_of_seq: "0", next_cursor: null })
            : err({ code: "not_found", message: path }),
      ),
    attach: {} as never,
    catalog: () => Promise.resolve(ok(bundledSnapshot.entries)),
  });
}

const choice = (model_name: string) => ({
  provider: "pvd_00000000000000000000000000",
  model_name,
  option_values: {},
});

// 직접 적은 이름은 provider가 알려 준 목록이 찾기용일 때 받고 기본 한계로 돈다. 구독 계정의 허락 목록만
// 그 밖의 이름을 거절한다. 이 규칙이 틀리면 사람이 적은 model이 막히거나 계정이 못 쓰는 model로 turn이 간다.
test("직접 적은 이름은 받고, 구독 OAuth 계정의 허락 목록 밖 이름만 거절한다", async () => {
  const cases: {
    definition: string;
    account: Account;
    name: string;
    accepted: boolean;
    // 직접 적은 이름은 어느 목록에도 없으면 미확인으로 기록한다.
    listed?: "provider_list" | "unknown";
  }[] = [
    // catalog만 있는 provider의 catalog 밖 이름
    {
      definition: "anthropic",
      account: { kind: "none", reported_models: null },
      name: "claude-typed",
      accepted: true,
      listed: "unknown",
    },
    // custom provider가 알려 준 목록 밖 이름
    {
      definition: "my-local",
      account: { kind: "none", reported_models: ["other:7b"] },
      name: "whatever:7b",
      accepted: true,
    },
    // 구독 OAuth 허락 목록 밖 이름은 거절, 안은 받는다
    {
      definition: "my-sub",
      account: { kind: "oauth", reported_models: ["allowed"] },
      name: "denied",
      accepted: false,
    },
    {
      definition: "my-sub",
      account: { kind: "oauth", reported_models: ["allowed"] },
      name: "allowed",
      accepted: true,
      listed: "provider_list",
    },
  ];
  for (const row of cases) {
    const bound = await resolverFor(
      row.definition,
      row.account,
    )({
      model: choice(row.name),
    });
    assert.deepStrictEqual(bound.ok, row.accepted, JSON.stringify(bound));
    if (bound.ok) {
      assert.deepStrictEqual(bound.value.call.limits.context_limit, 131072);
      if (row.listed !== undefined) {
        assert.deepStrictEqual(
          (bound.value.call.catalog_basis as Record<string, string>)
            .model_listed,
          row.listed,
        );
      }
    } else {
      assert.deepStrictEqual(bound.error.code, "not_found");
    }
  }
});

// OpenCode Go 정의로 고른 model의 실제 요청은 gateway 규칙을 따른다: 자기 wire의 경로, `x-opencode-session`,
// 자기 User-Agent, stream=true. session header가 빠지면 gateway가 거절하므로 이 값이 요청마다 있어야 한다.
test("OpenCode Go 정의는 gateway 경로·session·User-Agent를 실은 요청을 만든다", async () => {
  const cases = [
    ["opencode-go-chat", "/chat/completions", "glm-5.3"],
    ["opencode-go-responses", "/responses", "gpt-6-luna"],
    ["opencode-go-messages", "/messages", "claude-haiku-5-5"],
  ] as const;
  for (const [key, path, model] of cases) {
    const definition = builtinProviderDefinition(key);
    assert.ok(definition.ok, key);
    const provider: ProviderRecord = {
      id: "pvd_00000000000000000000000000",
      name: "go",
      definition: definition.value,
      endpoint:
        definition.value.protocols[0] === "anthropic-messages"
          ? "https://opencode.ai/inference/go/anthropic/v1"
          : "https://opencode.ai/inference/go/openai/v1",
      protocol: definition.value.protocols[0]!,
      credential: {
        kind: "api_key",
        secret_ref: { name: "provider.x" },
        revision: 1,
        state: "available",
        unavailable_reason: null,
        until: null,
        expires_at: null,
        logged_in_at: null,
        refreshed_at: null,
        model_blocks: [],
        reported_models: null,
        account: null,
      },
      revision: 1,
    };
    const sent: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }[] = [];
    const resolve = createModelResolver({
      machine: (route) =>
        Promise.resolve(
          route === routePath(providerRead)
            ? ok({ provider, as_of_seq: "0", next_cursor: null })
            : route === routePath(userModelInfoRead)
              ? ok({ seq: "0", items: [], as_of_seq: "0", next_cursor: null })
              : err({ code: "not_found", message: route }),
        ),
      attach: {
        send: (_input, transmit) => transmit("sk-test"),
      },
      catalog: () => Promise.resolve(ok(bundledSnapshot.entries)),
      // 전송은 transport가 부르는 fetch 하나다. SSE 본문은 이 검사에 필요 없다.
      fetch: (url, init) => {
        sent.push({
          url: String(url),
          headers: { ...((init?.headers ?? {}) as Record<string, string>) },
          body: JSON.parse(String(init?.body)),
        });
        return Promise.resolve(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
    });
    const bound = await resolve({
      model: {
        provider: provider.id,
        model_name: model,
        option_values: {},
      },
    });
    assert.ok(bound.ok, JSON.stringify(bound));
    const signal = new AbortController().signal;
    const packed = bound.value.pack({
      system: [],
      messages: [],
      tools: [],
    } as never);
    await bound.value.invoke(
      {
        callId: "mcl_1",
        turn: "trn_1",
        session: "ses_1",
        purpose: "judgment",
        model: bound.value.call,
        endpoint: bound.value.endpoint,
        inputHash: "h",
        contextBasisHash: "h",
        body: packed.body as Record<string, unknown>,
        usageRevision: bound.value.usageRevision,
      },
      signal,
    );
    const call = sent.at(-1);
    assert.ok(call !== undefined, key);
    assert.equal(call.url, `${provider.endpoint}${path}`, key);
    assert.equal(call.headers["user-agent"], "lophn", key);
    assert.match(
      call.headers["x-opencode-session"]!,
      /^ses_[0-9a-f]{32}$/,
      key,
    );
    // OpenCode Go gateway는 wire와 상관없이 Bearer 하나를 문서에 둔다.
    assert.equal(call.headers.authorization, "Bearer sk-test", key);
    assert.equal((call.body as { stream?: boolean }).stream, true, key);
  }
});
