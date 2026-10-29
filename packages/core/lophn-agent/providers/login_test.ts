import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok, seededRandom } from "../../../base/mod.ts";
import type { ProviderDefinition } from "../../../protocol/lophn-agent/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import { withProviderLogin } from "./login.ts";

const NOW = Date.parse("2026-10-17T00:00:00.000Z");
const PROVIDER = "pvd_01h455vb4pex5v6nkc6gd5fd12";
const ISSUER = "http://127.0.0.1:1";
const CLIENT = "oaiapp_issued";
const USER = {
  principal: "user:local",
  actor: "user" as const,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user:local",
};

// 내장 ChatGPT 정의의 발급자 주소만 loopback fake로 바꾼다.
function chatgpt(): ProviderDefinition {
  const builtin = builtinProviderDefinition("openai");
  if (!builtin.ok || builtin.value.oauth?.product !== "chatgpt") {
    throw new Error("내장 openai 정의에 ChatGPT 로그인이 없다");
  }
  return {
    ...builtin.value,
    oauth: {
      ...builtin.value.oauth,
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    },
  };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);

async function idToken(claims: Record<string, unknown>): Promise<string> {
  const part = (value: unknown) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${part({ alg: "RS256", kid: "k1" })}.${part(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

type Case = {
  name: string;
  state?: (state: string) => string;
  nonce?: (nonce: string) => string;
  audience?: string;
  scope?: string;
  connect?: "unavailable";
  expected: string;
};

// 한 시도: begin → 사람이 browser에서 돌아온 callback → complete. 발급자, listener, writer, secret 저장소는 가짜다.
async function attempt(c: Case) {
  const secrets = new Map<string, string>();
  const commands: { command: string; input: unknown }[] = [];
  const writer: Writer = {
    command(_ctx, envelope) {
      commands.push({ command: envelope.command, input: envelope.input });
      if (c.connect !== undefined) {
        return Promise.resolve(err({ code: c.connect, message: "가짜 실패" }));
      }
      const input = envelope.input as Record<string, unknown>;
      return Promise.resolve(
        ok({
          result: {
            provider: {
              id: input.id,
              name: input.name,
              definition: input.definition,
              endpoint: input.endpoint,
              protocol: input.protocol,
              credential: {
                kind: "oauth",
                secret_ref: {
                  name: (input.credential as { secret: string }).secret,
                },
                revision: 1,
                state: "available",
                unavailable_reason: null,
                until: null,
                expires_at: input.expires_at,
                logged_in_at: new Date(NOW).toISOString(),
                refreshed_at: null,
                model_blocks: [],
                reported_models: null,
                account: null,
              },
              revision: 1,
            },
          },
          replayed: false,
          first_seq: null,
          last_seq: null,
        }),
      );
    },
    readResult: () => Promise.resolve(ok(null)),
    close: () => Promise.resolve(),
  };
  let deliver: (callback: { code: string; state: string }) => void = () => {};
  const received = new Promise<{ code: string; state: string }>((resolve) => {
    deliver = resolve;
  });
  // begin이 만든 authorize 주소다. 가짜 발급자가 그 nonce로 id_token을 만든다.
  const seen: { authorize?: URL } = {};
  const login = withProviderLogin(writer, {
    async http(url) {
      if (url === `${ISSUER}/jwks`) {
        return Response.json({ keys: [{ ...jwk, kid: "k1" }] });
      }
      return Response.json({
        access_token: "ACCESS-VALUE",
        refresh_token: "REFRESH-VALUE",
        expires_in: 3600,
        scope:
          c.scope ??
          "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        id_token: await idToken({
          iss: ISSUER,
          aud: c.audience ?? CLIENT,
          exp: NOW / 1000 + 3600,
          nonce: (c.nonce ?? ((value) => value))(
            seen.authorize!.searchParams.get("nonce")!,
          ),
          sub: "user-1",
        }),
      });
    },
    openListener: () =>
      Promise.resolve(
        ok({
          port: () => 1,
          receive: () =>
            received.then((callback) =>
              ok({ ...callback, iss: null, client_id: CLIENT }),
            ),
          close: () => Promise.resolve(),
        }),
      ),
    secrets: {
      get: (name) =>
        secrets.has(name)
          ? ok(secrets.get(name)!)
          : err({ code: "not_found", message: "없다" }),
      put: (name, value) => {
        secrets.set(name, String(value));
        return Promise.resolve(ok({ names: [] }) as never);
      },
      delete: (name) => {
        secrets.delete(name);
        return Promise.resolve(ok({ names: [] }) as never);
      },
    },
    newKey: () => "key",
    nowMs: () => NOW,
    random: seededRandom(7),
  });
  const run = (command: string, input: unknown) =>
    login.command(USER, {
      command,
      input,
      idempotency_key: "key",
      compare: {},
      prepared: [],
    });
  const begun = await run("BeginProviderLogin", {
    provider: PROVIDER,
    name: "OpenAI",
    definition: chatgpt(),
    endpoint: "https://api.openai.com/v1",
    protocol: "openai-responses",
  });
  if (!begun.ok) throw new Error(begun.error.message);
  const started = begun.value.result as {
    login: string;
    sign_in: { url: string };
  };
  const authorize = new URL(started.sign_in.url);
  seen.authorize = authorize;
  deliver({
    code: "CODE",
    state: (c.state ?? ((value) => value))(
      authorize.searchParams.get("state")!,
    ),
  });
  // listener의 callback이 세션에 닿을 때까지 한 차례 넘긴다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const done = await run("CompleteProviderLogin", {
    provider: PROVIDER,
    login: started.login,
  });
  return {
    code: done.ok
      ? (done.value.result as { state: string }).state
      : done.error.code,
    tokens: [...secrets.keys()].filter((name) => name.startsWith("provider.")),
    connects: commands.filter((entry) => entry.command === "ConnectProvider"),
  };
}

test("ChatGPT 로그인은 검증이 틀리거나 연결이 실패하면 secret과 provider를 남기지 않는다", async () => {
  const good = await attempt({ name: "맞는 callback", expected: "connected" });
  assert.deepStrictEqual(good.code, "connected");
  assert.deepStrictEqual(good.tokens.sort(), [
    "provider.01h455vb4pex5v6nkc6gd5fd12",
    "provider.01h455vb4pex5v6nkc6gd5fd12.meta",
    "provider.01h455vb4pex5v6nkc6gd5fd12.refresh",
  ]);
  const input = good.connects[0]?.input as Record<string, unknown>;
  assert.deepStrictEqual(
    [input.auth_kind, input.credential, input.expires_at],
    [
      "oauth",
      { secret: "provider.01h455vb4pex5v6nkc6gd5fd12" },
      new Date(NOW + 3_600_000).toISOString(),
    ],
  );

  const refused: Case[] = [
    {
      name: "다른 시도의 state",
      state: (value) => `${value}x`,
      expected: "forbidden",
    },
    {
      name: "id_token의 nonce가 다르다",
      nonce: (value) => `${value}x`,
      expected: "forbidden",
    },
    {
      name: "id_token의 audience가 다른 client다",
      audience: "oaiapp_other",
      expected: "forbidden",
    },
    {
      name: "plan usage scope가 없다",
      scope: "openid profile email offline_access",
      expected: "forbidden",
    },
    {
      name: "Connect가 실패한다",
      connect: "unavailable",
      expected: "unavailable",
    },
  ];
  for (const c of refused) {
    const got = await attempt(c);
    assert.deepStrictEqual(
      [c.name, got.code, got.tokens, got.connects.length],
      [c.name, c.expected, [], c.connect === undefined ? 0 : 1],
    );
  }
});

// 고정 callback으로 돌아오는 구독 로그인 한 시도다. 발급자 답은 주소마다 정한다. Connect는 받은 값을 그대로 돌려준다.
async function fixedLogin(input: {
  definition: ProviderDefinition;
  endpoint: string;
  protocol: string;
  answer(url: string, init: RequestInit): Response;
}) {
  const secrets = new Map<string, string>();
  const connects: Record<string, unknown>[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const listening: unknown[] = [];
  let deliver: (callback: { code: string; state: string }) => void = () => {};
  const received = new Promise<{ code: string; state: string }>((resolve) => {
    deliver = resolve;
  });
  const login = withProviderLogin(
    {
      command(_ctx, envelope) {
        const sent = envelope.input as Record<string, unknown>;
        connects.push(sent);
        return Promise.resolve(
          ok({
            result: {
              provider: {
                id: sent.id,
                name: sent.name,
                definition: sent.definition,
                endpoint: sent.endpoint,
                protocol: sent.protocol,
                credential: {
                  kind: "oauth",
                  secret_ref: { name: "provider.01h455vb4pex5v6nkc6gd5fd12" },
                  revision: 1,
                  state: "available",
                  unavailable_reason: null,
                  until: null,
                  expires_at: sent.expires_at,
                  logged_in_at: new Date(NOW).toISOString(),
                  refreshed_at: null,
                  model_blocks: [],
                  reported_models: null,
                  account: sent.account,
                },
                revision: 1,
              },
            },
            replayed: false,
            first_seq: null,
            last_seq: null,
          }),
        );
      },
      readResult: () => Promise.resolve(ok(null)),
      close: () => Promise.resolve(),
    },
    {
      http(url, init) {
        requests.push({ url, init });
        return Promise.resolve(input.answer(url, init));
      },
      openListener(options) {
        listening.push(options);
        return Promise.resolve(
          ok({
            port: () => 1,
            receive: () =>
              received.then((callback) =>
                ok({ ...callback, iss: null, client_id: null }),
              ),
            close: () => Promise.resolve(),
          }),
        );
      },
      secrets: {
        get: (name) =>
          secrets.has(name)
            ? ok(secrets.get(name)!)
            : err({ code: "not_found", message: "없다" }),
        put: (name, value) => {
          secrets.set(name, String(value));
          return Promise.resolve(ok({ names: [] }) as never);
        },
        delete: (name) => {
          secrets.delete(name);
          return Promise.resolve(ok({ names: [] }) as never);
        },
      },
      newKey: () => "key",
      nowMs: () => NOW,
      random: seededRandom(7),
      wait: () => Promise.resolve(),
    },
  );
  const run = (command: string, body: unknown) =>
    login.command(USER, {
      command,
      input: body,
      idempotency_key: "key",
      compare: {},
      prepared: [],
    });
  const begun = await run("BeginProviderLogin", {
    provider: PROVIDER,
    name: input.definition.display_name,
    definition: input.definition,
    endpoint: input.endpoint,
    protocol: input.protocol,
  });
  assert.ok(begun.ok);
  const started = begun.value.result as {
    login: string;
    sign_in: { url: string };
  };
  const authorize = new URL(started.sign_in.url);
  const state = authorize.searchParams.get("state")!;
  deliver({ code: "CODE", state });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const done = await run("CompleteProviderLogin", {
    provider: PROVIDER,
    login: started.login,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    authorize,
    state,
    code: done.ok
      ? (done.value.result as { state: string }).state
      : done.error.code,
    secrets: [...secrets.keys()],
    connects,
    requests,
    listening,
  };
}

test("Claude 로그인은 등록된 callback에서 듣고 JSON으로 교환한 뒤 빠진 계정만 보충해 Connect에 싣는다", async () => {
  const builtin = builtinProviderDefinition("anthropic");
  assert.ok(builtin.ok && builtin.value.oauth?.product === "claude");
  const got = await fixedLogin({
    definition: {
      ...builtin.value,
      oauth: {
        ...builtin.value.oauth,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        account_endpoint: `${ISSUER}/bootstrap`,
      },
    },
    endpoint: "https://api.anthropic.com/v1",
    protocol: "anthropic-messages",
    answer: (url) =>
      url === `${ISSUER}/bootstrap`
        ? Response.json({
            oauth_account: {
              account_uuid: "other-account",
              account_email: "dev@example.test",
              organization_uuid: "org-from-bootstrap",
              organization_name: "Example workspace",
            },
          })
        : // 계정 id는 token 응답에 있고 email·조직은 없다.
          Response.json({
            access_token: "ACCESS-VALUE",
            refresh_token: "REFRESH-VALUE",
            expires_in: 28_800,
            account: { uuid: "account-1" },
          }),
  });
  const exchange = got.requests[0]!;
  const sent = JSON.parse(String(exchange.init.body));
  assert.deepStrictEqual(
    {
      listening: got.listening,
      query: {
        code: got.authorize.searchParams.get("code"),
        redirect: got.authorize.searchParams.get("redirect_uri"),
        scopes: got.authorize.searchParams.get("scope")?.split(" ").length,
        method: got.authorize.searchParams.get("code_challenge_method"),
      },
      exchange: {
        type: new Headers(exchange.init.headers).get("content-type"),
        grant: sent.grant_type,
        code: sent.code,
        state: sent.state === got.state,
        verifier: typeof sent.code_verifier,
      },
      state: got.code,
      account: got.connects[0]?.account,
    },
    {
      listening: [
        {
          hosts: ["127.0.0.1", "::1"],
          port: 54545,
          path: "/callback",
          state: got.state,
        },
      ],
      query: {
        code: "true",
        redirect: "http://localhost:54545/callback",
        scopes: 6,
        method: "S256",
      },
      exchange: {
        type: "application/json",
        grant: "authorization_code",
        code: "CODE",
        state: true,
        verifier: "string",
      },
      state: "connected",
      account: {
        id: "account-1",
        email: "dev@example.test",
        organization_id: "org-from-bootstrap",
        organization_name: "Example workspace",
        project_id: null,
      },
    },
  );
});

test("Antigravity 로그인은 tier가 없으면 onboarding을 기다린 뒤 마지막 load의 project로만 연결한다", async () => {
  const builtin = builtinProviderDefinition("google-antigravity");
  assert.ok(builtin.ok && builtin.value.oauth?.product === "antigravity");
  const CONTROL = "https://daily-cloudcode-pa.googleapis.com";
  const definition: ProviderDefinition = {
    ...builtin.value,
    oauth: {
      ...builtin.value.oauth,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
    },
  };
  // finalProject: onboarding 뒤 마지막 loadCodeAssist가 주는 project. operation 응답에만 project가 있으면 연결하지 않는다.
  const attempt = (finalProject: string | null) => {
    let loads = 0;
    let polls = 0;
    return fixedLogin({
      definition,
      endpoint: CONTROL,
      protocol: "cloud-code-assist",
      answer(url) {
        if (url === `${ISSUER}/token`) {
          return Response.json({
            access_token: "ACCESS-VALUE",
            refresh_token: "REFRESH-VALUE",
            expires_in: 3599,
            token_type: "Bearer",
          });
        }
        if (url === `${ISSUER}/userinfo`) {
          return Response.json({ email: "dev@example.test" });
        }
        if (url === `${CONTROL}/v1internal:loadCodeAssist`) {
          loads += 1;
          return Response.json(
            loads === 1
              ? { allowedTiers: [{ id: "free-tier" }], currentTier: null }
              : finalProject === null
                ? { currentTier: { id: "free-tier" } }
                : {
                    cloudaicompanionProject: finalProject,
                    currentTier: { id: "free-tier" },
                  },
          );
        }
        if (url === `${CONTROL}/v1internal:onboardUser`) {
          return Response.json({
            name: "operations/fixture-onboard",
            done: false,
          });
        }
        if (url === `${CONTROL}/v1internal/operations/fixture-onboard`) {
          polls += 1;
          return Response.json(
            polls < 2
              ? { name: "operations/fixture-onboard", done: false }
              : {
                  name: "operations/fixture-onboard",
                  done: true,
                  response: {
                    "@type": "type.googleapis.com/example.OnboardUserResponse",
                    cloudaicompanionProject: "operation-only-project",
                  },
                },
          );
        }
        return new Response("{}", { status: 404 });
      },
    });
  };

  const good = await attempt("fixture-project");
  const exchange = good.requests[0]!;
  const { code_verifier: verifier, ...form } = Object.fromEntries(
    new URLSearchParams(String(exchange.init.body)).entries(),
  );
  assert.ok(verifier !== undefined && verifier.length >= 43);
  assert.deepStrictEqual(
    {
      code: good.code,
      listening: good.listening,
      offline: [
        good.authorize.searchParams.get("access_type"),
        good.authorize.searchParams.get("prompt"),
      ],
      form,
      onboard: JSON.parse(
        String(
          good.requests.find((request) => request.url.endsWith(":onboardUser"))
            ?.init.body,
        ),
      ),
      account: good.connects[0]?.account,
    },
    {
      code: "connected",
      listening: [
        {
          hosts: ["127.0.0.1"],
          port: 51121,
          path: "/oauth-callback",
          state: good.state,
        },
      ],
      offline: ["offline", "consent"],
      form: {
        grant_type: "authorization_code",
        client_id: builtin.value.oauth.client_id,
        client_secret: builtin.value.oauth.client_secret,
        code: "CODE",
        redirect_uri: "http://127.0.0.1:51121/oauth-callback",
      },
      onboard: { tierId: "free-tier", metadata: { ideType: "ANTIGRAVITY" } },
      account: {
        id: null,
        email: "dev@example.test",
        organization_id: null,
        organization_name: null,
        project_id: "fixture-project",
      },
    },
  );

  const missing = await attempt(null);
  assert.deepStrictEqual(
    [missing.code, missing.secrets, missing.connects.length],
    ["unavailable", [], 0],
  );
});
