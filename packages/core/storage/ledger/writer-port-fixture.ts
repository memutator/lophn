import { err, ok } from "../../../base/mod.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../base/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import { defineSyncCommand } from "./handler.ts";
import { noteCreated, recordNote } from "./test-commands.ts";
import { defineTxPort } from "./tx-ports.ts";
import { serveWriter } from "./writer-loop.ts";
import { createWriterRegistration } from "./writer-registration.ts";

const clock = manualClock(Date.parse("2026-01-01T00:00:00.000Z"));
const reservation = definePort<{ reserve(name: string): string }>(
  "documents.reservation",
);

const reserve = defineSyncCommand(recordNote, (tx, _ctx, input) => {
  const seq = tx.port(reservation).reserve(input.name);
  return ok({ name: "fixed", seq });
});

serveWriter(
  self as unknown as Parameters<typeof serveWriter>[0],
  createWriterRegistration({
    commands: [reserve],
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    ports: [defineTxPort(reservation, (tx) => ({
      reserve(name: string) {
        tx.sql.run("insert into reservation (name) values (?)", [name]);
        return tx.emit(noteCreated, `note:${name}`, { name });
      },
    }))],
    registerBlobRef: () => err({ code: "unavailable", message: "blob 없음" }),
    call: () => err({ code: "unavailable", message: "dispatch 없음" }),
    checkCredential: (ctx) => ok(ctx),
  }),
);
