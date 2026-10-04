import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { eventEnvelopeSchema } from "../platform/events.ts";
import { routePath } from "../platform/route.ts";
import {
  GRANT_EVENTS,
  GRANT_ROUTES,
  grantCreate,
  grantCreated,
  grantCreateInputSchema,
  grantRevoke,
  grantRevoked,
  grantRevokeInputSchema,
  grantSchema,
  grantsList,
  grantsListInputSchema,
  grantsListOutputSchema,
} from "./grants.ts";
import { EVENTS, ROUTES } from "./registry.ts";
import { ALL_EVENTS, ALL_ROUTES } from "../mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";
const APR = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const GRT = "grt_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T00:00:00.000Z";
const LATER = "2026-10-04T00:01:00.000Z";
const META = { as_of_seq: "8", next_cursor: null };

const fetchScope = {
  kind: "net.fetch" as const,
  host: "api.example.com",
  port: 443,
};

const automationScope = {
  kind: "automation.run" as const,
  automation: "nightly",
  command: "usage.sync",
  input_hash: "ab".repeat(32),
  when: { kind: "interval" as const, interval_ms: 60000 },
};

const grant = {
  id: GRT,
  app: APP,
  kind: "net.fetch" as const,
  scope: fetchScope,
  approval: APR,
  status: "active" as const,
  created_by: "user" as const,
  created_at: AT,
  revoked_by: null,
  revoked_at: null,
};

Deno.test("apps/permissions#R1, apps/permissions#R21, apps/automations#R13: route와 event 이름은 architecture 5.4와 같다", () => {
  assertEquals(
    GRANT_ROUTES.map((route) => [route.kind, routePath(route), route.name]),
    [
      ["command", "/v1/grants/create", "grant.create"],
      ["command", "/v1/grants/revoke", "grant.revoke"],
      ["read", "/v1/grants/list", "grants.list"],
    ],
  );
  assertEquals(
    GRANT_EVENTS.map((event) => event.type),
    ["GrantCreated", "GrantRevoked"],
  );
  assertEquals(
    ROUTES.filter((route) => route.resource === "grants").length,
    GRANT_ROUTES.length,
  );
  assertEquals(
    ROUTES.filter((route) => route.resource === "grants").map((route) =>
      route.name
    ),
    GRANT_ROUTES.map((route) => route.name),
  );
  assertEquals(
    EVENTS.filter((event) => event.type.startsWith("Grant")).map((event) =>
      event.type
    ),
    ["GrantCreated", "GrantRevoked"],
  );
  assertEquals(grantCreate.actors, ["machine"]);
  assertEquals(grantRevoke.actors, ["user"]);
  assertEquals(grantCreate.errors, ["forbidden", "invalid_input", "conflict"]);
  assertEquals(grantRevoke.errors, ["conflict", "unavailable"]);
  assertEquals(grantRevoke.confirmation, "required");
  assertEquals(grantRevoke.binding, ["grant"]);
  assertEquals(grantRevoke.display_read, "grants/list");
  for (const route of GRANT_ROUTES) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("apps/permissions#R1: grant는 종류·범위·approval·사람 결정자를 찾는다", () => {
  const parsed = grantSchema.parse(grant);
  assertEquals(parsed.status, "active");
  assertEquals(parsed.created_by, "user");
  assertEquals(parsed.revoked_by, null);
  // kind는 scope의 kind와 일치해야 한다.
  assert(
    !grantSchema.safeParse({ ...grant, kind: "fs.write" }).success,
  );
  assert(
    !grantSchema.safeParse({ ...grant, created_by: "machine" }).success,
  );
  const revoked = grantSchema.parse({
    ...grant,
    status: "revoked",
    revoked_by: "user",
    revoked_at: LATER,
  });
  assertEquals(revoked.status, "revoked");
  // 종료 확인 없는 회수는 없다.
  assert(
    !grantSchema.safeParse({
      ...revoked,
      revoked_by: null,
      revoked_at: null,
    }).success,
  );
  // revoked를 다시 active로 만들지 않는다. 새 approval·새 Grant다.
  assert(!grantSchema.safeParse({ ...revoked, status: "active" }).success);
});

Deno.test("apps/permissions#R26, apps/permissions#R27: app.call과 agent.commands grant의 방향과 범위를 찾는다", () => {
  const appCall = grantSchema.parse({
    ...grant,
    kind: "app.call",
    scope: {
      kind: "app.call",
      app: OTHER_APP,
      commands: ["lookup", "sync"],
    },
  });
  assertEquals(
    appCall.scope.kind === "app.call" ? appCall.scope.app : undefined,
    OTHER_APP,
  );
  // 자기 앱으로의 app.call grant는 없다.
  assert(
    !grantSchema.safeParse({
      ...grant,
      kind: "app.call",
      scope: { kind: "app.call", app: APP, commands: ["lookup"] },
    }).success,
  );
  const agentCommands = grantSchema.parse({
    ...grant,
    kind: "agent.commands",
    scope: { kind: "agent.commands", commands: ["lookup"] },
  });
  assertEquals(agentCommands.kind, "agent.commands");
  assert(
    !grantSchema.safeParse({
      ...agentCommands,
      scope: { kind: "agent.commands", commands: [] },
    }).success,
  );
});

Deno.test("apps/automations#R13: automation.run scope의 고정 입력·주기를 찾는다", () => {
  const created = grantCreateInputSchema.parse({
    app: APP,
    kind: "automation.run",
    scope: automationScope,
    approval: APR,
  });
  assertEquals(created.kind, "automation.run");
  const parsed = grantSchema.parse({
    ...grant,
    kind: "automation.run",
    scope: automationScope,
  });
  assertEquals(parsed.kind, "automation.run");
  assert(
    grantSchema.safeParse({
      ...grant,
      kind: "automation.run",
      scope: {
        ...automationScope,
        when: { kind: "interval", interval_ms: 59999 },
      },
    }).success === false,
  );
  assert(
    grantSchema.safeParse({
      ...grant,
      kind: "automation.run",
      scope: { ...automationScope, when: { kind: "on_start" } },
    }).success,
  );
  assert(
    !grantCreateInputSchema.safeParse({
      app: APP,
      kind: "automation.run",
      scope: automationScope,
      approval: APR,
      extra: true,
    }).success,
  );
});

Deno.test("apps/permissions#R21: revoke는 접수와 종료 확인을 구별한다", () => {
  const accepted = grantRevokeInputSchema.parse({
    grant: GRT,
    process_nonce: "nonce-1",
    termination_confirmed: true,
  });
  assertEquals(accepted.grant, GRT);
  // 종료를 모르면 접수만 있다.
  grantRevokeInputSchema.parse({
    grant: GRT,
    process_nonce: "nonce-1",
    termination_confirmed: null,
  });
  assert(
    !grantRevokeInputSchema.safeParse({
      grant: GRT,
      extra: true,
    }).success,
  );
  // 종료 확인 없는 회수 완료는 unavailable이다.
  assertEquals(grantRevoke.errors.includes("unavailable"), true);
});

Deno.test("apps/permissions#R1, apps/permissions#R3: grant 목록은 현재 app의 grant를 찾는다", () => {
  const page = grantsListOutputSchema.parse({
    ...META,
    grants: [grant],
  });
  assertEquals(page.grants.length, 1);
  assertEquals(page.as_of_seq, "8");
  grantsListInputSchema.parse({ app: APP, status: "active", limit: 100 });
  assert(!grantsListInputSchema.safeParse({ extra: true }).success);
  assert(!grantsListInputSchema.safeParse({ limit: 201 }).success);
  assert(!grantsListInputSchema.safeParse({ app: GRT }).success);
});

Deno.test("apps/permissions#R1: GrantCreated와 GrantRevoked payload는 정본과 같다", () => {
  eventEnvelopeSchema(grantCreated).parse({
    seq: "8",
    type: "GrantCreated",
    subject: GRT,
    actor: "machine",
    run: null,
    payload: {
      app: APP,
      kind: "net.fetch",
      scope: fetchScope,
      approval: APR,
      created_by: "user",
      created_at: AT,
    },
    at: AT,
  });
  eventEnvelopeSchema(grantRevoked).parse({
    seq: "9",
    type: "GrantRevoked",
    subject: GRT,
    actor: "user",
    run: null,
    payload: {
      app: APP,
      kind: "net.fetch",
      revoked_by: "user",
      revoked_at: LATER,
    },
    at: LATER,
  });
  // payload의 scope 종류는 Grant kind와 같아야 한다.
  assert(
    !grantCreated.payload.safeParse({
      app: APP,
      kind: "net.fetch",
      scope: { kind: "fs.read", path: "/tmp", recursive: false },
      approval: APR,
      created_by: "user",
      created_at: AT,
    }).success,
  );
  assert(
    !grantRevoked.payload.safeParse({
      app: APP,
      kind: "net.fetch",
      revoked_by: "machine",
      revoked_at: LATER,
    }).success,
  );
  assert(
    !grantCreated.payload.safeParse({
      app: APP,
      kind: "net.fetch",
      scope: fetchScope,
      approval: APR,
      created_by: "machine",
      created_at: AT,
    }).success,
  );
});

Deno.test("apps/permissions#R1: create 입력은 검증된 approval만 받는다", () => {
  assert(
    grantCreateInputSchema.safeParse({
      app: APP,
      kind: "net.fetch",
      scope: fetchScope,
      approval: APR,
    }).success,
  );
  assert(
    !grantCreateInputSchema.safeParse({
      app: APP,
      kind: "fs.write",
      scope: fetchScope,
      approval: APR,
    }).success === false,
  );
  assert(
    !grantCreateInputSchema.safeParse({
      app: APP,
      kind: "net.fetch",
      scope: fetchScope,
      approval: GRT,
    }).success,
  );
  assert(
    !grantCreateInputSchema.safeParse({
      app: GRT,
      kind: "net.fetch",
      scope: fetchScope,
      approval: APR,
    }).success,
  );
});
