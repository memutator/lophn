import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { defineEvent } from "../../protocol/events/mod.ts";
import { user } from "../storage/ledger/command-harness.ts";
import { createEventVisibilityRegistry } from "./visibility.ts";
import { createListEventsRead } from "./list.ts";
import type { ReaderRegistration } from "../storage/ledger/reads.ts";

export const fixtureEvent = defineEvent("NoteCreated", {
  subject: z.string(),
  payload: z.object({ name: z.string() }),
});
export function createReaderRegistration(): ReaderRegistration {
  const registry = createEventVisibilityRegistry([fixtureEvent], [{
    event: fixtureEvent,
    handle: (_snapshot, _ctx, event) =>
      ok(fixtureEvent.payload.parse(event.payload).name !== "hidden"),
  }]);
  if (!registry.ok) throw new Error("fixture registry");
  return {
    reads: [
      createListEventsRead({
        registry: registry.value,
        current: () => ok(user()),
      }),
    ],
    ports: new Map(),
  };
}
