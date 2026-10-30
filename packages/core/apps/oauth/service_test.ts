import assert from "node:assert/strict";
import { test } from "node:test";
import { err, manualClock, ok } from "../../../base/mod.ts";
import {
  APP_OAUTH_SIGN_IN_REQUIRED,
  appsOAuthState,
} from "../../../protocol/apps/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  createFakeIssuerHandler,
  type IssuerReply,
} from "../../../../tests/support/fake-oauth/mod.ts";
import { secretValueHandler } from "../permissions/secret-value.ts";
import { createAppOAuth } from "./service.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz";
const RELEASE = "rel_01hzzzzzzzzzzzzzzzzzzzzzzz";
const NAME = "gh_token";
const ACCESS = "access-token-OLD-1";
const AUTHORIZE = "https://issuer.example/authorize";
const TOKEN = "https://issuer.example/token";
const SCOPES = ["repo"];
const NOW = 1_000_000;

// refresh 거절은 token을 지우고 sign-in으로 돌려보낸다. 닿지 못함·5xx는 만료 전 token을 지키고, 만료 뒤에는 unavailable이다.
// 이 규칙이 틀리면 사람이 sign-in을 잃거나 죽은 token이 앱에 간다.
async function run(reply: IssuerReply | "throws", expiresInMs: number) {
  const issuer = createFakeIssuerHandler();
  if (reply !== "throws") issuer.script({ refresh_token: [reply] });
  const store = new Map<string, string>([
    [NAME, ACCESS],
    [`app-oauth.${NAME}.refresh`, "refresh-token-1"],
    [`app-oauth.${NAME}.client_id`, "client-1"],
    [
      `app-oauth.${NAME}.meta`,
      JSON.stringify({
        expires_at_ms: NOW + expiresInMs,
        token_endpoint: TOKEN,
        binding: {
          authorization_endpoint: AUTHORIZE,
          token_endpoint: TOKEN,
          scopes: JSON.stringify(SCOPES),
          params: "{}",
          client_id: "client-1",
        },
      }),
    ],
  ]);
  const clock = manualClock(NOW);
  const app = createAppOAuth({
    secrets: {
      get: (name) =>
        store.has(name)
          ? ok(store.get(name)!)
          : err({ code: "not_found", message: "none" }),
      put: (name, value) => {
        store.set(name, String(value));
        return Promise.resolve(ok({}) as never);
      },
      delete: (name) => {
        store.delete(name);
        return Promise.resolve(ok({}) as never);
      },
    },
    fetch:
      reply === "throws"
        ? () => Promise.reject(new Error("unreachable"))
        : (url, init) => issuer.handle(new Request(url, init)),
    openListener: () =>
      Promise.resolve(err({ code: "unavailable", message: "x" })),
    declared: () =>
      Promise.resolve(
        ok([
          {
            name: NAME,
            oauth: {
              authorization_endpoint: AUTHORIZE,
              token_endpoint: TOKEN,
              scopes: SCOPES,
            },
            granted: true,
          },
        ]),
      ),
    nowMs: clock.nowMs,
  });
  const handler = secretValueHandler({
    attach: {
      send: async (input, transmit) => {
        const value = store.get(input.use.name);
        return value === undefined
          ? err({ code: "not_found", message: "none" })
          : await transmit(value);
      },
    },
    known: () => ({
      ready: true,
      match: (text) => ({ index: 0, length: text.length }),
      prefixFrom: () => undefined,
    }),
    observe: () =>
      Promise.resolve(
        ok({ release: RELEASE, mode: "live", process_nonce: "n1" }),
      ),
    prepare: app.prepare,
  });
  const caller = {
    principal: "machine:apps-supervisor",
    actor: "machine",
    scope: {
      operations: ["apps.secret_value"],
      targets: { task: "apps", process: "apps/supervisor" },
    },
    conditions: { task: "apps", process: "apps/supervisor" },
    credential_ref: "machine:apps-supervisor",
  } as AuthenticatedContext;
  const result = await handler(caller, {
    app: APP,
    release: RELEASE,
    process_nonce: "n1",
    name: NAME,
    destination: { scheme: "https", host: "api.github.com", port: 443 },
  });
  const state = await app.handlers.get("apps/oauth_state")!(caller, {
    app: APP,
  });
  return { result, store, state, app, caller };
}

test("signing out removes the tokens and keeps the client", async () => {
  const { app, caller, store } = await run("throws", 60_000);
  store.set(`app-oauth.${NAME}.client`, "client-secret-1");

  const signedOut = await app.handlers.get("apps/oauth_sign_out")!(caller, {
    app: APP,
    name: NAME,
  });
  assert.ok(signedOut.ok);
  assert.deepStrictEqual(store.has(NAME), false);
  assert.deepStrictEqual(store.has(`app-oauth.${NAME}.refresh`), false);
  assert.deepStrictEqual(store.has(`app-oauth.${NAME}.meta`), false);
  assert.deepStrictEqual(store.get(`app-oauth.${NAME}.client_id`), "client-1");
  assert.deepStrictEqual(
    store.get(`app-oauth.${NAME}.client`),
    "client-secret-1",
  );

  const state = await app.handlers.get("apps/oauth_state")!(caller, {
    app: APP,
  });
  assert.ok(state.ok);
  const lines = appsOAuthState.output.parse(state.value);
  assert.deepStrictEqual(lines.secrets[0]?.state, "none");
});

test("a rejected refresh signs the user out, an unreachable issuer does not", async () => {
  const rejected: Array<IssuerReply | "throws"> = [
    { kind: "error", status: 400, error: "invalid_request" },
    { kind: "error", status: 401, error: "invalid_client" },
    { kind: "error", status: 403, error: "invalid_grant" },
  ];
  for (const reply of rejected) {
    const { result, store, state } = await run(reply, 60_000);
    const label = JSON.stringify(reply);
    assert.ok(!result.ok, label);
    assert.deepStrictEqual(result.error.code, "conflict", label);
    assert.deepStrictEqual(
      result.error.message,
      APP_OAUTH_SIGN_IN_REQUIRED,
      label,
    );
    assert.deepStrictEqual(store.has(NAME), false, label);
    assert.deepStrictEqual(
      store.has(`app-oauth.${NAME}.refresh`),
      false,
      label,
    );
    assert.deepStrictEqual(store.has(`app-oauth.${NAME}.meta`), false, label);
    // client id는 남는다.
    assert.deepStrictEqual(
      store.get(`app-oauth.${NAME}.client_id`),
      "client-1",
      label,
    );
    assert.ok(state.ok, label);
    assert.deepStrictEqual(
      (state.value as { secrets: Array<Record<string, unknown>> }).secrets[0]?.[
        "state"
      ],
      "failed",
      label,
    );
    assert.deepStrictEqual(
      (state.value as { secrets: Array<Record<string, unknown>> }).secrets[0]?.[
        "reason"
      ],
      "refresh_rejected",
      label,
    );
  }

  const unreachable: Array<IssuerReply | "throws"> = [
    "throws",
    { kind: "error", status: 503, error: "temporarily_unavailable" },
  ];
  for (const reply of unreachable) {
    const label = JSON.stringify(reply);
    const valid = await run(reply, 60_000);
    assert.ok(valid.result.ok, label);
    assert.deepStrictEqual(valid.result.value, { value: ACCESS }, label);
    assert.deepStrictEqual(valid.store.get(NAME), ACCESS, label);
    assert.deepStrictEqual(
      valid.store.has(`app-oauth.${NAME}.refresh`),
      true,
      label,
    );

    const expired = await run(reply, -1);
    assert.ok(!expired.result.ok, label);
    assert.deepStrictEqual(expired.result.error.code, "unavailable", label);
    assert.deepStrictEqual(
      expired.store.has(`app-oauth.${NAME}.refresh`),
      true,
      label,
    );
  }
});
