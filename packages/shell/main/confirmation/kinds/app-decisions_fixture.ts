// app-detail 결정 intent 시험과 headless 확인이 함께 쓰는 가짜 core와 intent 표.
import { createKinds } from "./mod.ts";
import { fakeCore, id, ok } from "./kinds_fixture.ts";
import type { ConfirmationIntent } from "../types.ts";
import { record } from "./core.ts";

export const APP = id("app", 1);
export const TARGET = id("app", 2);
export const REL = id("rel", 1);
export const GRT = id("grt", 1);
const HASH = "a".repeat(64);
const when = { kind: "interval", interval_ms: 60000 };
const scope = { kind: "net.fetch", host: "api.example.com", port: 443 };

export function world(
  overrides: Record<string, (body: unknown) => ReturnType<typeof ok>> = {},
) {
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
    ...overrides,
  });
  const kinds = createKinds({
    core: () => core,
    clock: { now: () => 1000 },
    random: (bytes) => bytes.fill(1),
  });
  return { core, kinds, fixed: () => fixed };
}

export const intents: [ConfirmationIntent, string, string][] = [
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
