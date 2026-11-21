import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok, seededRandom } from "../../../base/mod.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import { withProviderLogin } from "./login.ts";

const NOW = Date.parse("2026-10-17T00:00:00.000Z");
const PROVIDER = "pvd_01h455vb4pex5v6nkc6gd5fd12";
const ISSUER = "http://127.0.0.1:1";
const person = (principal: string) => ({
  principal,
  actor: "user" as const,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: principal,
});
const DEVICE = person("device:dev_01h455vb4pex5v6nkc6gd5fd12");
const LOCAL = person("user:local");

function jwt(account: string): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  const claims = {
    "https://api.openai.com/auth": { chatgpt_account_id: account },
  };
  return `${part({ alg: "none" })}.${part(claims)}.x`;
}

// 다른 기기가 시작한 loopback 로그인은 이 기계가 port를 쥐지 않고, 기기가 건넨 callback으로 이 기계에서 교환·저장한다.
// 틀리면 headless 기계의 로그인이 영영 끝나지 않거나, 다른 시도의 callback이 token으로 바뀐다.
test("기기가 시작한 ChatGPT 로그인은 port 없이 주소를 내주고, 건넨 callback을 state로 대조해 이 기계에 token을 저장한다", async () => {
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
  const secrets = new Map<string, string>();
  const connects: unknown[] = [];
  const exchanged: URLSearchParams[] = [];
  let listened = 0;
  let grant = true;
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
      http(_url, init) {
        exchanged.push(new URLSearchParams(String(init.body)));
        return Promise.resolve(
          Response.json({
            access_token: jwt("acct-1"),
            refresh_token: "REFRESH-VALUE",
            expires_in: 3600,
          }),
        );
      },
      openListener() {
        listened++;
        return Promise.resolve(err({ code: "conflict", message: "port busy" }));
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
      wait: () => new Promise((resolve) => setTimeout(resolve, 0)),
      target: () =>
        ok({
          name: definition.display_name,
          definition,
          endpoint: "https://chatgpt.com/backend-api/codex",
          protocol: "openai-responses" as const,
        }),
      freshId: () => Promise.resolve(ok(PROVIDER)),
      requests: {
        readRequest: () => err({ code: "not_found", message: "없다" }),
        finishRequest: () => ok(undefined),
      },
      changed: () => {},
      granted: () => grant,
    },
  );
  const stateOf = (id: string) =>
    (login.signInState({ login: id }) as { value: { state: string } }).value
      .state;
  const settled = async (id: string) => {
    while (stateOf(id) === "waiting") {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return stateOf(id);
  };

  const begun = await login.signIn(DEVICE, { definition: "openai" });
  assert.ok(begun.ok, JSON.stringify(begun));
  const started = begun.value as {
    login: string;
    callback_mode: string;
    redirect_uri: string;
    sign_in: { url: string };
  };
  const authorize = new URL(started.sign_in.url);
  const state = authorize.searchParams.get("state")!;
  assert.deepStrictEqual(
    [
      started.callback_mode,
      started.redirect_uri,
      authorize.searchParams.get("redirect_uri"),
      listened,
    ],
    [
      "remote_handoff",
      "http://localhost:1455/auth/callback",
      "http://localhost:1455/auth/callback",
      0,
    ],
  );

  // 이 시도의 것이 아닌 callback은 거절하고 기다림을 잇는다. token은 아직 교환하지 않는다.
  const body = { provider: PROVIDER, login: started.login };
  const wrong = login.signInCallback({
    ...body,
    callback_url: "http://localhost:1455/auth/callback?code=c&state=OTHER",
  });
  assert.equal(!wrong.ok && wrong.error.code, "invalid_input");
  assert.deepStrictEqual(
    [stateOf(started.login), exchanged.length],
    ["waiting", 0],
  );

  const right = login.signInCallback({
    ...body,
    callback_url: `http://localhost:1455/auth/callback?code=CODE-1&state=${state}`,
  });
  assert.ok(right.ok, JSON.stringify(right));
  assert.equal(await settled(started.login), "connected");
  assert.deepStrictEqual(
    [
      exchanged[0]!.get("code"),
      exchanged[0]!.get("redirect_uri"),
      connects.length,
      [...secrets.keys()].sort(),
    ],
    [
      "CODE-1",
      "http://localhost:1455/auth/callback",
      1,
      [
        "provider.crd_01h455vb4pex5v6nkc6gd5fd12",
        "provider.crd_01h455vb4pex5v6nkc6gd5fd12.meta",
        "provider.crd_01h455vb4pex5v6nkc6gd5fd12.refresh",
      ],
    ],
  );
  // 끝난 로그인에는 다시 건네지 못한다.
  const again = login.signInCallback({
    ...body,
    callback_url: `code=c&state=${state}`,
  });
  assert.equal(!again.ok && again.error.code, "not_found");

  // 쿼리만 붙여 넣어도 받는다. 기다리는 사이 허락이 꺼지면 연결하지 않는다.
  const second = await login.signIn(DEVICE, { definition: "openai" });
  assert.ok(second.ok);
  const secondLogin = second.value as {
    login: string;
    sign_in: { url: string };
  };
  grant = false;
  const pasted = login.signInCallback({
    provider: PROVIDER,
    login: secondLogin.login,
    callback_url: `code=CODE-2&state=${new URL(secondLogin.sign_in.url).searchParams.get("state")}`,
  });
  assert.ok(pasted.ok);
  secrets.clear();
  connects.length = 0;
  assert.equal(await settled(secondLogin.login), "failed");
  assert.deepStrictEqual([connects.length, [...secrets.keys()]], [0, []]);

  // 이 기계의 사람이 시작한 로그인은 그대로 listener를 쓴다.
  const local = await login.signIn(LOCAL, { definition: "openai" });
  assert.equal(!local.ok && local.error.code, "conflict");
  assert.equal(listened, 1);
});
