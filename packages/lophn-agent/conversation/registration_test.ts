import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  ACTOR_KINDS,
  blobRefRegistrationSchema,
  defineCommand,
} from "../../contracts/platform/mod.ts";
import { MESSAGE_CONTENT_PURPOSE } from "../../contracts/lophn-agent/mod.ts";
import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
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
  messageBodyFields,
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

// 준비 참조가 없는 상황을 켠다. 실제 준비 만기·주체 판정은 platform의 등록기가 하고
// 그 경로는 apps/core의 실제 core 시험이 본다. 여기서는 command가 만든 증거의 모양과
// 등록 실패 때 전체가 되돌아가는 것만 본다.
const unpreparedRoute = defineCommand({
  resource: "conversation-fixture",
  method: "unprepared",
  name: "SeedUnpreparedBody",
  input: z.strictObject({ unprepared: z.boolean() }),
  output: z.strictObject({ unprepared: z.boolean() }),
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
    // platform 등록기와 같은 검사(field 정의·준비 주체·purpose)를 표 하나로 줄인 시험용
    // 등록이다. 참조 행은 실제 blob_refs 표에 들어간다.
    registerBlobRef: (tx, ctx, reference) => {
      const parsed = blobRefRegistrationSchema.safeParse(reference);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid registration" });
      }
      const value = parsed.data;
      if (
        !messageBodyFields.some((field) =>
          field.owner_kind === value.owner_kind && field.field === value.field
        )
      ) {
        return err({ code: "forbidden", message: "field is not defined" });
      }
      if (value.source.kind !== "prepared") {
        return err({ code: "forbidden", message: "prepared blob only" });
      }
      const blob = value.source.blob;
      if (
        blob.principal !== ctx.principal ||
        blob.purpose !== MESSAGE_CONTENT_PURPOSE ||
        tx.sql.get("select 1 as found from unprepared where on_ = 1", []) !==
          undefined
      ) {
        return err({
          code: "invalid_input",
          message: "no live preparation for this principal and purpose",
        });
      }
      tx.sql.run(
        `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes,
           registered_seq) values (?, ?, ?, ?, ?, ?)`,
        [
          value.owner_kind,
          value.owner_key,
          value.field,
          blob.hash,
          blob.size_bytes,
          BigInt(value.registered_seq),
        ],
      );
      return ok({
        owner_kind: value.owner_kind,
        owner_key: value.owner_key,
        field: value.field,
        hash: blob.hash,
        registered_seq: value.registered_seq,
      });
    },
    schemaSteps: [
      ...presetSchemaSteps,
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      ...conversationSchemaSteps,
      {
        id: "conversation.test.fail-accept",
        sql: "create table fail_accept (fail integer not null)",
      },
      {
        // StartRun이 한도를 읽는 platform 저장 선택 표와 같은 모양이다(run-loop 시험과 같다).
        id: "conversation.test.setting-choices",
        sql:
          "create table setting_choices (layer text not null check (layer = 'common'), key text not null, value json not null, primary key (layer, key))",
      },
      {
        id: "conversation.test.unprepared",
        sql: "create table unprepared (on_ integer not null)",
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
        route: unpreparedRoute,
        handle(tx, _ctx, input) {
          const set = input as { unprepared: boolean };
          tx.sql.run("delete from unprepared", []);
          if (set.unprepared) {
            tx.sql.run("insert into unprepared (on_) values (1)", []);
          }
          return ok({ unprepared: set.unprepared });
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
