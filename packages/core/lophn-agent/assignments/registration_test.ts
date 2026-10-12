import { z } from "zod";
import { ok } from "../../../base/mod.ts";
import { ACTOR_KINDS, defineCommand } from "../../../protocol/server/mod.ts";
import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "./mod.ts";

// assignment ledger 테스트 등록. 자리의 생성·보관·보관 해제 event는 apps와 documents가 내는
// 것이라 이 leaf는 같은 모양의 event 한 줄만 심는 fixture command로 대신한다.

export const seedPlaceEventRoute = defineCommand({
  resource: "assignment-fixture",
  method: "seed-place-event",
  name: "SeedPlaceEvent",
  input: z.strictObject({
    type: z.enum([
      "ProjectCreated",
      "ProjectArchived",
      "ProjectUnarchived",
      "AppCreated",
      "AppArchived",
      "AppUnarchived",
    ]),
    subject: z.string(),
  }),
  output: z.strictObject({ seq: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const commands = createAssignmentCommands();
  const reads = createAssignmentReads();
  return {
    schemaSteps: [...assignmentSchemaSteps],
    commands: [
      commands.createBuiltin,
      commands.createAppEngineer,
      commands.createOperator,
      commands.pause,
      commands.resume,
      commands.withdraw,
    ],
    testCommands: [{
      route: seedPlaceEventRoute,
      handle(tx, _ctx, input) {
        const seeded = input as { type: string; subject: string };
        tx.sql.run(
          `insert into events (type, subject, actor, run, payload, at)
           values (?, ?, 'machine', null, '{}', ?)`,
          [seeded.type, seeded.subject, tx.now()],
        );
        const row = tx.sql.get(
          "select cast(max(seq) as text) as seq from events",
          [],
        );
        return ok({ seq: String(row!["seq"]) });
      },
    }],
    reads: [reads.read, reads.list],
  };
}
