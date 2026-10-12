import { assert, assertFalse } from "@std/assert";
import { manualClock, type Result, seededRandom } from "../../base/mod.ts";
import type { ReadSnapshot } from "../../protocol/platform/mod.ts";
import {
  type CredentialIssue,
  CredentialRegistry,
  type OperationPolicy,
} from "./mod.ts";

export const APP = "app_00000000000000000000000000";
export const OTHER_APP = "app_00000000000000000000000001";
export const POLICIES: OperationPolicy[] = [
  {
    name: "identity/current",
    actors: ["user", "machine", "app", "agent", "coding_agent"],
    kind: "read",
  },
  { name: "task/result", actors: ["user", "machine"], kind: "command" },
  { name: "task/other", actors: ["user", "machine"], kind: "command" },
  {
    name: "tests/result",
    actors: ["machine"],
    kind: "command",
    test_runner_only: true,
  },
  { name: "approval/decide", actors: ["user"], kind: "command" },
];
export const USER: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: { operations: ["identity/current", "approval/decide"], targets: {} },
  conditions: { process: "main-generation" },
};
export const MACHINE: CredentialIssue = {
  actor: "machine",
  principal: "task:build",
  scope: { operations: ["task/result"], targets: { app: APP, task: "build" } },
  conditions: { task: "build", process: "worker-generation", app: APP },
};
export function value<T>(result: Result<T>): T {
  assert(result.ok);
  return result.value;
}
export function code(result: Result<unknown>): string {
  assertFalse(result.ok);
  return result.error.code;
}
export function fixture() {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const random = seededRandom(5);
  return {
    clock,
    random,
    registry: new CredentialRegistry({
      epoch: "core-one",
      clock,
      random,
      operations: POLICIES,
    }),
  };
}
export const SNAPSHOT: ReadSnapshot = {
  as_of_seq: "0",
  sql: { get: () => undefined, all: () => [] },
  port() {
    throw new Error("unused port");
  },
};
