import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import { ACTOR_KINDS, defineCommand } from "../../../protocol/server/mod.ts";
import {
  bodyHashOf,
  registerMessageBodyRef,
  textContent,
} from "./testing/mod.ts";
import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../assignments/mod.ts";
import {
  createRunCommands,
  createRunReads,
  deleteSessionRuns,
  runSchemaSteps,
} from "../run-loop/mod.ts";
import { modelSchemaSteps } from "../models/mod.ts";
import { toolsSchemaSteps } from "../tools/mod.ts";
import {
  createRevertCommands,
  createRevertReads,
  revertSchemaSteps,
} from "./rewind/mod.ts";
import {
  type ConversationDeps,
  conversationSchemaSteps,
  createConversationCommands,
  createConversationReads,
  hasUnappliedSteering,
  recordFactMessage,
  startRequest,
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
      "ContextCreated",
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
    scope_kind: z.enum(["project", "app"]),
    scope_id: z.string(),
  }),
  output: z.strictObject({ id: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

// assignment를 멈추거나 되돌린다. 멈춤을 낳는 자리 보관 event는 이 시험의 관심이 아니다.
const seedAssignmentStateRoute = defineCommand({
  resource: "conversation-fixture",
  method: "seed-assignment-state",
  name: "SeedAssignmentState",
  input: z.strictObject({
    assignment: z.string(),
    state: z.enum(["enabled", "paused"]),
  }),
  output: z.strictObject({ assignment: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

// Workspace의 Model for summaries 칸을 채운다. 기본값을 바꾸는 command와 provider 등록은
// 이 시험의 관심이 아니므로 표에 바로 쓴다.
const seedSummariesRoute = defineCommand({
  resource: "conversation-fixture",
  method: "seed-summaries-model",
  name: "SeedSummariesModel",
  input: z.strictObject({ provider: z.string(), model_name: z.string() }),
  output: z.strictObject({ model_name: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

// 다른 command가 같은 transaction에서 부르는 사실 메시지 기록(recordFactMessage)을 그대로 부른다.
const seedFactRoute = defineCommand({
  resource: "conversation-fixture",
  method: "seed-fact",
  name: "SeedFactMessage",
  input: z.strictObject({ session: z.string(), text: z.string() }),
  output: z.strictObject({ message: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict", "forbidden", "not_found", "invalid_input"],
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

// 다른 concern이 사람 한 번의 요청으로 세션·message·run을 접수하는 길(startRequest)을 command 하나로
// 부른다. 본문 blob은 이미 다른 owner가 참조한 것으로 두는 것이 실제 호출(위반 넘기기)과 같다.
const startRequestRoute = defineCommand({
  resource: "conversation-fixture",
  method: "start-request",
  name: "StartRequestFixture",
  input: z.strictObject({
    role: z.literal("context_engineer"),
    work_place: z.strictObject({
      kind: z.enum(["global", "project", "app"]),
      id: z.string().nullable(),
    }),
    text: z.string(),
  }),
  output: z.strictObject({
    session: z.string(),
    message: z.string(),
    run: z.string(),
  }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict", "invalid_input", "not_found", "unavailable"],
});

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const assignmentCommands = createAssignmentCommands();
  const assignmentReads = createAssignmentReads();
  const runCommands = createRunCommands({ hasUnappliedSteering });
  const runReads = createRunReads();
  const deps: ConversationDeps = {
    // 제품 조립과 같다. session을 지울 때 그 session의 run 기록은 run-loop가 지운다. 본문 참조
    // 지움은 platform 몫이고 core 시험(apps/core/testing)이 본다.
    deleteSessionRecords: (tx, session) =>
      deleteSessionRuns(tx, session, () => ok(undefined)),
    eraseBlobRefs: () => ok(undefined),
    // 접수 실패 주입은 이 fixture 표 하나로만 켠다.
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
  };
  const commands = createConversationCommands(deps);
  const reads = createConversationReads();
  // 되돌리기 command·읽기. 대화 쪽 효과는 기록만 하는 가짜이고 파일은 건드리지 않는다(messages_only만 쓴다).
  const revertDeps = {
    rootOf: () => {
      throw new Error("the conversation world has no project folder");
    },
    appRevision: () => null,
    effects: {
      summaryOk: () => false,
      cancelWaiting: () => ok({ questions: 0, approvals: 0 }),
      resetReadState: () => ok(undefined),
    },
    recordFact: recordFactMessage,
  };
  const revertCommands = createRevertCommands(revertDeps);
  const revertReads = createRevertReads(revertDeps);
  return {
    registerBlobRef: (tx, ctx, reference) =>
      registerMessageBodyRef(
        tx,
        ctx,
        reference,
        () =>
          tx.sql.get("select 1 as found from unprepared where on_ = 1", []) !==
            undefined,
      ),
    schemaSteps: [
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      // Compact가 Workspace의 Model for summaries(agent_model_defaults)를 읽는다.
      ...modelSchemaSteps,
      ...conversationSchemaSteps,
      // ReceiveMessage가 같은 transaction에서 checkpoint를 만든다. 되돌리기 표가 tool call을 가리킨다.
      ...toolsSchemaSteps,
      ...revertSchemaSteps,
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
      assignmentCommands.createBuiltin,
      assignmentCommands.createAppEngineer,
      assignmentCommands.createOperator,
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
      commands.rename,
      commands.archive,
      commands.unarchive,
      commands.delete,
      commands.changeModel,
      commands.fork,
      commands.requestCompact,
      commands.compact,
      commands.failCompact,
      commands.close,
      commands.receive,
      commands.record,
      commands.apply,
      commands.assign,
      revertCommands.record,
      revertCommands.rewind,
      revertCommands.undo,
      revertCommands.redo,
      revertCommands.amend,
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
            scope_kind: string;
            scope_id: string;
          };
          tx.sql.run(
            `insert into assignments (id, role, scope_kind, scope_id, state,
               revision)
             values (?, 'operator', ?, ?, 'enabled', 1)`,
            [seeded.id, seeded.scope_kind, seeded.scope_id],
          );
          return ok({ id: seeded.id });
        },
      },
      {
        route: seedAssignmentStateRoute,
        handle(tx, _ctx, input) {
          const seeded = input as { assignment: string; state: string };
          const paused = seeded.state === "paused";
          tx.sql.run(
            `update assignments set state = ?, revision = revision + 1,
               pause_detail = ?, pause_target = ? where id = ?`,
            [
              seeded.state,
              paused ? "The place was archived." : null,
              paused ? "prj_01arz3ndektsv4rrffq69g5fav" : null,
              seeded.assignment,
            ],
          );
          return ok({ assignment: seeded.assignment });
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
        route: seedSummariesRoute,
        handle(tx, _ctx, input) {
          const seeded = input as { provider: string; model_name: string };
          tx.sql.run(
            `insert or replace into agent_model_defaults
               (slot, provider, model_name, option_values, settings_seq)
             values ('summaries', ?, ?, '{}', '1')`,
            [seeded.provider, seeded.model_name],
          );
          return ok({ model_name: seeded.model_name });
        },
      },
      {
        route: seedFactRoute,
        handle(tx, ctx, input) {
          const seeded = input as { session: string; text: string };
          const recorded = recordFactMessage(tx, {
            session: seeded.session,
            text: seeded.text,
            principal: ctx.principal,
          });
          return recorded.ok ? ok({ message: recorded.value }) : recorded;
        },
      },
      {
        route: startRequestRoute,
        handle(tx, _ctx, input) {
          const request = input as {
            role: "context_engineer";
            work_place: { kind: "global" | "project" | "app"; id: string };
            text: string;
          };
          const content = textContent(request.text);
          const hash = bodyHashOf(request.text);
          tx.sql.run(
            `insert into blob_refs (owner_kind, owner_key, field, hash,
               size_bytes, registered_seq) values ('request_fixture', ?, 'content', ?, 1, 1)`,
            [hash, hash],
          );
          const started = startRequest(deps, tx, {
            role: request.role,
            work_place: request.work_place as never,
            content,
            body: {
              owner_kind: "request_fixture",
              owner_key: hash,
              field: "content",
              hash,
              registered_seq: "1",
            },
          });
          return started.ok ? ok(started.value) : started;
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
      assignmentReads.read,
      assignmentReads.list,
      runReads.read,
      runReads.list,
      runReads.result,
      reads.session,
      reads.sessions,
      reads.messages,
      reads.compactRequests,
      revertReads.preview,
      revertReads.checkpoints,
      revertReads.list,
    ],
  };
}
