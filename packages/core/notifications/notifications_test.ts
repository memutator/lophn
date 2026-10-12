import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  type LophnError,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import {
  createSubscriberGate,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../storage/ledger/mod.ts";
import {
  createNotificationCommand,
  markNotificationReadCommand,
  NOTIFICATION_SUBSCRIBER,
} from "./commands.ts";
import { conditionMet, triggerOf } from "./model.ts";
import { notificationsGetRead, notificationsListRead } from "./reads.ts";
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

function user(): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations: ["mark_notification_read"], targets: {} },
    conditions: {},
    credential_ref: "cred-1",
  };
}

// 자기 구독자만 cursor를 올린다. command-harness의 ownedCursorGate와 같은 모양이다.
function subscriberGate() {
  const gate = createSubscriberGate([{
    name: NOTIFICATION_SUBSCRIBER,
    authorize: (ctx) =>
      ok(
        ctx.principal === "machine-1" && ctx.credential_ref === "cred-m",
      ),
  }]);
  if (!gate.ok) {
    throw new Error("subscriber 등록이 올바르지 않다");
  }
  return gate.value;
}

// 등록 executor 경로의 TxDeps. subscriberGate는 command-harness와 같은 모양으로
// 자기 구독자만 cursor를 올린다.
function ledgerDeps(clock = manualClock(NOW)) {
  return {
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    ports: [],
    registerBlobRef: () =>
      err<LophnError>({ code: "unavailable", message: "blob 없음" }),
    call: () =>
      err<LophnError>({ code: "unavailable", message: "dispatch 없음" }),
    subscriberGate: subscriberGate(),
    checkCredential: () => ok(machine()),
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

// source event를 직접 적는다. source 발생 작업(approval, question 등)은 이미 main에 있다.
function emitSource(
  connection: Conn,
  type: string,
  subject: string,
  payload: Record<string, unknown>,
  at = NOW_TEXT,
) {
  connection.sql.run(
    "insert into events (type, subject, actor, payload, at) values (?, ?, ?, ?, ?)",
    [type, subject, "machine", JSON.stringify(payload), at],
  );
}

// 등록 executor 봉투. cursor CAS(subscriber + processed_through_seq)를 같이 보낸다.
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
      subscriber: NOTIFICATION_SUBSCRIBER,
    },
    idempotency_key: key,
    compare: { processed_through_seq: processedThrough },
    prepared: [] as string[],
  };
}

// contracts의 cursor CAS는 subscriber를 input에서 읽는다. Q4 해소(lead 결정 (b))
// 뒤 등록 executor 봉투가 통과하므로 create 측은 runCommand 경로로 본다.
// compare는 현재 기록된 cursor와 같아야 conflict가 나지 않는다.
function storedCursor(connection: Conn): string {
  const row = connection.sql.get(
    "select processed_through_seq as s from subscriber_cursors where subscriber = ?",
    [NOTIFICATION_SUBSCRIBER],
  );
  return row === undefined ? "0" : String(row["s"]);
}

function seedNotification(
  connection: Conn,
  source: { seq: string; type: string; subject: string },
  key: string,
): Promise<Result<unknown>> {
  const through = storedCursor(connection);
  return runCommand(
    connection,
    { ...ledgerDeps(), checkCredential: () => ok(machine()) },
    [createNotificationCommand],
    machine(),
    createEnvelope({ seq: source.seq, type: source.type }, through, key),
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
    const seeded = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "QuestionCreated",
        subject: "qst_01arz3ndektsv4rrffq69g5fav",
      },
      "create-main",
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
        kind: "scope_archived",
        detail: "앱을 보관했다",
        runs: [],
        target: "app_01arz3ndektsv4rrffq69g5fav",
      },
      definition_hash: "a".repeat(64),
    }) === true,
  );
});

Deno.test("platform/notifications#R1: 사람이 직접 멈춘 assignment는 notification을 만들지 않는다", async () => {
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
    const rejected = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "AssignmentPaused",
        subject: "asg_01arz3ndektsv4rrffq69g5fav",
      },
      "create-paused",
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
    const created = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "QuestionCreated",
        subject: "qst_01arz3ndektsv4rrffq69g5fav",
      },
      "create-view",
    );
    assert(created.ok, created.ok ? "" : JSON.stringify(created.error));
    const notification = connection.sql.get(
      "select id, cast(source_seq as text) as source_seq, read_at from notifications",
      [],
    );
    assert(notification);
    assertEquals(notification["read_at"], null);
    // 등록 executor는 결과를 command_results에 한 번 남긴다(Q4 해소 뒤 등록 봉투 경로).
    assertEquals(
      connection.sql.get(
        "select count(*) as n from command_results",
        [],
      )?.n,
      1n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R3: 사람 줄은 source event의 시각만 받고 다른 actor에게는 열지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-line-" });
  const connection = await schema(dir);
  const approvedAt = "2026-10-04T03:04:05.006Z";
  try {
    emitSource(
      connection,
      "QuestionCreated",
      "qst_01arz3ndektsv4rrffq69g5fav",
      { run: "run_01arz3ndektsv4rrffq69g5fav", session: null },
    );
    emitSource(
      connection,
      "ApprovalRequestCreated",
      "apr_01arz3ndektsv4rrffq69g5fav",
      {},
      approvedAt,
    );
    const sources = connection.sql.all(
      "select cast(seq as text) as seq, type from events order by seq",
      [],
    );
    for (const [index, source] of sources.entries()) {
      const seeded = await seedNotification(
        connection,
        {
          seq: String(source["seq"]),
          type: String(source["type"]),
          subject: "unused",
        },
        `line-${index}`,
      );
      assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
    }
    const snapshot = {
      sql: connection.sql,
      as_of_seq: "1",
      port() {
        throw new Error("port 없음");
      },
    };
    const list = notificationsListRead();
    const listed = list.handle(snapshot, user(), {});
    assert(listed.ok, listed.ok ? "" : JSON.stringify(listed.error));
    const parsed = list.route.output.safeParse(listed.value);
    assert(parsed.success, JSON.stringify(parsed.error));
    const rows = parsed.data.notifications;
    assertEquals(rows.map((row) => row.source_event), [
      "QuestionCreated",
      "ApprovalRequestCreated",
    ]);
    assertEquals(rows[0]?.occurred_at, NOW_TEXT);
    assertEquals(rows[1]?.occurred_at, approvedAt);
    for (const row of rows) {
      assertEquals("payload" in row, false);
      assertEquals("source_payload" in row, false);
    }
    const hidden = list.handle(snapshot, machine(), {});
    assert(hidden.ok);
    const hiddenParsed = list.route.output.safeParse(hidden.value);
    assert(hiddenParsed.success);
    for (const row of hiddenParsed.data.notifications) {
      assertEquals(row.occurred_at, undefined);
      assertEquals("payload" in row, false);
    }
    const get = notificationsGetRead();
    const second = rows[1]?.notification.id;
    assert(second);
    const got = get.handle(snapshot, user(), { notification: second });
    assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
    const gotParsed = get.route.output.safeParse(got.value);
    assert(gotParsed.success);
    assertEquals(gotParsed.data.occurred_at, approvedAt);
    assertEquals("payload" in gotParsed.data, false);
    const machineGot = get.handle(snapshot, machine(), {
      notification: second,
    });
    assert(machineGot.ok);
    const machineParsed = get.route.output.safeParse(machineGot.value);
    assert(machineParsed.success);
    assertEquals(machineParsed.data.occurred_at, undefined);
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
    const first = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "ApprovalRequestCreated",
        subject: "apr_01arz3ndektsv4rrffq69g5fav",
      },
      "create-once",
    );
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    // 같은 key의 재전달은 저장된 결과를 replay한다. 행은 늘지 않는다(R4).
    const replay = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "ApprovalRequestCreated",
        subject: "apr_01arz3ndektsv4rrffq69g5fav",
      },
      "create-once",
    );
    assert(replay.ok);
    // executor의 재전달 기록은 바깥 replayed flag다. handler 출력의 replayed는
    // 처음 생성에서도 false다.
    const outer = replay.value as { replayed: boolean };
    assert(outer.replayed === true);
    assertEquals(
      connection.sql.get("select count(*) as n from notifications", [])?.n,
      1n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// open-issues#Q4 해소(lead 결정 (b)): cursor CAS는 input의 subscriber를 읽는다.
// compare의 processed_through_seq가 기록된 cursor와 다르면 stale 위치다.
Deno.test("platform/notifications#R4: 낡은 cursor CAS(compare)의 생성은 conflict다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-cas-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "QuestionCreated",
      "qst_01arz3ndektsv4rrffq69g5fav",
      { run: "run_01arz3ndektsv4rrffq69g5fav", session: null },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events",
      [],
    );
    assert(source);
    // compare를 기록된 cursor와 다른 값으로 보낸다. cursor 행이 없어 기준은
    // 0n이므로 "1"은 어긋난다.
    const stale = await runCommand(
      connection,
      { ...ledgerDeps(), checkCredential: () => ok(machine()) },
      [createNotificationCommand],
      machine(),
      createEnvelope(
        { seq: String(source["seq"]), type: "QuestionCreated" },
        "1",
        "create-stale-cas",
      ),
    );
    assert(!stale.ok, JSON.stringify(stale));
    if (!stale.ok) assertEquals(stale.error.code, "conflict");
    // conflict 뒤에도 notification은 생기지 않는다.
    assertEquals(
      connection.sql.get("select count(*) as n from notifications", [])?.n,
      0n,
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
    const seed = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "QuestionCreated",
        subject: "qst_01arz3ndektsv4rrffq69g5fav",
      },
      "create-read",
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
    const seed = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "QuestionCreated",
        subject: "qst_01arz3ndektsv4rrffq69g5fav",
      },
      "create-read",
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
    const seed = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "ReleaseActivationFailed",
        subject: "rel_01arz3ndektsv4rrffq69g5fav",
      },
      "create-r7",
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
    const seed = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "TicketCheckFailed",
        subject: "tkt_01arz3ndektsv4rrffq69g5fav",
      },
      "create-r8",
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
      const events = connection.sql.all(
        "select cast(seq as text) as seq, type, subject from events order by seq",
        [],
      );
      for (const event of events) {
        const seeded = await seedNotification(
          connection,
          {
            seq: String(event["seq"]),
            type: String(event["type"]),
            subject: String(event["subject"]),
          },
          `create-answer-${event["seq"]}`,
        );
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
// 읽음이 남는다(cursor와 행은 재시작 뒤에도 그대로다).
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
            kind: "scope_archived",
            detail: "앱을 보관했다",
            runs: [],
            target: "app_01arz3ndektsv4rrffq69g5fav",
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
      const events = connection.sql.all(
        "select cast(seq as text) as seq, type, subject from events order by seq",
        [],
      );
      for (const event of events) {
        const seeded = await seedNotification(
          connection,
          {
            seq: String(event["seq"]),
            type: String(event["type"]),
            subject: String(event["subject"]),
          },
          `create-answer-${event["seq"]}`,
        );
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
      // cursor는 notification 처리기 transaction에서만 전진한다. 여기서는 command
      // 낱개로 처리하므로 stored 값 자리를 확인한다.
      assert(cursor !== undefined);
      assert(Number(cursor["s"]) >= 0);
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

// Ask 값은 읽을 때 계기 표와 source 사실로 계산한다(platform/notifications#R13, R14).
const ASK_APP = "app_01arz3ndektsv4rrffq69g5fav";
const ASK_PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";
const ASK_RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";

async function seedAll(connection: Conn): Promise<void> {
  const sources = connection.sql.all(
    "select cast(seq as text) as seq, type from events order by seq",
    [],
  );
  for (const [index, source] of sources.entries()) {
    if (
      source["type"] === "ReleasePrepared"
    ) continue;
    const seeded = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: String(source["type"]),
        subject: "unused",
      },
      `ask-${index}`,
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
  }
}

function askSnapshot(connection: Conn) {
  return {
    sql: connection.sql,
    as_of_seq: "1",
    port() {
      throw new Error("port 없음");
    },
  };
}

Deno.test("platform/notifications#R13, R14 [agent-I18b]: 앱 문제 열림과 release 실패 행은 App Engineer ask를 싣고 그 밖의 계기는 null이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-ask-" });
  const connection = await schema(dir);
  try {
    emitSource(connection, "ProblemOpened", ASK_PROBLEM, {
      app: ASK_APP,
      group_key: "k",
      report: "rpt_01arz3ndektsv4rrffq69g5fav",
    });
    emitSource(connection, "ReleasePrepared", ASK_RELEASE, {
      app: ASK_APP,
      number: 3,
    });
    emitSource(connection, "ReleaseActivationFailed", ASK_RELEASE, {
      started_seq: "2",
      failure: { code: "x", summary: "y" },
    });
    emitSource(connection, "ProblemReopened", ASK_PROBLEM, {
      app: ASK_APP,
      report: "rpt_01arz3ndektsv4rrffq69g5fav",
    });
    emitSource(connection, "ProblemClosed", ASK_PROBLEM, {});
    emitSource(
      connection,
      "QuestionCreated",
      "qst_01arz3ndektsv4rrffq69g5fav",
      { run: "run_01arz3ndektsv4rrffq69g5fav", session: null },
    );
    await seedAll(connection);
    const list = notificationsListRead();
    const listed = list.handle(askSnapshot(connection), user(), {});
    assert(listed.ok, listed.ok ? "" : JSON.stringify(listed.error));
    const parsed = list.route.output.safeParse(listed.value);
    assert(parsed.success, JSON.stringify(parsed.error));
    const byEvent = new Map(
      parsed.data.notifications.map((row) => [row.source_event, row]),
    );
    assertEquals(byEvent.get("ProblemOpened")?.ask, {
      role: "app_engineer",
      agent_name: "App Engineer",
      first_context: {
        work_place: { kind: "app", id: ASK_APP },
        target: { kind: "problem", id: ASK_PROBLEM },
      },
    });
    // release 사건은 app이 payload에 없다: 그 release를 만든 사실에서 앱을 읽는다.
    assertEquals(byEvent.get("ReleaseActivationFailed")?.ask, {
      role: "app_engineer",
      agent_name: "App Engineer",
      first_context: {
        work_place: { kind: "app", id: ASK_APP },
        target: { kind: "release", id: ASK_RELEASE },
      },
    });
    for (
      const event of ["ProblemReopened", "ProblemClosed", "QuestionCreated"]
    ) {
      // 값이 있는 null이다: 키가 없는 것(다른 actor)과 다르다.
      const row = byEvent.get(event);
      assert(row !== undefined && "ask" in row, event);
      assertEquals(row.ask, null, event);
    }
    assertEquals(parsed.data.notifications.length, 5);

    // get도 같은 값을 낸다.
    const get = notificationsGetRead();
    const opened = byEvent.get("ProblemOpened")?.notification.id;
    assert(opened);
    const got = get.handle(askSnapshot(connection), user(), {
      notification: opened,
    });
    assert(got.ok, got.ok ? "" : JSON.stringify(got.error));
    const gotParsed = get.route.output.safeParse(got.value);
    assert(gotParsed.success);
    assertEquals(gotParsed.data.ask, byEvent.get("ProblemOpened")?.ask);
    assertEquals(
      Object.keys(gotParsed.data.ask ?? {}).sort(),
      ["agent_name", "first_context", "role"],
    );
    // 본문·payload 복사본은 ask에 없다.
    const text = JSON.stringify(gotParsed.data.ask);
    for (const forbidden of ["group_key", "report", "failure", "summary"]) {
      assert(!text.includes(forbidden), forbidden);
    }

    // 사람 줄이 아닌 actor에게는 ask 키도 없다.
    const hidden = list.handle(askSnapshot(connection), machine(), {});
    assert(hidden.ok);
    const hiddenParsed = list.route.output.safeParse(hidden.value);
    assert(hiddenParsed.success);
    for (const row of hiddenParsed.data.notifications) {
      assertEquals("ask" in row, false);
    }
    const machineGot = get.handle(askSnapshot(connection), machine(), {
      notification: opened,
    });
    assert(machineGot.ok);
    assertEquals("ask" in (machineGot.value as object), false);
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R14 [agent-I18b]: 대상 앱을 알 수 없으면 ask는 null이다 - 열 자리를 짐작하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-ask-none-" });
  const connection = await schema(dir);
  try {
    // payload에 앱이 없는 문제, release를 만든 사실이 없는 release 실패.
    emitSource(connection, "ProblemOpened", ASK_PROBLEM, {
      group_key: "k",
      report: "rpt_01arz3ndektsv4rrffq69g5fav",
    });
    emitSource(connection, "ReleaseActivationFailed", ASK_RELEASE, {
      started_seq: "2",
      failure: { code: "x", summary: "y" },
    });
    // 다른 release를 만든 사실은 이 release의 앱이 아니다.
    emitSource(
      connection,
      "ReleasePrepared",
      "rel_01arz3ndektsv4rrffq69g5fb0",
      { app: ASK_APP, number: 1 },
    );
    await seedAll(connection);
    const list = notificationsListRead();
    const listed = list.handle(askSnapshot(connection), user(), {});
    assert(listed.ok, listed.ok ? "" : JSON.stringify(listed.error));
    const parsed = list.route.output.safeParse(listed.value);
    assert(parsed.success, JSON.stringify(parsed.error));
    assertEquals(
      parsed.data.notifications.map((row) => [row.source_event, row.ask]),
      [["ProblemOpened", null], ["ReleaseActivationFailed", null]],
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});
