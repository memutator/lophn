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
const USER = {
  principal: "user:local",
  actor: "user" as const,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user:local",
};

// 계정 id를 claim에 담은 서명 없는 JWT 꼴 token이다. core는 서명을 보지 않는다.
function accessWith(account: string | null): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  const claims =
    account === null
      ? {}
      : { "https://api.openai.com/auth": { chatgpt_account_id: account } };
  return `${part({ alg: "none" })}.${part(claims)}.x`;
}

test("ChatGPT 로그인은 고정 callback으로 교환하고, 계정 claim이 없으면 secret과 provider를 남기지 않는다", async () => {
  const builtin = builtinProviderDefinition("openai");
  assert.ok(builtin.ok && builtin.value.oauth?.product === "chatgpt");
  const definition = {
    ...builtin.value,
    oauth: {
      ...builtin.value.oauth,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
    },
  };
  const tokens = (account: string | null) => () =>
    Response.json({
      access_token: accessWith(account),
      refresh_token: "REFRESH-VALUE",
      expires_in: 3600,
    });
  const good = await fixedLogin({
    definition,
    endpoint: "https://chatgpt.com/backend-api/codex",
    protocol: "openai-responses",
    answer: tokens("acct-1"),
  });
  const sent = new URLSearchParams(String(good.requests[0]!.init.body));
  assert.deepStrictEqual(
    {
      listening: good.listening,
      redirect: good.authorize.searchParams.get("redirect_uri"),
      client: good.authorize.searchParams.get("client_id"),
      grant: sent.get("grant_type"),
      verifier: typeof sent.get("code_verifier"),
      state: good.code,
      account: (good.connects[0]?.account as { id: string } | undefined)?.id,
      secrets: good.secrets.sort(),
    },
    {
      listening: [
        {
          hosts: ["127.0.0.1", "::1"],
          port: 1455,
          path: "/auth/callback",
          state: good.state,
        },
      ],
      redirect: "http://localhost:1455/auth/callback",
      client: "app_EMoamEEZ73f0CkXaXp7hrann",
      grant: "authorization_code",
      verifier: "string",
      state: "connected",
      account: "acct-1",
      secrets: [
        "provider.crd_01h455vb4pex5v6nkc6gd5fd12",
        "provider.crd_01h455vb4pex5v6nkc6gd5fd12.meta",
        "provider.crd_01h455vb4pex5v6nkc6gd5fd12.refresh",
      ],
    },
  );

  // Codex backend는 요청마다 계정 id를 받는다. 없으면 쓸 수 없는 token이다.
  const anonymous = await fixedLogin({
    definition,
    endpoint: "https://chatgpt.com/backend-api/codex",
    protocol: "openai-responses",
    answer: tokens(null),
  });
  assert.deepStrictEqual(
    [anonymous.code, anonymous.secrets, anonymous.connects.length],
    ["forbidden", [], 0],
  );
});

// 고정 callback으로 돌아오는 구독 로그인 한 시도다. 발급자 답은 주소마다 정한다. Connect는 받은 값을 그대로 돌려준다.
async function fixedLogin(input: {
  definition: ProviderDefinition;
  endpoint: string;
  protocol: string;
  answer(url: string, init: RequestInit): Response;
  // 이미 이어진 provider의 값. 있으면 Connect가 conflict로 끝난다.
  existing?: Record<string, string>;
}) {
  const secrets = new Map<string, string>(Object.entries(input.existing ?? {}));
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
        if (input.existing !== undefined) {
          return Promise.resolve(
            err({ code: "conflict", message: "provider id already exists" }),
          );
        }
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
                  secret_ref: {
                    name: "provider.crd_01h455vb4pex5v6nkc6gd5fd12",
                  },
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
      // 다음 확인까지 쉬는 동안 callback이 도착한다.
      wait: () => new Promise((resolve) => setTimeout(resolve, 0)),
      target: () =>
        ok({
          name: input.definition.display_name,
          definition: input.definition,
          endpoint: input.endpoint,
          protocol: input.protocol as "openai-responses",
        }),
      freshId: () => Promise.resolve(ok(PROVIDER)),
      requests: {
        readRequest: () => err({ code: "not_found", message: "없다" }),
        finishRequest: () => ok(undefined),
      },
      changed: () => {},
      granted: () => true,
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
  const begun = await login.signIn(USER, { definition: "test" });
  assert.ok(begun.ok);
  const started = begun.value as { login: string; sign_in: { url: string } };
  const authorize = new URL(started.sign_in.url);
  const state = authorize.searchParams.get("state")!;
  deliver({ code: "CODE", state });
  // core가 기다림을 끝낼 때까지 상태를 본다.
  let done = login.signInState({ login: started.login });
  while (done.ok && (done.value as { state: string }).state === "waiting") {
    await new Promise((resolve) => setTimeout(resolve, 0));
    done = login.signInState({ login: started.login });
  }
  assert.ok(done.ok);
  const settled = done.value as { state: string; code?: string };
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    run,
    store: secrets,
    authorize,
    state,
    code: settled.code ?? settled.state,
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

test("이미 이어진 id로 잇기가 conflict로 끝나면 그 provider의 key·token은 그대로이고 새 값은 남지 않는다", async () => {
  const builtin = builtinProviderDefinition("openai");
  assert.ok(builtin.ok && builtin.value.oauth?.product === "chatgpt");
  const secret = "provider.crd_01h455vb4pex5v6nkc6gd5fd12";
  const existing = {
    [secret]: "OLD-ACCESS",
    [`${secret}.refresh`]: "OLD-REFRESH",
    [`${secret}.meta`]: '{"subject":"old"}',
  };
  // 구독 로그인: 다른 계정의 token을 받았지만 연결이 conflict다.
  const signed = await fixedLogin({
    definition: {
      ...builtin.value,
      oauth: {
        ...builtin.value.oauth,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
      },
    },
    endpoint: "https://chatgpt.com/backend-api/codex",
    protocol: "openai-responses",
    answer: () =>
      Response.json({
        access_token: accessWith("acct-new"),
        refresh_token: "NEW-REFRESH",
        expires_in: 3600,
      }),
    existing,
  });
  assert.deepStrictEqual(
    [signed.code, Object.fromEntries(signed.store)],
    ["conflict", existing],
  );

  // API key: 임시 이름에 올라온 새 key는 버려지고 연결된 provider의 key 자리는 그대로다.
  signed.store.set(`${secret}.new.abc`, "NEW-KEY");
  const keyed = await signed.run("ConnectProvider", {
    id: PROVIDER,
    name: "OpenAI",
    definition: builtin.value,
    endpoint: "https://api.openai.com/v1",
    protocol: "openai-responses",
    auth_kind: "api_key",
    credential: { secret: `${secret}.new.abc` },
  });
  assert.deepStrictEqual(
    [keyed.ok ? "ok" : keyed.error.code, Object.fromEntries(signed.store)],
    ["conflict", existing],
  );

  // agent의 요청으로 시작한 로그인이 시작부터 conflict면 기다리던 요청도 그 오류로 끝난다(agent가 모른 채 기다리지 않는다).
  const finished: unknown[] = [];
  const asked = withProviderLogin(
    {
      command: () => Promise.reject(new Error("unused")),
      readResult: () => Promise.resolve(ok(null)),
      close: () => Promise.resolve(),
    },
    {
      http: () => Promise.reject(new Error("unused")),
      openListener: () =>
        Promise.resolve(err({ code: "unavailable", message: "unused" })),
      secrets: {
        get: () => err({ code: "not_found", message: "없다" }),
        put: () => Promise.resolve(ok({ names: [] }) as never),
        delete: () => Promise.resolve(ok({ names: [] }) as never),
      },
      newKey: () => "key",
      nowMs: () => NOW,
      random: seededRandom(7),
      target: () => err({ code: "not_found", message: "unused" }),
      freshId: () =>
        Promise.resolve(err({ code: "conflict", message: "connected" })),
      requests: {
        readRequest: () =>
          ok({
            kind: "sign_in",
            target: {
              type: "provider",
              login: {
                provider: PROVIDER,
                name: "OpenAI",
                definition: builtin.value,
                endpoint: "https://chatgpt.com/backend-api/codex",
                protocol: "openai-responses",
              },
            },
          } as never),
        finishRequest: (_session, _toolCall, result) => {
          finished.push(result.ok ? "ok" : result.error.code);
          return ok(undefined);
        },
      },
      changed: () => {},
      granted: () => true,
    },
  );
  const refused = await asked.signIn(USER, {
    request: {
      session: "ses_01h455vb4pex5v6nkc6gd5fd10",
      tool_call: "tcl_01h455vb4pex5v6nkc6gd5fd10",
    },
  });
  assert.deepStrictEqual(
    [refused.ok ? "ok" : refused.error.code, finished],
    ["conflict", ["conflict"]],
  );
});

// 기기의 call은 허락을 call마다 보지만 로그인은 시작한 자격으로 뒤에서 잇는다. 기다리는 사이 사람이 허락을 끄면 그 뒤에 잇지 않는다.
test("기기가 시작한 device code 로그인은 기다리는 사이 허락이 꺼지면 provider를 잇지 않고 secret을 남기지 않는다", async () => {
  const builtin = builtinProviderDefinition("xai");
  assert.ok(builtin.ok && builtin.value.oauth?.product === "supergrok");
  const definition = {
    ...builtin.value,
    oauth: {
      ...builtin.value.oauth,
      device_authorization_endpoint: `${ISSUER}/device`,
      token_endpoint: `${ISSUER}/token`,
    },
  };
  const DEVICE = {
    ...USER,
    principal: "device:dev_01h455vb4pex5v6nkc6gd5fd12",
  };
  async function run(who: typeof USER) {
    let now = NOW;
    let grant = true;
    const secrets = new Map<string, string>();
    const connects: unknown[] = [];
    const login = withProviderLogin(
      {
        command(_ctx, envelope) {
          connects.push(envelope.input);
          return Promise.resolve(
            ok({ result: { provider: { revision: 1 } } }) as never,
          );
        },
        readResult: () => Promise.resolve(ok(null)),
        close: () => Promise.resolve(),
      },
      {
        http(url) {
          if (url.endsWith("/device")) {
            return Promise.resolve(
              Response.json({
                device_code: "DEVICE-CODE",
                user_code: "ABCD-EFGH",
                verification_uri: "https://x.example/device",
                interval: 1,
                expires_in: 600,
              }),
            );
          }
          // 사람이 브라우저에서 끝내기 직전에 허락을 끈다.
          grant = false;
          return Promise.resolve(
            Response.json({
              access_token: "ACCESS-VALUE",
              refresh_token: "REFRESH-VALUE",
              expires_in: 3600,
            }),
          );
        },
        openListener: () =>
          Promise.resolve(err({ code: "unavailable", message: "unused" })),
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
        nowMs: () => now,
        random: seededRandom(7),
        wait: (ms) => {
          now += ms;
          return new Promise((resolve) => setTimeout(resolve, 0));
        },
        target: () =>
          ok({
            name: definition.display_name,
            definition,
            endpoint: "https://api.x.ai/v1",
            protocol: "openai-chat-completions",
          }),
        freshId: () => Promise.resolve(ok(PROVIDER)),
        requests: {
          readRequest: () => err({ code: "not_found", message: "없다" }),
          finishRequest: () => ok(undefined),
        },
        changed: () => {},
        granted: (principal) => principal === DEVICE.principal && grant,
      },
    );
    const begun = await login.signIn(who, { definition: "xai" });
    assert.ok(begun.ok, JSON.stringify(begun));
    const started = begun.value as { login: string };
    let done = login.signInState({ login: started.login });
    while (done.ok && (done.value as { state: string }).state === "waiting") {
      await new Promise((resolve) => setTimeout(resolve, 0));
      done = login.signInState({ login: started.login });
    }
    assert.ok(done.ok);
    const settled = done.value as { state: string; code?: string };
    return [
      settled.code ?? settled.state,
      connects.length,
      [...secrets.keys()],
    ];
  }
  assert.deepStrictEqual(await run(DEVICE), ["forbidden", 0, []]);
  // 이 기계의 사람이 시작한 로그인은 허락과 상관없이 잇는다.
  const local = await run(USER);
  assert.deepStrictEqual(local.slice(0, 2), ["connected", 1]);
});
