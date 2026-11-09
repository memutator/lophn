import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../base/mod.ts";
import type {
  SecretAllowanceCheck,
  SecretDestination,
  SecretFileSendInput,
} from "../../protocol/secrets/mod.ts";
import { createFileSecretAttach } from "./file-attach.ts";

const VALUE = "sk-app-VALUE-7731";
const STRIPE: SecretDestination = {
  kind: "https",
  origin: "https://api.stripe.com",
};
const LOCAL: SecretDestination = {
  kind: "loopback_http",
  origin: "http://127.0.0.1:8080",
};

// 현재 grant가 허락한 (이름, 목적지) 쌍만 ok인 가짜 allowance다.
const allowance: SecretAllowanceCheck = (request) =>
  request.purpose === "app_secret" &&
  request.context.conditions.app !== undefined &&
  request.name === "stripe_key" &&
  request.destination?.origin === STRIPE.origin
    ? ok(undefined)
    : err({ code: "forbidden", message: "not granted" });

function attach() {
  return createFileSecretAttach({
    file: {
      get: (name) =>
        name === "stripe_key" || name === "provider.x"
          ? ok(VALUE)
          : err({ code: "not_found", message: "no such secret" }),
    },
    allowance,
    processes: () => true,
    destinations: { allowed: () => [] },
  });
}

function input(
  name: string,
  destination: SecretDestination,
  app: boolean,
): SecretFileSendInput {
  return {
    context: {
      principal: "machine:apps-supervisor",
      actor: "machine",
      scope: {
        operations: ["secret.send"],
        targets: { process: "apps/supervisor", task: "apps" },
      },
      conditions: {
        process: "apps/supervisor",
        task: "apps",
        ...(app ? { app: "app_01HZZZZZZZZZZZZZZZZZZZZZZZ" } : {}),
      } as SecretFileSendInput["context"]["conditions"],
      credential_ref: "machine:apps-supervisor",
    },
    use: { name, destination },
    operation: "apps.secret_value",
    body: {},
  };
}

test("app secret leaves only when the grant allows the name and destination", async () => {
  const rows: Array<
    [string, SecretDestination, boolean, "sent" | "forbidden"]
  > = [
    ["stripe_key", STRIPE, true, "sent"],
    // 허락 없는 목적지·이름
    ["stripe_key", LOCAL, true, "forbidden"],
    ["other_key", STRIPE, true, "forbidden"],
    // 앱 호출이 provider 이름을, 앱이 아닌 호출이 앱 이름을 가리킬 수 없다.
    ["provider.x", STRIPE, true, "forbidden"],
    ["stripe_key", STRIPE, false, "forbidden"],
  ];
  for (const [name, destination, app, expected] of rows) {
    let got: string | undefined;
    const sent = await attach().send(input(name, destination, app), (value) => {
      got = String(value);
      return Promise.resolve(ok({ sent: true }));
    });
    const label = `${name} ${destination.origin} app=${app}`;
    if (expected === "sent") {
      assert.ok(sent.ok, label);
      assert.deepStrictEqual(got, VALUE, label);
    } else {
      assert.ok(!sent.ok, label);
      assert.deepStrictEqual(sent.error.code, expected, label);
      assert.deepStrictEqual(got, undefined, label);
      assert.ok(!JSON.stringify(sent.error).includes(VALUE), label);
    }
  }
});

test("OAuth refresh, meta, client, host id and site login values never leave, whatever the allowance says", async () => {
  const open = createFileSecretAttach({
    file: { get: () => ok(VALUE) },
    allowance: () => ok(undefined),
    processes: () => true,
    destinations: { allowed: () => [STRIPE] },
  });
  const names = [
    "app-oauth.stripe_key.refresh",
    "app-oauth.stripe_key.meta",
    "app-oauth.stripe_key.client",
    "app-oauth.stripe_key.client_id",
    "provider-oauth.host-id",
    "login.lgn_01hz.password",
    "login.lgn_01hz.totp",
  ];
  for (const name of names) {
    for (const app of [true, false]) {
      let got: string | undefined;
      const sent = await open.send(input(name, STRIPE, app), (value) => {
        got = String(value);
        return Promise.resolve(ok({ sent: true }));
      });
      assert.ok(!sent.ok, `${name} app=${app}`);
      assert.deepStrictEqual(
        sent.error.code,
        "forbidden",
        `${name} app=${app}`,
      );
      assert.deepStrictEqual(got, undefined, `${name} app=${app}`);
    }
  }
});
