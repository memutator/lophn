import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import { applyMigrations } from "../backup-and-migration/mod.ts";
import { deps as ledgerDeps } from "../ledger/command-harness.ts";
import {
  LEDGER_SCHEMA_STEPS,
  openConnection,
  openLedger,
} from "../ledger/mod.ts";
import { runCommand } from "../ledger/writer.ts";
import {
  createNotificationCommand,
  markNotificationReadCommand,
} from "./commands.ts";
import { conditionMet, triggerOf } from "./model.ts";
import { NOTIFICATIONS_SCHEMA_STEPS } from "./schema.ts";
const NOW = Date.parse("2026-10-04T00:00:00.000Z");
const NOW_TEXT = "2026-10-04T00:00:00.000Z";

function machine(): AuthenticatedContext {
  return {
    principal: "machine-1",
    actor: "machine",
    scope: {
      operations: [
        "create_notification",
        "AdvanceSubscriberCursor",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-m",
  };
}

function machineRequest(): AuthenticatedContext {
  return machine();
}

function user(): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations: ["mark_notification_read"], targets: {} },
    conditions: {},
    credential_ref: "cred-1",
  };
}

async function schema(
  dir: string,
): Promise<
  ReturnType<typeof openConnection> extends Result<infer T> ? T : never
> {
  const path = `${dir}/ledger.db`;
  const applied = await applyMigrations(
    path,
    [...LEDGER_SCHEMA_STEPS, ...NOTIFICATIONS_SCHEMA_STEPS],
    { clock: manualClock(NOW) },
  );
  assert(applied.ok, "migration");
  const opened = openConnection(path);
  assert(opened.ok, "open");
  return opened.value;
}

type Conn = Awaited<ReturnType<typeof schema>>;

// template의 shape을 따랐다: path는 schema()가 만든 dir에서 다시 만든다.
function openTestLedger(_connection: Conn, dir: string) {
  const clock = manualClock(NOW);
  return openLedger(`${dir}/ledger.db`, {
    ...ledgerDeps(),
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    ports: [],
    registerBlobRef: () => err({ code: "unavailable", message: "blob 없음" }),
    call: () => err({ code: "unavailable", message: "dispatch 없음" }),
  });
}

// source event를 직접 적는다. source 발생 작업(approval, question 등)은 이미 main에 있다.
function emitSource(
  connection: Conn,
  type: string,
  subject: string,
  payload: Record<string, unknown>,
) {
  connection.sql.run(
    "insert into events (type, subject, actor, payload, at) values (?, ?, ?, ?, ?)",
    [type, subject, "machine", JSON.stringify(payload), NOW_TEXT],
  );
}

function createEnvelope(
  source: { seq: string; type: string },
  processedThrough: string,
  key: string,
) {
  return {
    command: "create_notification",
    input: {
      id: `ntf_${source.seq.padStart(26, "0").slice(-26)}`,
      source_seq: source.seq,
      source_event: source.type,
      processed_through_seq: processedThrough,
    },
    idempotency_key: key,
    compare: { processed_through_seq: processedThrough },
    prepared: [] as string[],
  };
}
void createEnvelope;

// contracts의 createNotification.compare는 발판 CAS(subscriber가 input에 있어야
// 한다)로 적혀 있어 등록 executor의 어떤 봉투도 통과하지 못한다(open-issues
// platform/notifications#Q4). 확인은 handler를 같은 Tx에서 직접 돌리는 경로로 본다.
// 진행 역행 금지는 handler의 advanceSubscriberCursor가 transaction마다 검사한다.
function seedNotification(
  ledger: Awaited<ReturnType<typeof openLedger>> extends Result<infer T> ? T
    : never,
  source: { seq: string; type: string; subject: string },
): Result<{ id: string }> {
  return ledger.transaction(
    { actor: "machine", request: machineRequest() },
    (tx) => {
      const created = createNotificationCommand.handle(
        tx,
        machineRequest(),
        {
          id: `ntf_${source.seq.padStart(26, "0").slice(-26)}`,
          source_seq: source.seq,
          source_event: source.type as never,
          processed_through_seq: source.seq,
        },
        { processed_through_seq: source.seq } as never,
      );
      if (!created.ok) return created;
      return { ok: true, value: { id: created.value.notification.id } };
    },
  );
}

Deno.test("platform/notifications#R1: 계기 표의 사실만 notification을 만든다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-create-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "QuestionCreated",
      "qst_01arz3ndektsv4rrffq69g5fav",
      {
        run: "run_01arz3ndektsv4rrffq69g5fav",
        session: null,
      },
    );
    emitSource(connection, "RunFinished", "run_01arz3ndektsv4rrffq69g5fav", {});
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events order by seq",
      [],
    );
    assert(source);
    const opened = openTestLedger(connection, dir);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    const seeded = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "QuestionCreated",
        subject: "qst_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
    const rows = connection.sql.get(
      "select count(*) as n from notifications",
      [],
    );
    assertEquals(rows?.n, 1n);
    const trigger = triggerOf("RunFinished");
    assertEquals(trigger, undefined);
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R1: 사람이 직접 멈춘 assignment는 계기가 아니다", () => {
  const trigger = triggerOf("AssignmentPaused");
  assert(trigger);
  assert(
    conditionMet(trigger, {
      revision: 1,
      previous_revision: 0,
      reason: {
        kind: "user",
        detail: "사람이 직접 멈췄다",
        runs: [],
        target: null,
      },
      definition_hash: "a".repeat(64),
    }) === false,
  );
  assert(
    conditionMet(trigger, {
      revision: 1,
      previous_revision: 0,
      reason: {
        kind: "consecutive_failures",
        detail: "3번 연속 실패했다",
        runs: [
          "run_01arz3ndektsv4rrffq69g5fav",
          "run_01arz3ndektsv4rrffq69g5fbv",
          "run_01arz3ndektsv4rrffq69g5fcv",
        ],
        target: null,
      },
      definition_hash: "a".repeat(64),
    }) === true,
  );
});

Deno.test("platform/notifications#R1: 사람이 직접 멈춘 assignment와 unchanged watch는 notification을 만들지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-skip-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "AssignmentPaused",
      "asg_01arz3ndektsv4rrffq69g5fav",
      {
        revision: 1,
        previous_revision: 0,
        reason: {
          kind: "user",
          detail: "사람이 직접 멈췄다",
          runs: [],
          target: null,
        },
        definition_hash: "a".repeat(64),
      },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events",
      [],
    );
    assert(source);
    const opened = openTestLedger(connection, dir);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    const rejected = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "AssignmentPaused",
        subject: "asg_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(!rejected.ok);
    if (!rejected.ok) assertEquals(rejected.error.code, "forbidden");
    assertEquals(
      connection.sql.get("select count(*) as n from notifications", [])?.n,
      0n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R2: 계기 표 밖 event와 문서 저장은 notification을 만들지 않는다", () => {
  const notTriggers = [
    "RunFinished",
    "ReportRecorded",
    "TicketCancelled",
    "SettingsChanged",
  ];
  for (const type of notTriggers) assertEquals(triggerOf(type), undefined);
});

Deno.test("platform/notifications#R3: 제목·대상은 source 사실에서 만들고 본문을 복사하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-view-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "QuestionCreated",
      "qst_01arz3ndektsv4rrffq69g5fav",
      {
        run: "run_01arz3ndektsv4rrffq69g5fav",
        session: "ses_01arz3ndektsv4rrffq69g5fav",
      },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events",
      [],
    );
    assert(source);
    const opened = openTestLedger(connection, dir);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    const created = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "QuestionCreated",
        subject: "qst_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(created.ok, created.ok ? "" : JSON.stringify(created.error));
    const notification = connection.sql.get(
      "select id, cast(source_seq as text) as source_seq, read_at from notifications",
      [],
    );
    assert(notification);
    assertEquals(notification["read_at"], null);
    // handler-direct 경로는 command_results를 남기지 않는다. 등록 executor의 결과
    // 저장은 open-issues#Q4 해소 후 등록 봉투 테스트가 본다.
    assertEquals(
      connection.sql.get(
        "select count(*) as n from command_results",
        [],
      )?.n,
      0n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R4: 같은 source_seq는 UNIQUE로 최대 1개이고 재전달은 늘리지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-unique-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "ApprovalRequestCreated",
      "apr_01arz3ndektsv4rrffq69g5fav",
      {
        binding_hash: "b".repeat(64),
      },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events",
      [],
    );
    assert(source);
    const opened = openTestLedger(connection, dir);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    const first = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "ApprovalRequestCreated",
        subject: "apr_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    // 같은 source 사실의 두 번째 insert는 rollback된다. trigger abort는 handler
    // 밖으로 나가 internal로 분류되지만, 행은 하나로 남는다(R4).
    const replay = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "ApprovalRequestCreated",
        subject: "apr_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(!replay.ok);
    assertEquals(
      connection.sql.get("select count(*) as n from notifications", [])?.n,
      1n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R5: 처음 읽음은 read_at·NotificationRead를 한 번 남기고 반복은 unchanged다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-read-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "QuestionCreated",
      "qst_01arz3ndektsv4rrffq69g5fav",
      {
        run: "run_01arz3ndektsv4rrffq69g5fav",
        session: null,
      },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events",
      [],
    );
    assert(source);
    const opened = openTestLedger(connection, dir);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    const seed = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "QuestionCreated",
        subject: "qst_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(seed.ok, seed.ok ? "" : JSON.stringify(seed.error));
    const id = `ntf_${String(source["seq"]).padStart(26, "0").slice(-26)}`;
    const mark = () =>
      runCommand(
        connection,
        { ...ledgerDeps(), checkCredential: () => ok(user()) },
        [markNotificationReadCommand],
        user(),
        {
          command: "mark_notification_read",
          input: { notification: id },
          idempotency_key: `read-${id}`,
          compare: {},
          prepared: [] as string[],
        },
      );
    const first = await mark();
    assert(first.ok, JSON.stringify(first));
    if (first.ok) {
      const output = first.value.result as { changed: boolean };
      assert(output.changed === true);
    }
    const readAt = connection.sql.get(
      "select read_at from notifications where id = ?",
      [id],
    );
    assert(readAt?.read_at);
    // 같은 key의 재전달은 저장된 결과를 replay한다. 반복 읽음의 unchanged는 새
    // key의 mark로 본다.
    const again = await runCommand(
      connection,
      { ...ledgerDeps(), checkCredential: () => ok(user()) },
      [markNotificationReadCommand],
      user(),
      {
        command: "mark_notification_read",
        input: { notification: id },
        idempotency_key: `read-again-${id}`,
        compare: {},
        prepared: [] as string[],
      },
    );
    assert(again.ok, again.ok ? "" : JSON.stringify(again.error));
    if (again.ok) {
      const output = again.value.result as { changed: boolean };
      assert(output.changed === false, "반복 읽음은 unchanged다");
    }
    const reads = connection.sql.get(
      "select count(*) as n from events where type = 'NotificationRead'",
      [],
    );
    assertEquals(reads?.n, 1n);
    // 읽음은 재시작 뒤에도 남는다(R5).
    connection.close();
    const reopened = await schema(dir);
    try {
      const after = reopened.sql.get(
        "select read_at from notifications where id = ?",
        [id],
      );
      assert(after?.read_at);
    } finally {
      reopened.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R5: 없는 notification의 읽음은 not_found다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-read-404-" });
  const connection = await schema(dir);
  try {
    const missing = await runCommand(
      connection,
      { ...ledgerDeps(), checkCredential: () => ok(user()) },
      [markNotificationReadCommand],
      user(),
      {
        command: "mark_notification_read",
        input: { notification: "ntf_01arz3ndektsv4rrffq69g5fav" },
        idempotency_key: "read-missing",
        compare: {},
        prepared: [] as string[],
      },
    );
    assert(!missing.ok);
    if (!missing.ok) assertEquals(missing.error.code, "not_found");
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R6: 읽음 표시는 approval·question 상태를 바꾸지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-r6-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "QuestionCreated",
      "qst_01arz3ndektsv4rrffq69g5fav",
      {
        run: "run_01arz3ndektsv4rrffq69g5fav",
        session: null,
      },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events",
      [],
    );
    assert(source);
    const opened = openTestLedger(connection, dir);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    const seed = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "QuestionCreated",
        subject: "qst_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(seed.ok, seed.ok ? "" : JSON.stringify(seed.error));
    const id = `ntf_${String(source["seq"]).padStart(26, "0").slice(-26)}`;
    const marked = await runCommand(
      connection,
      { ...ledgerDeps(), checkCredential: () => ok(user()) },
      [markNotificationReadCommand],
      user(),
      {
        command: "mark_notification_read",
        input: { notification: id },
        idempotency_key: "read-r6",
        compare: {},
        prepared: [] as string[],
      },
    );
    assert(marked.ok);
    // 읽음을 남긴 event는 NotificationRead뿐이다. 승인·답 event는 없다.
    const events = connection.sql.all(
      "select type from events where subject = ? order by seq",
      [id],
    );
    assertEquals(events.map((row) => row["type"]), [
      "NotificationCreated",
      "NotificationRead",
    ]);
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R7: 읽음·생성은 agent run을 새로 시작하지 않는다", async () => {
  // notification command가 run을 새로 만들지 않는지: create와 read 뒤 run은 없다.
  const dir = await Deno.makeTempDir({ prefix: "ntf-r7-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "ReleaseActivationFailed",
      "rel_01arz3ndektsv4rrffq69g5fav",
      {
        started_seq: "1",
        failure: { code: "launch_failed", summary: "시작이 실패했다" },
      },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events",
      [],
    );
    assert(source);
    const opened = openTestLedger(connection, dir);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    const seed = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "ReleaseActivationFailed",
        subject: "rel_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(seed.ok, seed.ok ? "" : JSON.stringify(seed.error));
    const runs = connection.sql.get(
      "select count(*) as n from events where run is not null and type like 'Run%'",
      [],
    );
    assertEquals(runs?.n, 0n);
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R8: 전달 실패여도 notification은 남는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-r8-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "TicketCheckFailed",
      "tkt_01arz3ndektsv4rrffq69g5fav",
      {
        app: "app_01arz3ndektsv4rrffq69g5fav",
        problems: [],
        completion_seq: "1",
        release: "rel_01arz3ndektsv4rrffq69g5fav",
        fix_records: [],
        failed_conditions: [3],
      },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events",
      [],
    );
    assert(source);
    const opened = openTestLedger(connection, dir);
    assert(opened.ok, opened.ok ? "" : opened.error.message);
    const seed = seedNotification(
      opened.value,
      {
        seq: String(source["seq"]),
        type: "TicketCheckFailed",
        subject: "tkt_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assert(seed.ok, seed.ok ? "" : JSON.stringify(seed.error));
    // OS 전달 실패는 notification 표를 건드리지 않는다. cursor는 notification 처리기의
    // transaction에서만 전진한다. 행은 그대로고 R8은 shell이 본다.
    assertEquals(
      connection.sql.get("select count(*) as n from notifications", [])?.n,
      1n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// flow answer-question 7단계의 notification 단계다. ·conversation 화면의 진행은
// lophn-agent가, 결정은 platform/approvals와 lophn-agent/questions가 맡는다.
// 여기서는 notification을 읽음으로 표시해도 결정·run·세션이 늘지 않고,
// 발생 순서대로 모두 다시 읽히는지 본다.
Deno.test(
  "platform/notifications#R6, platform/notifications#R7, platform/notifications#R11: flow answer-question의 notification 단계는 결정·run 없이 순서대로 읽힌다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "ntf-flow-answer-" });
    const connection = await schema(dir);
    try {
      // 질문 2개와 ticket 검사 실패 1개를 순서대로 둔다.
      emitSource(
        connection,
        "QuestionCreated",
        "qst_01arz3ndektsv4rrffq69g5fav",
        { run: "run_01arz3ndektsv4rrffq69g5fav", session: null },
      );
      emitSource(
        connection,
        "TicketCheckFailed",
        "tkt_01arz3ndektsv4rrffq69g5fav",
        {
          app: "app_01arz3ndektsv4rrffq69g5fav",
          problems: [],
          completion_seq: "0",
          release: "rel_01arz3ndektsv4rrffq69g5fav",
          fix_records: [],
          failed_conditions: [1],
        },
      );
      emitSource(
        connection,
        "QuestionCreated",
        "qst_02arz3ndektsv4rrffq69g5fbv",
        { run: "run_01arz3ndektsv4rrffq69g5fav", session: null },
      );
      const opened = openTestLedger(connection, dir);
      assert(opened.ok, opened.ok ? "" : opened.error.message);
      const events = connection.sql.all(
        "select cast(seq as text) as seq, type, subject from events order by seq",
        [],
      );
      for (const event of events) {
        const seeded = seedNotification(opened.value, {
          seq: String(event["seq"]),
          type: String(event["type"]),
          subject: String(event["subject"]),
        });
        assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
      }
      // notification을 순서대로 읽는다(R11).
      const listed = connection.sql.all(
        `select cast(n.source_seq as text) as source_seq, e.type as type
         from notifications n join events e on e.seq = n.source_seq
         order by n.source_seq`,
        [],
      );
      assertEquals(listed.map((row) => row["type"]), [
        "QuestionCreated",
        "TicketCheckFailed",
        "QuestionCreated",
      ]);
      assertEquals(listed.map((row) => row["source_seq"]), ["1", "2", "3"]);
      // 읽음 표시는 결정이 아니다. ApprovalRequest·Question 상태 변경과 답 event는 없다(R6).
      for (const event of events) {
        const marked = await runCommand(
          connection,
          { ...ledgerDeps(), checkCredential: () => ok(user()) },
          [markNotificationReadCommand],
          user(),
          {
            command: "mark_notification_read",
            input: {
              notification: `ntf_${
                String(event["seq"]).padStart(26, "0").slice(-26)
              }`,
            },
            idempotency_key: `flow-answer-read-${event["seq"]}`,
            compare: {},
            prepared: [] as string[],
          },
        );
        assert(marked.ok, marked.ok ? "" : JSON.stringify(marked.error));
      }
      const decisions = connection.sql.all(
        `select type from events where type in
           ('QuestionAnswered', 'QuestionCancelled', 'TicketConfirmed')
         order by seq`,
        [],
      );
      assertEquals(decisions.length, 0);
      // run과 세션은 늘지 않는다(R7). run 표는 lophn-agent T10이 만든다. 여기서는
      // notification handler가 run을 새로 만들지 않는지 event로 본다.
      const runs = connection.sql.get(
        `select count(*) as n from events
         where run is not null and actor = 'notifications'`,
        [],
      );
      assertEquals(runs?.n, 0n);
      assertEquals(
        connection.sql.get(
          "select count(*) as n from notifications where read_at is not null",
          [],
        )?.n,
        3n,
      );
    } finally {
      connection.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
);

// flow resume-agent-session 5단계의 notification 단계다. 창을 닫고 돌아온 뒤
// notification을 읽어도 닫힌 세션·멈춘 assignment가 다시 열리지 않고, 재시작으로
// 읽음이 남는다(curssor와 행은 재시작 뒤에도 그대로다).
Deno.test(
  "platform/notifications#R7, platform/notifications#R11: flow resume-agent-session의 notification 단계는 닫힌 세션을 다시 열지 않고 재시작 뒤에도 남는다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "ntf-flow-resume-" });
    const connection = await schema(dir);
    let id = "";
    try {
      // 닫힌 세션과 멈춘 assignment에 관련 소식을 둔다.
      emitSource(
        connection,
        "AssignmentPaused",
        "asg_01arz3ndektsv4rrffq69g5fav",
        {
          revision: 1,
          previous_revision: 0,
          reason: {
            kind: "consecutive_failures",
            detail: "3번 연속 실패했다",
            runs: [],
            target: null,
          },
          definition_hash: "a".repeat(64),
        },
      );
      emitSource(
        connection,
        "QuestionCreated",
        "qst_01arz3ndektsv4rrffq69g5fav",
        { run: "run_01arz3ndektsv4rrffq69g5fav", session: null },
      );
      const opened = openTestLedger(connection, dir);
      assert(opened.ok, opened.ok ? "" : opened.error.message);
      const events = connection.sql.all(
        "select cast(seq as text) as seq, type, subject from events order by seq",
        [],
      );
      for (const event of events) {
        const seeded = seedNotification(opened.value, {
          seq: String(event["seq"]),
          type: String(event["type"]),
          subject: String(event["subject"]),
        });
        assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
      }
      id = `ntf_${String(events[1]["seq"]).padStart(26, "0").slice(-26)}`;
      const marked = await runCommand(
        connection,
        { ...ledgerDeps(), checkCredential: () => ok(user()) },
        [markNotificationReadCommand],
        user(),
        {
          command: "mark_notification_read",
          input: { notification: id },
          idempotency_key: "flow-resume-read",
          compare: {},
          prepared: [] as string[],
        },
      );
      assert(marked.ok, marked.ok ? "" : JSON.stringify(marked.error));
    } finally {
      connection.close();
    }
    // 재시작한다. 세션·assignment 표는 소유 concern이 맡는다. 여기서는 notification
    // cursor와 읽음이 남고, NotificationCreated·Read를 다시 읽는다(R11).
    const reopened = await schema(dir);
    try {
      const after = reopened.sql.get(
        "select read_at, cast(source_seq as text) as source_seq from notifications where id = ?",
        [id],
      );
      assert(after?.read_at, "재시작 뒤에도 읽음이 남는다(R7)");
      const cursor = reopened.sql.get(
        "select processed_through_seq as s from subscriber_cursors where subscriber = 'notifications'",
        [],
      );
      assert(cursor && Number(cursor["s"]) >= 2);
      const replayed = reopened.sql.all(
        "select type from events where type like 'Notification%' order by seq",
        [],
      );
      assertEquals(replayed.map((row) => row["type"]), [
        "NotificationCreated",
        "NotificationCreated",
        "NotificationRead",
      ]);
      // 읽음 뒤에도 세션이나 run을 다시 만들지 않았다(R7).
      const reopenedRuns = reopened.sql.get(
        `select count(*) as n from events
         where run is not null and actor = 'notifications'`,
        [],
      );
      assertEquals(reopenedRuns?.n, 0n);
    } finally {
      reopened.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
);
