import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { createFileSecretAttach } from "../../secrets/file-attach.ts";
import { secretAllowanceOver } from "./secret-allowance.ts";
import { secretValueHandler } from "./secret-value.ts";

const VALUE = "sk-app-VALUE-7731";
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzz";
const RELEASE = "rel_01hzzzzzzzzzzzzzzzzzzzzzzz";
const PORT = 4000;

const scopes = [
  { kind: "secret.use", scope: { name: "stripe_key" } },
  { kind: "net.fetch", scope: { host: "api.stripe.com", port: 443 } },
  // grant가 있어도 lophn 자기 port는 못 받는다.
  { kind: "net.fetch", scope: { host: "127.0.0.1", port: PORT } },
] as const;

// grant와 선언이 같은 범위인 앱 하나. 그 밖의 이름·목적지는 grant 밖이다.
const sql = {
  get: () => undefined,
  all: () =>
    scopes.map((one, index) => ({
      id: `grt_01hzzzzzzzzzzzzzzzzzzzzzz${index}`,
      app: APP,
      scope: JSON.stringify({ kind: one.kind, ...one.scope }),
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
      revoked_at: null,
    })),
};

const handler = secretValueHandler({
  attach: createFileSecretAttach({
    file: {
      get: (name) =>
        name === "stripe_key" || name === "other_key"
          ? ok(VALUE)
          : err({ code: "not_found", message: "no such secret" }),
    },
    allowance: secretAllowanceOver({
      sql,
      declarations: () =>
        ok({
          release: RELEASE,
          permissions: scopes.map((one) => ({ ...one, reason: "test" })),
          app_connections: [],
          app_api: [],
        }),
      platformPorts: () => [PORT],
    }),
    processes: () => true,
    destinations: { allowed: () => [] },
  }),
  known: () => ({
    ready: true,
    match: (text) =>
      text.startsWith(VALUE) ? { index: 0, length: VALUE.length } : undefined,
  }),
  observe: () =>
    Promise.resolve(
      ok({ release: RELEASE, mode: "live", process_nonce: "n1" }),
    ),
});

function caller(supervisor: boolean): AuthenticatedContext {
  return {
    principal: "machine:apps-supervisor",
    actor: "machine",
    scope: {
      operations: ["apps.secret_value"],
      targets: { task: "apps", process: "apps/supervisor" },
    },
    conditions: supervisor ? { task: "apps", process: "apps/supervisor" } : {},
    credential_ref: "machine:apps-supervisor",
  } as AuthenticatedContext;
}

function body(
  name: string,
  host: string,
  port: number,
  scheme = "https",
  nonce = "n1",
) {
  return {
    app: APP,
    release: RELEASE,
    process_nonce: nonce,
    name,
    destination: { scheme, host, port },
  };
}

Deno.test("apps.secret_value gives the value only to the supervisor for a granted name and destination", async () => {
  const rows: Array<[string, AuthenticatedContext, unknown, boolean]> = [
    ["granted", caller(true), body("stripe_key", "api.stripe.com", 443), true],
    [
      "not the supervisor",
      caller(false),
      body("stripe_key", "api.stripe.com", 443),
      false,
    ],
    [
      "name outside the grant",
      caller(true),
      body("other_key", "api.stripe.com", 443),
      false,
    ],
    [
      "destination outside the grant",
      caller(true),
      body("stripe_key", "api.example.com", 443),
      false,
    ],
    [
      "lophn's own port",
      caller(true),
      body("stripe_key", "127.0.0.1", PORT, "http"),
      false,
    ],
    [
      "a process that is not the live child",
      caller(true),
      body("stripe_key", "api.stripe.com", 443, "https", "old"),
      false,
    ],
  ];
  for (const [label, who, input, given] of rows) {
    const result = await handler(who, input);
    if (given) {
      assert(result.ok, label);
      assertEquals(result.value, { value: VALUE }, label);
    } else {
      assert(!result.ok, label);
      assertEquals(result.error.code, "forbidden", label);
      assert(!JSON.stringify(result.error).includes(VALUE), label);
    }
  }
});
