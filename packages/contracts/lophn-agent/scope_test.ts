import { assert, assertEquals } from "@std/assert";
import {
  AGENT_ROLES,
  agentAppScopeOutputSchema,
  agentAppScopeSchema,
  workPlaceSchema,
} from "./scope.ts";

const app = "app_01arz3ndektsv4rrffq69g5fav";
const assignment = "asg_01arz3ndektsv4rrffq69g5fav";

const readEntry = {
  app,
  commands: ["status"],
  effects: ["read"],
  revert_required: false,
  confirm_allowed: false,
};

Deno.test("lophn-agent/roles/common#R1: role enum is the four canonical roles", () => {
  assertEquals([...AGENT_ROLES], [
    "lophn",
    "app_engineer",
    "context_engineer",
    "operator",
  ]);
  assert(workPlaceSchema.safeParse({ kind: "global", id: null }).success);
  assert(!workPlaceSchema.safeParse({ kind: "global", id: app }).success);
  assert(!workPlaceSchema.safeParse({ kind: "app", id: null }).success);
  const project = "prj_01arz3ndektsv4rrffq69g5fav";
  assert(workPlaceSchema.safeParse({ kind: "project", id: project }).success);
  assert(!workPlaceSchema.safeParse({ kind: "project", id: app }).success);
});

Deno.test("lophn-agent/harness/tools#R8: AgentAppScope rejects wildcards duplicates and extra authority", () => {
  const scope = {
    role: "lophn",
    assignment,
    apps: [readEntry],
  };
  assert(agentAppScopeSchema.safeParse(scope).success);
  for (
    const apps of [
      [{ ...readEntry, commands: ["*"] }],
      [{
        ...readEntry,
        commands: ["status", "status"],
        effects: ["read", "read"],
      }],
      [readEntry, readEntry],
      [{ ...readEntry, extra: true }],
    ]
  ) {
    assert(!agentAppScopeSchema.safeParse({ ...scope, apps }).success);
  }
  assert(!agentAppScopeSchema.safeParse({ ...scope, trusted: true }).success);
});

Deno.test("lophn-agent/roles/operator#R5: operator scope is confirm-false read and context engineer has no apps", () => {
  const operator = {
    role: "operator",
    assignment,
    apps: [readEntry],
  };
  assert(agentAppScopeSchema.safeParse(operator).success);
  assert(
    !agentAppScopeSchema.safeParse({
      ...operator,
      apps: [{ ...readEntry, confirm_allowed: true }],
    }).success,
  );
  assert(
    !agentAppScopeSchema.safeParse({
      ...operator,
      apps: [{ ...readEntry, effects: ["write"], revert_required: true }],
    }).success,
  );
  assert(
    agentAppScopeSchema.safeParse({
      role: "context_engineer",
      assignment,
      apps: [],
    }).success,
  );
  assert(
    !agentAppScopeSchema.safeParse({
      role: "context_engineer",
      assignment,
      apps: [readEntry],
    }).success,
  );
});

Deno.test("lophn-agent/roles/app-engineer#R21: app engineer write requires revert and rejects external", () => {
  const role = "app_engineer";
  assert(
    agentAppScopeSchema.safeParse({
      role,
      assignment,
      apps: [{
        ...readEntry,
        commands: ["save"],
        effects: ["write"],
        revert_required: true,
      }],
    }).success,
  );
  assert(
    !agentAppScopeSchema.safeParse({
      role,
      assignment,
      apps: [{
        ...readEntry,
        commands: ["save"],
        effects: ["write"],
        revert_required: false,
      }],
    }).success,
  );
  assert(
    !agentAppScopeSchema.safeParse({
      role,
      assignment,
      apps: [{ ...readEntry, effects: ["external"] }],
    }).success,
  );
});

Deno.test("lophn-agent/roles/operator#R4: effects are a permission set independent of the command count", () => {
  const scope = {
    role: "operator",
    assignment,
    apps: [{ ...readEntry, commands: ["status", "health", "summary"] }],
  };
  assert(agentAppScopeSchema.safeParse(scope).success);
  assert(
    agentAppScopeOutputSchema.safeParse({
      ...scope,
      future: true,
      apps: [{ ...scope.apps[0], future: true }],
    }).success,
  );
  for (
    const commands of [[" "], ["status\n"], ["status*"], ["status", "status"]]
  ) {
    assert(
      !agentAppScopeSchema.safeParse({
        ...scope,
        apps: [{ ...readEntry, commands }],
      }).success,
    );
  }
  const invalid = { ...scope, apps: [{ ...readEntry, revert_required: true }] };
  assert(!agentAppScopeSchema.safeParse(invalid).success);
  assert(!agentAppScopeOutputSchema.safeParse(invalid).success);
  assert(
    !agentAppScopeSchema.safeParse({
      ...scope,
      apps: [readEntry, { ...readEntry, commands: ["health"] }],
    }).success,
  );
});

Deno.test("lophn-agent/roles/context-engineer#R2: scope has no executable app command entries", () => {
  assert(
    agentAppScopeSchema.safeParse({
      role: "context_engineer",
      assignment,
      apps: [],
    }).success,
  );
  assert(
    !agentAppScopeSchema.safeParse({
      role: "context_engineer",
      assignment,
      apps: [readEntry],
    }).success,
  );
  assert(
    !agentAppScopeOutputSchema.safeParse({
      role: "context_engineer",
      assignment,
      apps: [readEntry],
    }).success,
  );
});
