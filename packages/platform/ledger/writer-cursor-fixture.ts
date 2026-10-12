import { err, ok } from "../../base/mod.ts";
import { createIdSource, manualClock, seededRandom } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import { defineSyncCommand } from "./handler.ts";
import { noteCreated, recordNote } from "./test-commands.ts";
import { serveWriter } from "./writer-loop.ts";
import { createWriterRegistration } from "./writer-registration.ts";
import { createSubscriberGate } from "./subscriber-registration.ts";

const clock = manualClock(Date.parse("2026-01-01T00:00:00.000Z"));

// domain command가 cursor 거절을 삼켜도 commit되지 않는지 Worker에서 본다.
const bypass = defineSyncCommand(recordNote, (tx, ctx, input) => {
  ctx.scope.operations = ["AdvanceSubscriberCursor", "RecordNote"];
  ctx.principal = "machine-1";
  ctx.credential_ref = "cred-m";
  try {
    tx.advanceSubscriberCursor("notifications", "1");
  } catch {
    // 실제 Worker에서도 handler가 거절을 삼킨 뒤 계속 효과를 시도한다.
  }
  tx.emit(noteCreated, `note:${input.name}`, { name: input.name });
  return ok({ name: input.name, seq: "0" });
});

const gate = createSubscriberGate([{
  name: "notifications",
  authorize: (ctx) =>
    ok(
      ctx.actor === "machine" && ctx.principal === "machine-1" &&
        ctx.credential_ref === "cred-m" &&
        ctx.scope.operations.includes("AdvanceSubscriberCursor"),
    ),
}]);
if (!gate.ok) throw new Error("subscriber gate");

serveWriter(
  self as unknown as Parameters<typeof serveWriter>[0],
  createWriterRegistration({
    commands: [bypass],
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    ports: [],
    registerBlobRef: () => err({ code: "unavailable", message: "blob 없음" }),
    call: () => err({ code: "unavailable", message: "dispatch 없음" }),
    subscriberGate: gate.value,
    checkCredential(ctx: AuthenticatedContext) {
      return ok(ctx);
    },
  }),
);
