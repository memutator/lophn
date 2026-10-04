import { manualClock } from "../../../packages/base/mod.ts";
import type { LedgerTestRegistration } from "./ledger.ts";
import { createLedgerTestRegistration as owner } from "./owner-registration_test.ts";
import type { LedgerTestEnvironment } from "./ledger.ts";

export function createLedgerTestRegistration(
  environment: LedgerTestEnvironment,
): LedgerTestRegistration {
  const kind = new URL(import.meta.url).searchParams.get("kind");
  const original = owner(environment);
  switch (kind) {
    case "command":
      return { commands: original.commands };
    case "path":
      return {
        commands: original.commands?.map((definition) => ({
          ...definition,
          route: { ...definition.route, name: "other.command" },
        })),
      };
    case "read":
      return { reads: original.reads };
    case "schema":
      return { schemaSteps: original.schemaSteps };
    case "clock":
      return { clock: manualClock(0) };
    case "blob":
      return { registerBlobRef: original.registerBlobRef };
    case "ids":
      return { ids: { newId: () => "doc_01jgfjjz008000000000000000" } };
    case "reader-startup":
      if (
        (globalThis as unknown as { name?: string }).name?.includes(
          '"role":"reader"',
        )
      ) throw new Error("reader fixture startup failure");
      return {};
    case "reader-timeout":
      return {
        reads: original.reads?.map((definition) => ({
          ...definition,
          route: {
            ...definition.route,
            resource: "blocked",
            name: "owner.read",
          },
          handle() {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
            throw new Error("late read");
          },
        })),
      };
    default:
      throw new Error("invalid registration fixture");
  }
}
