import assert from "node:assert/strict";
import { test } from "node:test";
import { contentBasis } from "../handle.ts";
import { createKinds } from "./mod.ts";
import { fakeCore, handle, id, ok } from "./kinds_fixture.ts";
import { GRANT } from "./approval.ts";
import type { ConfirmationIntent } from "../types.ts";
import { record } from "./core.ts";

const APP = id("app", 1);
const TARGET = id("app", 2);
const REL = id("rel", 1);
const GRT = id("grt", 1);
const HASH = "a".repeat(64);
const when = { kind: "interval", interval_ms: 60000 };
const scope = { kind: "net.fetch", host: "api.example.com", port: 443 };

function world() {
  let fixed: Record<string, unknown> = {};
  const core = fakeCore({
    "read:apps/get": () =>
      ok({ app: { id: APP, name: "Budget", active_release: null } }),
    "read:releases/get": () =>
      ok({
        release: {
          id: REL,
          app: APP,
          number: 1,
          data_schema: 0,
          status: "prepared",
        },
      }),
    "read:releases/compare": () =>
      ok({ comparison: { previous_release: null } }),
    "read:previews/get": () => ok({ observation: null }),
    "read:grants/list": () =>
      ok({
        grants_seq: "17",
        grants: [{
          id: GRT,
          app: APP,
          kind: "net.fetch",
          scope,
          status: "active",
        }],
        display: {
          requirements: [{
            kind: "net.fetch",
            scope: { host: "api.example.com", port: 443 },
            reason: "Sends totals",
          }],
          combination_warnings: [],
          limit_keys: [],
        },
      }),
    "read:apps/blueprint": () =>
      ok({
        release: REL,
        commands: [{ key: "send", label: "Send", effect: "external" }],
        automations: [{ key: "weekly", label: "Weekly" }],
        declarations: {
          permissions: [{
            kind: "net.fetch",
            scope: { host: "api.example.com", port: 443 },
          }],
          app_connections: [{ app: TARGET, commands: ["lookup"] }],
          automations: [{
            key: "weekly",
            command: "send",
            input_hash: HASH,
            when,
            external: true,
          }],
        },
      }),
    "read:apps/automations": () => ok({ automations: [] }),
    "command:approvals/create": (body) => {
      fixed = record(record(body).input);
      return ok({ request: fixed });
    },
    "read:approvals/get": () =>
      ok({ request: { ...fixed, status: "pending", created_seq: "21" } }),
    "read:approvals/text": () =>
      ok({
        reason: "Request",
        changes: "Change",
        external: null,
        reversibility: "Remove",
      }),
    "command:approvals/grant": () => ok({}),
    "command:approvals/apply": () => ok({}),
  });
  const kinds = createKinds({
    core: () => core,
    clock: { now: () => 1000 },
    random: (bytes) => bytes.fill(1),
  });
  return { core, kinds, fixed: () => fixed };
}

const intents: [ConfirmationIntent, string, string][] = [
  [
    {
      kind: "owner_decision",
      concern: "apps/releases",
      decision: "start_activation",
      targets: [REL],
    },
    "release.start_activation",
    "release_activation",
  ],
  [
    {
      kind: "owner_decision",
      concern: "apps/permissions",
      decision: "grant_access",
      targets: [APP],
      requirement: 0,
    },
    "grant.create",
    "grant",
  ],
  [
    {
      kind: "owner_decision",
      concern: "apps/permissions",
      decision: "revoke_grant",
      targets: [APP, GRT],
    },
    "grant.revoke",
    "grant",
  ],
  [
    {
      kind: "owner_decision",
      concern: "apps/automations",
      decision: "enable_automation",
      targets: [APP],
      automation: "weekly",
    },
    "grant.create",
    "automation",
  ],
  [
    {
      kind: "owner_decision",
      concern: "apps/connections",
      decision: "connect_apps",
      targets: [APP, TARGET],
    },
    "grant.create",
    "grant",
  ],
];

for (const [intent, command, kind] of intents) {
  test(`shell/confirmation-window#R5 shell/confirmation-window#R8: app-detail ${intent.kind === "owner_decision" ? intent.decision : ""}는 정확한 approval 하나와 ${kind} 창에 묶인다`, async () => {
    const { core, kinds, fixed } = world();
    const got = await kinds.canon.read(intent, "window");
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.value.request.kind, "approval_request");
    assert.equal(got.value.view?.kind, kind);
    const action = record(fixed().action);
    assert.equal(action.command, command);
    assert.equal(action.caller, "user");
    assert.equal(action.input_hash, contentBasis(record(action.input).value));
    const { input: _input, binding_hash: hash, ...basis } = action;
    assert.equal(hash, contentBasis(basis));
    await kinds.canon.read(intent, "window");
    assert.equal(
      core.calls.filter((call) =>
        call.resource === "approvals" && call.method === "create"
      ).length,
      1,
    );
    assert.equal(
      core.calls.filter((call) => call.method === "apply").length,
      0,
    );
    const sent = await kinds.submit.submit({
      handle: handle(),
      decision: GRANT,
      commandInput: undefined,
      canonical: got.value,
    });
    assert.equal(sent.ok, true);
    const commands = core.calls.filter((call) => call.kind === "command");
    assert.deepEqual(
      commands.map((call) => `${call.resource}/${call.method}`),
      ["approvals/create", "approvals/grant", "approvals/apply"],
    );
    const grant = record(commands[1]!.body);
    assert.equal(grant.confirmation, handle().ref);
    assert.deepEqual(grant.compare, { created_seq: "21" });
    assert.deepEqual(record(record(commands[2]!.body).input).action, action);
  });
}

test("shell/confirmation-window#R5: 선언 밖 automation·연결·requirement는 approval을 만들지 않는다", async () => {
  for (
    const intent of [
      {
        kind: "owner_decision" as const,
        concern: "apps/automations",
        decision: "enable_automation",
        targets: [APP],
        automation: "other",
      },
      {
        kind: "owner_decision" as const,
        concern: "apps/connections",
        decision: "connect_apps",
        targets: [APP, id("app", 3)],
      },
      {
        kind: "owner_decision" as const,
        concern: "apps/permissions",
        decision: "grant_access",
        targets: [APP],
        requirement: 4,
      },
    ]
  ) {
    const { core, kinds } = world();
    const got = await kinds.canon.read(intent, "window");
    assert.equal(got.ok, false);
    if (!got.ok) assert.equal(got.error.code, "not_found");
    assert.equal(
      core.calls.filter((call) => call.kind === "command").length,
      0,
    );
  }
});
