import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { ACTOR_KINDS, defineCommand } from "../../contracts/platform/mod.ts";
import {
  defineTxPort,
  type LedgerTestRegistration,
} from "../../../apps/core/testing/ledger.ts";
import { runAdmission } from "../../platform/ledger/mod.ts";
import {
  createPresetCommands,
  createPresetReads,
  presetSchemaSteps,
} from "../presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../assignments/mod.ts";
import {
  createRunCommands,
  createRunReads,
  runSchemaSteps,
} from "../harness/run-loop/mod.ts";
import { presetValidateDeps } from "../harness/run-loop/testing/mod.ts";
import {
  conversationSchemaSteps,
  createConversationCommands,
  createConversationReads,
  hasUnappliedSteering,
} from "./mod.ts";

// 세션·메시지 ledger 테스트 등록. preset·assignment·run 표와 같은 wire에
// conversation 명령·읽기를 붙이고, run-loop의 미반영 steering 판정은 제품 core와
// 같은 hasUnappliedSteering(messages 표)을 건다. provider·model call 표는 harness가
// provider·usage 등록 module을 함께 띄워 만든다(messages.applied_at_call 참조).
// 실제 provider를 부르지 않는다.

const seedTargetRoute = defineCommand({
  resource: "conversation-fixture",
  method: "seed-target",
  name: "SeedTargetFixture",
  input: z.strictObject({
    type: z.enum([
      "ProjectCreated",
      "ProjectArchived",
      "ProjectUnarchived",
      "AppCreated",
      "AppArchived",
      "AppUnarchived",
      "DocumentCreated",
      "DocumentSaved",
      "QuestionCreated",
    ]),
    subject: z.string(),
    payload: z.record(z.string(), z.string()).default({}),
  }),
  output: z.strictObject({ seq: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

const seedOperatorRoute = defineCommand({
  resource: "conversation-fixture",
  method: "seed-operator",
  name: "SeedOperatorFixture",
  input: z.strictObject({
    id: z.string(),
    preset: z.string(),
    scope_kind: z.enum(["project", "app"]),
    scope_id: z.string(),
  }),
  output: z.strictObject({ id: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

const failAcceptRoute = defineCommand({
  resource: "conversation-fixture",
  method: "fail-accept",
  name: "SeedAcceptFailure",
  input: z.strictObject({ fail: z.boolean() }),
  output: z.strictObject({ fail: z.boolean() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const presetCommands = createPresetCommands(presetValidateDeps());
  const presetReads = createPresetReads();
  const assignmentCommands = createAssignmentCommands();
  const assignmentReads = createAssignmentReads();
  const runCommands = createRunCommands({ hasUnappliedSteering });
  const runReads = createRunReads();
  const commands = createConversationCommands({
    // 제품 조립과 같다. 접수 실패 주입은 이 fixture 표 하나로만 켠다.
    acceptRun: (tx, ctx, input, compare) =>
      tx.sql.get("select 1 as found from fail_accept where fail = 1", []) !==
          undefined
        ? err({ code: "conflict", message: "injected acceptance failure" })
        : runCommands.accept.handle(
          tx,
          { ...ctx, actor: "machine" },
          input,
          compare,
        ),
  });
  const reads = createConversationReads();
  return {
    schemaSteps: [
      ...presetSchemaSteps,
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      ...conversationSchemaSteps,
      {
        id: "conversation.test.fail-accept",
        sql: "create table fail_accept (fail integer not null)",
      },
    ],
    commands: [
      presetCommands.registerDefault,
      presetCommands.create,
      presetCommands.revise,
      assignmentCommands.createBuiltin,
      assignmentCommands.createAppEngineer,
      assignmentCommands.applyOperator,
      assignmentCommands.changePreset,
      assignmentCommands.pause,
      assignmentCommands.resume,
      assignmentCommands.withdraw,
      runCommands.accept,
      runCommands.start,
      runCommands.checkpoint,
      runCommands.finish,
      runCommands.stop,
      runCommands.confirmNext,
      commands.open,
      commands.changeWorkPlace,
      commands.close,
      commands.receive,
      commands.executeStored,
      commands.record,
      commands.apply,
      commands.assign,
    ],
    // agent command는 run 판정이 있어야 한다. 판정은 runs 표를 읽는다.
    ports: [
      defineTxPort(runAdmission, (tx) => ({
        status: (run: string) => {
          const row = tx.sql.get("select state from runs where id = ?", [run]);
          return row === undefined
            ? "unknown" as const
            : row["state"] === "finished"
            ? "finished" as const
            : "active" as const;
        },
      })),
    ],
    testCommands: [
      {
        route: seedTargetRoute,
        handle(tx, _ctx, input) {
          const seeded = input as {
            type: string;
            subject: string;
            payload: Record<string, string>;
          };
          tx.sql.run(
            `insert into events (type, subject, actor, run, payload, at)
             values (?, ?, 'machine', null, ?, ?)`,
            [
              seeded.type,
              seeded.subject,
              JSON.stringify(seeded.payload),
              tx.now(),
            ],
          );
          const row = tx.sql.get(
            "select cast(max(seq) as text) as seq from events",
            [],
          );
          return ok({ seq: String(row!["seq"]) });
        },
      },
      {
        route: seedOperatorRoute,
        handle(tx, _ctx, input) {
          const seeded = input as {
            id: string;
            preset: string;
            scope_kind: string;
            scope_id: string;
          };
          tx.sql.run(
            `insert into assignments (id, preset_id, preset_revision, role,
               scope_kind, scope_id, state, revision)
             values (?, ?, 1, 'operator', ?, ?, 'enabled', 1)`,
            [seeded.id, seeded.preset, seeded.scope_kind, seeded.scope_id],
          );
          return ok({ id: seeded.id });
        },
      },
      {
        route: failAcceptRoute,
        handle(tx, _ctx, input) {
          const set = input as { fail: boolean };
          tx.sql.run("delete from fail_accept", []);
          if (set.fail) {
            tx.sql.run("insert into fail_accept (fail) values (1)", []);
          }
          return ok({ fail: set.fail });
        },
      },
    ],
    reads: [
      presetReads.read,
      presetReads.list,
      presetReads.instructionAttachments,
      assignmentReads.read,
      assignmentReads.list,
      assignmentReads.outputs,
      runReads.read,
      runReads.list,
      runReads.result,
      reads.session,
      reads.sessions,
      reads.messages,
    ],
  };
}
