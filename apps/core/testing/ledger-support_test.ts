import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../packages/contracts/platform/mod.ts";
import {
  type CommandEnvelope,
  createLedgerHarness,
  type LedgerHarness,
} from "./ledger.ts";

export const fixture = new URL("./owner-registration_test.ts", import.meta.url);
export const readRoute = { resource: "owner", method: "read" };
export const nowMs = Date.UTC(2025, 0, 1);
export const run = "run_01jgfjjz008000000000000000";
export const otherRun = "run_01jgfjjz008000000000000001";
export function credential(
  actor = "user",
  principal = "test-user",
): AuthenticatedContext {
  return {
    actor,
    principal,
    credential_ref: `test:${principal}:${actor}`,
    scope: {
      operations: [
        "owner.create",
        "owner.finish",
        "owner.crash",
        "owner.read",
        "CommandResult",
      ],
      targets: {},
    },
    conditions: {},
  };
}
export const ctx = credential();
export function envelope(
  key: string,
  input: unknown = { key },
): CommandEnvelope {
  return {
    command: "owner.create",
    input,
    compare: {},
    idempotency_key: key,
    prepared: [],
  };
}
export function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}
export function code(result: Result<unknown>, expected: string) {
  assert(!result.ok);
  assertEquals(result.error.code, expected);
}
export async function harness(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [fixture],
      credentials: [ctx],
      nowMs,
    }),
  );
}
