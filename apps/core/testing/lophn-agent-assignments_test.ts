import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  type LophnError,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
} from "../../../packages/contracts/platform/mod.ts";
import { applyMigrations } from "../../../packages/platform/backup-and-migration/mod.ts";
import {
  createSubscriberGate,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../../../packages/platform/ledger/mod.ts";
import { APPROVAL_SCHEMA_STEPS } from "../../../packages/platform/approvals/mod.ts";
import {
  NOTIFICATION_COMMANDS,
  NOTIFICATION_SUBSCRIBER,
  NOTIFICATIONS_SCHEMA_STEPS,
} from "../../../packages/platform/notifications/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../../../packages/lophn-agent/assignments/mod.ts";

// assignment ledger integration 테스트. harness 밖의 direct connection으로
// 등록 executor(applyMigrations + runCommand)와 실제 notification 생성을
// 관측한다. probeWrite는 항상 rollback이라 이벤트를 남길 수 없어서다.

const NOW = Date.UTC(2026, 0, 1);
const NOW_TEXT = "2026-01-01T00:00:00.000Z";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const ENGINEER = "asg_01arz3ndektsv4rrffq69g5fbw";

Deno.test("lophn-agent/assignments#R14 [agent-R12]: a machine pause for an archived app emits AssignmentPaused, the notification trigger creates one notification, a resume creates none", async () => {
  const dir = await Deno.makeTempDir({ prefix: "asg-t9-ntf-" });
  const path = `${dir}/ledger.db`;
  try {
    // 등록 executor 경로의 schema다. assignment·approval·notifications 순서로 만든다.
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [
        ...LEDGER_SCHEMA_STEPS,
        ...assignmentSchemaSteps,
        ...APPROVAL_SCHEMA_STEPS,
        ...NOTIFICATIONS_SCHEMA_STEPS,
      ],
      { clock },
    );
    assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
    const opened = openConnection(path);
    assert(opened.ok, "open");
    const connection = opened.value;

    const gate = createSubscriberGate([{
      name: NOTIFICATION_SUBSCRIBER,
      authorize: (ctx) =>
        ok(
          ctx.principal === "machine-1" &&
            ctx.credential_ref === "cred-m",
        ),
    }]);
    assert(gate.ok, "gate");

    const machineCtx: AuthenticatedContext = {
      actor: "machine",
      principal: "machine-1",
      credential_ref: "cred-m",
      scope: {
        operations: [
          "CreateAppEngineerAssignment",
          "PauseAssignment",
          "ResumeAssignment",
          "create_notification",
          "AdvanceSubscriberCursor",
        ],
        targets: {},
      },
      conditions: {},
    };

    const deps = {
      clock,
      ids: createIdSource({ clock, random: seededRandom(1) }),
      ports: [],
      registerBlobRef: () =>
        err<LophnError>({ code: "unavailable", message: "blob 없음" }),
      call: () =>
        err<LophnError>({ code: "unavailable", message: "dispatch 없음" }),
      subscriberGate: gate.value,
      checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
    };
    const assignmentCommands = createAssignmentCommands();
    const run = (
      commands: Parameters<typeof runCommand>[2],
      ctx: AuthenticatedContext,
      command: string,
      input: unknown,
      key: string,
      compare: unknown = {},
    ) =>
      runCommand(connection, deps, commands, ctx, {
        command,
        input,
        idempotency_key: key,
        compare,
        prepared: [],
      } as never);

    emitSource(connection, "AppCreated", APP, { slug: "review-app" });
    const created = await run(
      [assignmentCommands.createAppEngineer],
      machineCtx,
      "CreateAppEngineerAssignment",
      {
        id: ENGINEER,
        app: APP,
        app_created_seq: getEventSeq(connection, "AppCreated"),
      },
      "create-asg",
    );
    assert(created.ok, created.ok ? "" : JSON.stringify(created.error));

    // notification CAS를 위한 현재 cursor다.
    const storedCursor = () => {
      const row = connection.sql.get(
        "select processed_through_seq as s from subscriber_cursors where subscriber = ?",
        [NOTIFICATION_SUBSCRIBER],
      );
      return row === undefined ? "0" : String(row["s"]);
    };
    let ntf = 0;
    const notify = (sourceSeq: string, event: string) => {
      ntf++;
      return run(
        [NOTIFICATION_COMMANDS[0]],
        machineCtx,
        "create_notification",
        {
          id: `ntf_${sourceSeq.padStart(26, "0").slice(-26)}`,
          source_seq: sourceSeq,
          source_event: event,
          processed_through_seq: sourceSeq,
          subscriber: NOTIFICATION_SUBSCRIBER,
        },
        `create-ntf-${ntf}`,
        { processed_through_seq: storedCursor() },
      );
    };

    // 보관 event 뒤의 machine pause가 AssignmentPaused를 낸다.
    emitSource(connection, "AppArchived", APP, { run_enabled: false });
    const paused = await run(
      [assignmentCommands.pause],
      machineCtx,
      "PauseAssignment",
      {
        assignment: ENGINEER,
        reason: {
          kind: "scope_archived",
          detail: "The app was archived.",
          target: APP,
        },
      },
      "pause-machine",
      { revision: 1, state: "enabled" },
    );
    assert(paused.ok, paused.ok ? "" : JSON.stringify(paused.error));
    const events = connection.sql.all(
      "select cast(seq as text) as seq, actor from events where type = 'AssignmentPaused' order by seq",
      [],
    );
    assertEquals(events.length, 1);
    assertEquals(String(events[0]!["actor"]), "machine");

    // 실제 등록 executor 경로에서 notification이 만들어지고 cursor가 전진한다(architecture 5.10).
    const made = await notify(String(events[0]!["seq"]), "AssignmentPaused");
    assert(made.ok, made.ok ? "" : JSON.stringify(made.error));
    assertEquals(countNotifications(connection), 1n);
    assertEquals(storedCursor(), String(events[0]!["seq"]));

    // 보관이 풀려 machine이 재개하면 AssignmentResumed가 나고 notification 계기는 아니다.
    emitSource(connection, "AppUnarchived", APP, {});
    const resumed = await run(
      [assignmentCommands.resume],
      machineCtx,
      "ResumeAssignment",
      { assignment: ENGINEER },
      "resume-machine",
      { revision: 2, state: "paused" },
    );
    assert(resumed.ok, resumed.ok ? "" : JSON.stringify(resumed.error));
    const resumedSeq = getEventSeq(connection, "AssignmentResumed");
    const none = await notify(resumedSeq, "AssignmentResumed");
    assert(!none.ok);
    assertEquals(countNotifications(connection), 1n);

    connection.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

function emitSource(
  connection: ReturnType<typeof openConnection> extends Result<infer T> ? T
    : never,
  type: string,
  subject: string,
  payload: Record<string, unknown>,
) {
  connection.sql.run(
    "insert into events (type, subject, actor, payload, at) values (?, ?, ?, ?, ?)",
    [type, subject, "machine", JSON.stringify(payload), NOW_TEXT],
  );
}

function getEventSeq(
  connection: ReturnType<typeof openConnection> extends Result<infer T> ? T
    : never,
  type: string,
): string {
  const row = connection.sql.get(
    "select cast(seq as text) as seq from events where type = ? order by seq desc limit 1",
    [type],
  );
  assert(row !== undefined);
  return String(row["seq"]);
}

function countNotifications(
  connection: ReturnType<typeof openConnection> extends Result<infer T> ? T
    : never,
): bigint {
  const row = connection.sql.get(
    "select count(*) as n from notifications",
    [],
  );
  return BigInt(String(row?.["n"] ?? "0"));
}
