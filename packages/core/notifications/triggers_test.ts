// notification 계기 표의 각 source가 실제 등록 executor 경로에서 notification을
// 만드는지 본다(R1, R2). approval 요청은 실제 생성 작업이 낸 event부터, 나머지는
// source event를 직접 적어 source 사실부터 notification 생성까지 잇는다.

import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  fingerprint,
  type LophnError,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  RequestContext,
} from "../../protocol/server/mod.ts";
import {
  type ApprovalAction,
  approvalBinding,
  type ApprovalEffectInput,
} from "../../protocol/approvals/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import {
  APPROVAL_SCHEMA_STEPS,
  createApprovalCommands,
} from "../approvals/mod.ts";
import { effectText } from "../approvals/testing/mod.ts";
import {
  createSubscriberGate,
  LEDGER_COMMANDS,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../storage/ledger/mod.ts";
import { openEventsBackend } from "../events/testing/mod.ts";
import {
  questionCreated,
  runFinished,
} from "../../protocol/lophn-agent/mod.ts";
import { releaseActivationFailed } from "../../protocol/apps/mod.ts";
import { contextViolationsRecordedEvent } from "../../protocol/projects/mod.ts";
import {
  ticketCheckFailed,
  ticketConfirmed,
} from "../../protocol/coding-agent/mod.ts";
import { problemOpened } from "../../protocol/problems/mod.ts";
import {
  createNotificationCommand,
  NOTIFICATION_SUBSCRIBER,
} from "./commands.ts";
import { triggerOf } from "./model.ts";
import { notificationsEngine } from "./engine.ts";
import { NOTIFICATIONS_SCHEMA_STEPS } from "./schema.ts";
const NOW = Date.parse("2026-10-04T00:00:00.000Z");
const NOW_TEXT = "2026-10-04T00:00:00.000Z";

// notification 생성과 cursor 전진, approval 요청을 같은 machine 자격이 낸다.
function machine(): AuthenticatedContext {
  return {
    principal: "machine-1",
    actor: "machine",
    scope: {
      operations: [
        "create_approval_request",
        "create_notification",
        "AdvanceSubscriberCursor",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-m",
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

// 등록 executor 경로의 TxDeps. subscriberGate는 자기 구독자만 cursor를 올린다.
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

// approval 표를 같이 만든다. created_seq가 events를 참조하므로 ledger 뒤에 둔다.
async function approvalSchema(dir: string): Promise<Conn> {
  const path = `${dir}/ledger.db`;
  const applied = await applyMigrations(
    path,
    [
      ...LEDGER_SCHEMA_STEPS,
      ...APPROVAL_SCHEMA_STEPS,
      ...NOTIFICATIONS_SCHEMA_STEPS,
    ],
    { clock: manualClock(NOW) },
  );
  assert(applied.ok, "migration");
  const opened = openConnection(path);
  assert(opened.ok, "open");
  return opened.value;
}

// source event를 직접 적는다. problems의 발생 작업은 다른 최상위 package라
// 여기서 직접 부르지 못한다.
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

// 등록 executor 봉투. engine과 같이 input의 processed_through_seq는 이 event의
// seq(처리 뒤 cursor 위치)이고, compare의 processed_through_seq는 낸 시점에
// 기록된 cursor(CAS)다.
function createEnvelope(
  source: { seq: string; type: string },
  compareThrough: string,
  key: string,
) {
  return {
    command: "create_notification",
    input: {
      id: `ntf_${source.seq.padStart(26, "0").slice(-26)}`,
      source_seq: source.seq,
      source_event: source.type,
      processed_through_seq: source.seq,
      subscriber: NOTIFICATION_SUBSCRIBER,
    },
    idempotency_key: key,
    compare: { processed_through_seq: compareThrough },
    prepared: [] as string[],
  };
}

// contracts의 cursor CAS는 subscriber를 input에서 읽는다. compare는 현재 기록된
// cursor와 같아야 conflict가 나지 않는다.
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
  const compareThrough = storedCursor(connection);
  return runCommand(
    connection,
    { ...ledgerDeps(), checkCredential: () => ok(machine()) },
    [createNotificationCommand],
    machine(),
    createEnvelope(source, compareThrough, key),
  );
}

function notificationCount(connection: Conn): bigint {
  const rows = connection.sql.get(
    "select count(*) as n from notifications",
    [],
  );
  return BigInt(String(rows?.["n"] ?? "0"));
}

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fdw1";

// requests_fixture_test.ts와 같은 action·effect다. machine 자격의 요청이다.
async function approvalAction(): Promise<ApprovalAction> {
  const draft = {
    concern: "apps/invocations",
    command: "record_started",
    caller: `app:${APP}` as const,
    targets: [APP],
    input: {
      kind: "inline" as const,
      value: { release: RELEASE },
    },
    input_hash: "ab".repeat(32),
    comparison: { release: RELEASE },
  };
  return {
    ...draft,
    binding_hash: await fingerprint(
      approvalBinding({ ...draft, binding_hash: "ab".repeat(32) }),
    ),
  };
}

function approvalEffect(): ApprovalEffectInput {
  return effectText({
    changes: "release 하나를 시작한다",
    reversibility: "시작한 뒤에는 되돌리지 못한다",
  });
}

Deno.test("platform/notifications#R1: approval request 생성은 항상 notification을 만든다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-trigger-apr-" });
  const connection = await approvalSchema(dir);
  try {
    // 실제 approval 생성 경로가 ApprovalRequestCreated를 낸다(source 발생부터).
    const approvals = createApprovalCommands();
    const requested = await runCommand(
      connection,
      {
        ...ledgerDeps(),
        // 설명 글의 영구 참조는 같은 transaction의 실제 blob_refs 표에 넣는다.
        registerBlobRef: (reference) => {
          assert(reference.source.kind === "prepared");
          const blob = reference.source.blob;
          connection.sql.run(
            `insert into blob_refs (owner_kind, owner_key, field, hash,
               size_bytes, registered_seq) values (?, ?, ?, ?, ?, ?)`,
            [
              reference.owner_kind,
              reference.owner_key,
              reference.field,
              blob.hash,
              blob.size_bytes,
              BigInt(reference.registered_seq),
            ],
          );
          return ok({
            owner_kind: reference.owner_kind,
            owner_key: reference.owner_key,
            field: reference.field,
            hash: blob.hash,
            registered_seq: reference.registered_seq,
          });
        },
      },
      [approvals.create, createNotificationCommand],
      machine(),
      {
        command: "create_approval_request",
        input: {
          id: APPROVAL,
          requester: machine().actor,
          run: null,
          reason: "배포 전 확인이 필요하다",
          effect: approvalEffect(),
          action: await approvalAction(),
          expires_at: null,
        },
        idempotency_key: "create-apr-trigger",
        compare: {},
        prepared: [] as string[],
      },
    );
    assert(requested.ok, requested.ok ? "" : JSON.stringify(requested.error));
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events where type = 'ApprovalRequestCreated'",
      [],
    );
    assert(source);
    const seeded = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "ApprovalRequestCreated",
        subject: APPROVAL,
      },
      "create-apr-ntf",
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
    assertEquals(notificationCount(connection), 1n);
    assertEquals(
      connection.sql.get(
        "select count(*) as n from events where type = 'NotificationCreated'",
        [],
      )?.n,
      1n,
    );
    // 등록 executor는 두 command의 결과를 command_results에 남긴다.
    assertEquals(
      connection.sql.get(
        "select count(*) as n from command_results",
        [],
      )?.n,
      2n,
    );
    assertEquals(storedCursor(connection), String(source["seq"]));
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R1: question 생성은 항상 notification을 만든다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-trigger-qst-" });
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
      "select cast(seq as text) as seq from events where type = 'QuestionCreated'",
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
      "create-qst-ntf",
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
    assertEquals(notificationCount(connection), 1n);
    assertEquals(
      connection.sql.get(
        "select count(*) as n from events where type = 'NotificationCreated'",
        [],
      )?.n,
      1n,
    );
    assertEquals(storedCursor(connection), String(source["seq"]));
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R1: machine이 멈춘 assignment만 계기다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-trigger-asg-" });
  const connection = await schema(dir);
  try {
    // 대상 보관으로 machine이 멈춘다.
    emitSource(
      connection,
      "AssignmentPaused",
      "asg_01arz3ndektsv4rrffq69g5fbv",
      {
        revision: 1,
        previous_revision: 0,
        reason: {
          kind: "scope_archived",
          detail: "앱을 보관했다",
          runs: [],
          target: APP,
        },
        definition_hash: "a".repeat(64),
      },
    );
    // 사람이 직접 멈춘 것은 계기가 아니다.
    emitSource(
      connection,
      "AssignmentPaused",
      "asg_01arz3ndektsv4rrffq69g5fdv",
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
    const rows = connection.sql.all(
      "select cast(seq as text) as seq from events where type = 'AssignmentPaused' order by seq",
      [],
    );
    assertEquals(rows.length, 2);
    for (const row of rows.slice(0, 1)) {
      const seeded = await seedNotification(
        connection,
        {
          seq: String(row["seq"]),
          type: "AssignmentPaused",
          subject: "asg_01arz3ndektsv4rrffq69g5fav",
        },
        `create-asg-${row["seq"]}`,
      );
      assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
    }
    const rejected = await seedNotification(
      connection,
      {
        seq: String(rows[1]["seq"]),
        type: "AssignmentPaused",
        subject: "asg_01arz3ndektsv4rrffq69g5fdv",
      },
      "create-asg-user",
    );
    assert(!rejected.ok);
    if (!rejected.ok) assertEquals(rejected.error.code, "forbidden");
    assertEquals(notificationCount(connection), 1n);
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R2: handoff 종료와 run 종료는 notification을 만들지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-trigger-end-" });
  const connection = await schema(dir);
  try {
    assertEquals(triggerOf("RunFinished"), undefined);
    assertEquals(triggerOf("HandoffFinished"), undefined);
    // 계기 표 밖의 종료 event를 둔다. handoff 종료 event는 contract에 아직 없다.
    emitSource(
      connection,
      "RunFinished",
      "run_01arz3ndektsv4rrffq69g5fav",
      { outcome: "ok" },
    );
    emitSource(
      connection,
      "HandoffFinished",
      "hnd_01arz3ndektsv4rrffq69g5fav",
      {},
    );
    const rows = connection.sql.all(
      "select cast(seq as text) as seq, type from events order by seq",
      [],
    );
    assertEquals(rows.length, 2);
    for (const row of rows) {
      const rejected = await runCommand(
        connection,
        { ...ledgerDeps(), checkCredential: () => ok(machine()) },
        [createNotificationCommand],
        machine(),
        createEnvelope(
          { seq: String(row["seq"]), type: String(row["type"]) },
          storedCursor(connection),
          `create-end-${row["seq"]}`,
        ),
      );
      assert(!rejected.ok, JSON.stringify(rejected));
      if (!rejected.ok) assertEquals(rejected.error.code, "invalid_input");
    }
    assertEquals(notificationCount(connection), 0n);
    assertEquals(storedCursor(connection), "0");
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R1: 운영 보고 문제의 열림·닫힘·재발은 계기다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-trigger-prb-" });
  const connection = await schema(dir);
  try {
    const closure = {
      reason: "verified",
      basis_seq: "1",
      release: RELEASE,
      verification: "vrf_01arz3ndektsv4rrffq69g5fav",
      confirmation: null,
      last_report: null,
      note: null,
    };
    emitSource(
      connection,
      "ProblemOpened",
      "prb_01arz3ndektsv4rrffq69g5fav",
      {
        app: APP,
        group_key: {
          kind: "declared",
          code: "api_timeout",
          discriminator: null,
        },
        report: "rpt_01arz3ndektsv4rrffq69g5fav",
      },
    );
    emitSource(
      connection,
      "ProblemClosed",
      "prb_01arz3ndektsv4rrffq69g5fav",
      { previous_status: "open", closure },
    );
    emitSource(
      connection,
      "ProblemReopened",
      "prb_01arz3ndektsv4rrffq69g5fav",
      {
        previous: closure,
        report: "rpt_01arz3ndektsv4rrffq69g5fbv",
        decision: null,
      },
    );
    const rows = connection.sql.all(
      "select cast(seq as text) as seq, type from events order by seq",
      [],
    );
    assertEquals(rows.map((row) => row["type"]), [
      "ProblemOpened",
      "ProblemClosed",
      "ProblemReopened",
    ]);
    for (const row of rows) {
      const seeded = await seedNotification(
        connection,
        {
          seq: String(row["seq"]),
          type: String(row["type"]),
          subject: "prb_01arz3ndektsv4rrffq69g5fav",
        },
        `create-prb-${row["seq"]}`,
      );
      assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
    }
    assertEquals(notificationCount(connection), 3n);
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R2: 추가 report는 notification을 만들지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-trigger-rpt-" });
  const connection = await schema(dir);
  try {
    assertEquals(triggerOf("ReportRecorded"), undefined);
    assertEquals(triggerOf("ProblemObserved"), undefined);
    emitSource(
      connection,
      "ProblemOpened",
      "prb_01arz3ndektsv4rrffq69g5fav",
      {
        app: APP,
        group_key: {
          kind: "declared",
          code: "api_timeout",
          discriminator: null,
        },
        report: "rpt_01arz3ndektsv4rrffq69g5fav",
      },
    );
    // 같은 문제의 추가 report다. 계기 표 밖이다.
    emitSource(
      connection,
      "ReportRecorded",
      "rpt_01arz3ndektsv4rrffq69g5fbv",
      {
        app: APP,
        problem: "prb_01arz3ndektsv4rrffq69g5fav",
        source: "app",
        mode: "live",
        code: "api_timeout",
        snapshot: "snp_01arz3ndektsv4rrffq69g5fav",
        observed_at: NOW_TEXT,
        content_hash: "ab".repeat(32),
      },
    );
    const rows = connection.sql.all(
      "select cast(seq as text) as seq, type from events order by seq",
      [],
    );
    assertEquals(rows.length, 2);
    // report는 input schema가 거른다.
    const rejected = await runCommand(
      connection,
      { ...ledgerDeps(), checkCredential: () => ok(machine()) },
      [createNotificationCommand],
      machine(),
      createEnvelope(
        { seq: String(rows[1]["seq"]), type: "ReportRecorded" },
        storedCursor(connection),
        "create-rpt-ntf",
      ),
    );
    assert(!rejected.ok, JSON.stringify(rejected));
    if (!rejected.ok) assertEquals(rejected.error.code, "invalid_input");
    assertEquals(notificationCount(connection), 0n);
    // 문제 열림만 만든다.
    const created = await seedNotification(
      connection,
      {
        seq: String(rows[0]["seq"]),
        type: "ProblemOpened",
        subject: "prb_01arz3ndektsv4rrffq69g5fav",
      },
      "create-prb-ntf",
    );
    assert(created.ok, created.ok ? "" : JSON.stringify(created.error));
    assertEquals(notificationCount(connection), 1n);
    // cursor는 report event까지 전진한다. notification은 늘지 않는다.
    const reportSeq = String(rows[1]["seq"]);
    const advanced = await runCommand(
      connection,
      { ...ledgerDeps(), checkCredential: () => ok(machine()) },
      LEDGER_COMMANDS,
      machine(),
      {
        command: "AdvanceSubscriberCursor",
        input: {
          subscriber: NOTIFICATION_SUBSCRIBER,
          scanned_through_seq: reportSeq,
        },
        idempotency_key: "cursor-rpt",
        compare: { processed_through_seq: storedCursor(connection) },
        prepared: [] as string[],
      },
    );
    assert(advanced.ok, advanced.ok ? "" : JSON.stringify(advanced.error));
    assertEquals(storedCursor(connection), reportSeq);
    assertEquals(notificationCount(connection), 1n);
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// engine이 읽는 event 통로. ledger.db reader 연결의 ListEvents다. trigger event와
// 계기 아닌 event를 모두 등록한다: 등록하지 않은 event는 batch에서 빠진다(생략
// 금지, R11).
function notificationEventsRead(
  path: string,
): {
  reader: { close(): void };
  backend: Parameters<typeof notificationsEngine>[0]["backend"];
} {
  const fixture = openEventsBackend(
    path,
    [
      questionCreated,
      problemOpened,
      runFinished,
      ticketConfirmed,
      ticketCheckFailed,
      releaseActivationFailed,
      contextViolationsRecordedEvent,
    ],
    [
      { event: questionCreated, handle: () => ok(true) },
      { event: problemOpened, handle: () => ok(true) },
      { event: runFinished, handle: () => ok(true) },
      { event: ticketConfirmed, handle: () => ok(true) },
      { event: ticketCheckFailed, handle: () => ok(true) },
      { event: releaseActivationFailed, handle: () => ok(true) },
      { event: contextViolationsRecordedEvent, handle: () => ok(true) },
    ],
    () => ok(machine()),
  );
  assert(
    fixture.ok,
    fixture.ok ? "reader 연결" : JSON.stringify(fixture.error),
  );
  return {
    reader: fixture.value,
    backend: fixture.value.backend as Parameters<
      typeof notificationsEngine
    >[0]["backend"],
  };
}

// engine의 command 통로. create_notification과 cursor 전진을 등록 executor로 낸다.
function engineCommand(connection: Conn): (
  ctx: RequestContext,
  envelope: {
    command: string;
    input: unknown;
    idempotency_key: string;
    compare: unknown;
    prepared: readonly string[];
  },
) => Promise<Result<unknown>> {
  return async (_ctx, envelope) => {
    const commands = envelope.command === "create_notification"
      ? [createNotificationCommand]
      : LEDGER_COMMANDS;
    const result = await runCommand(
      connection,
      { ...ledgerDeps(), checkCredential: () => ok(machine()) },
      commands,
      machine(),
      envelope as Parameters<typeof runCommand>[4],
    );
    if (!result.ok) return result;
    return ok({ result: (result.value as { result: unknown }).result });
  };
}

Deno.test("platform/notifications#R1, R11: engine step은 계기와 계기 아님을 섞은 batch에서 실제 생성으로 notification을 만들고 cursor는 끝까지 움직인다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-engine-" });
  const connection = await schema(dir);
  const { path } = { path: `${dir}/ledger.db` };
  const { reader, backend } = notificationEventsRead(path);
  try {
    // trigger 2개(질문, 문제)와 계기 아닌 event 1개(RunFinished)를 남긴다.
    emitSource(
      connection,
      "QuestionCreated",
      "qgr_01arz3ndektsv4rrffq69g5fav",
      {
        run: "run_01arz3ndektsv4rrffq69g5fav",
        session: null,
        questions: [{ id: "qst_01arz3ndektsv4rrffq69g5fav" }],
      },
    );
    emitSource(
      connection,
      "ProblemOpened",
      "prb_01arz3ndektsv4rrffq69g5fav",
      {
        app: APP,
        group_key: {
          kind: "declared",
          code: "api_timeout",
          discriminator: null,
        },
        report: "rpt_01arz3ndektsv4rrffq69g5fav",
      },
    );
    emitSource(
      connection,
      "RunFinished",
      "run_01arz3ndektsv4rrffq69g5fbv",
      {
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        started: true,
        started_at: NOW_TEXT,
        outcome: { kind: "completed", reason: "answer_completed" },
        result: "0".repeat(64),
        finished_at: NOW_TEXT,
      } as unknown as Record<string, unknown>,
    );
    const head = connection.sql.get(
      "select cast(max(seq) as text) as seq from events",
      [],
    );
    assert(head);
    const engine = notificationsEngine({
      backend,
      command: engineCommand(connection),
      machine: machine(),
    });
    const scanned = await engine.step();
    assert(scanned.ok, scanned.ok ? "" : JSON.stringify(scanned.error));
    // cursor는 batch 끝 event까지 움직인다(engine의 step 결과와 같다).
    assertEquals(scanned.value, String(head["seq"]));
    assertEquals(storedCursor(connection), String(head["seq"]));
    // 계기 둘만 notification이고, 계기 아닌 run 종료는 만들지 않는다(R2).
    assertEquals(notificationCount(connection), 2n);
    const listed = connection.sql.all(
      `select e.type as type from notifications n
       join events e on e.seq = n.source_seq order by n.source_seq`,
      [],
    );
    assertEquals(listed.map((row) => row["type"]), [
      "QuestionCreated",
      "ProblemOpened",
    ]);
    await engine.close();
  } finally {
    reader.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R2: engine step은 조건 밖 계기(사람이 멈춘 assignment)에서 멈추지 않고 cursor를 올려 뒤 계기를 만든다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-engine-cond-" });
  const connection = await schema(dir);
  const { reader, backend } = notificationEventsRead(`${dir}/ledger.db`);
  try {
    emitSource(
      connection,
      "AssignmentPaused",
      "asg_01arz3ndektsv4rrffq69g5fav",
      {
        before: 1,
        after: 2,
        reason: { kind: "user", detail: "잠시 멈춤", runs: [], target: null },
        definition_hash: "0".repeat(64),
      },
    );
    emitSource(
      connection,
      "QuestionCreated",
      "qgr_01arz3ndektsv4rrffq69g5fav",
      {
        run: "run_01arz3ndektsv4rrffq69g5fav",
        session: null,
        questions: [{ id: "qst_01arz3ndektsv4rrffq69g5fav" }],
      },
    );
    const engine = notificationsEngine({
      backend,
      command: engineCommand(connection),
      machine: machine(),
    });
    const scanned = await engine.step();
    assert(scanned.ok, scanned.ok ? "" : JSON.stringify(scanned.error));
    // cursor는 뒤 계기(QuestionCreated, seq 2)까지 움직인다. 생성이 낸 NotificationCreated는 그 뒤다.
    assertEquals(scanned.value, "2");
    assertEquals(storedCursor(connection), "2");
    const listed = connection.sql.all(
      `select e.type as type from notifications n
       join events e on e.seq = n.source_seq order by n.source_seq`,
      [],
    );
    assertEquals(listed.map((row) => row["type"]), ["QuestionCreated"]);
    await engine.close();
  } finally {
    reader.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R11: engine step이 중간에 멈추면 다음 step은 멈춘 위치부터 다시 읽는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-engine-stop-" });
  const connection = await schema(dir);
  const { path } = { path: `${dir}/ledger.db` };
  const { reader, backend } = notificationEventsRead(path);
  try {
    emitSource(
      connection,
      "QuestionCreated",
      "qgr_01arz3ndektsv4rrffq69g5fav",
      {
        run: "run_01arz3ndektsv4rrffq69g5fav",
        session: null,
        questions: [{ id: "qst_01arz3ndektsv4rrffq69g5fav" }],
      },
    );
    emitSource(
      connection,
      "ProblemOpened",
      "prb_01arz3ndektsv4rrffq69g5fav",
      {
        app: APP,
        group_key: {
          kind: "declared",
          code: "api_timeout",
          discriminator: null,
        },
        report: "rpt_01arz3ndektsv4rrffq69g5fav",
      },
    );
    // engine 조립: command가 첫 create_notification에서 실제한다.
    let failures = 0;
    const stoppedCommand: Parameters<typeof notificationsEngine>[0]["command"] =
      (_ctx, envelope) => {
        if (envelope.command === "create_notification" && failures === 0) {
          failures++;
          return Promise.resolve(
            err({ code: "unavailable", message: "실패 중" }),
          );
        }
        return engineCommand(connection)(_ctx, envelope);
      };
    const engine = notificationsEngine({
      backend,
      command: stoppedCommand,
      machine: machine(),
    });
    const stopped = await engine.step();
    assert(!stopped.ok, "첫 create에서 실패했다");
    if (!stopped.ok) assertEquals(stopped.error.code, "unavailable");
    // 멈춘 위치: notification은 없고 cursor도 0이다. rollback은 transaction 내부에서 일어난다.
    assertEquals(notificationCount(connection), 0n);
    assertEquals(storedCursor(connection), "0");
    // 다음 step은 같은 cursor부터 다시 읽어 둘 다 만든다. head는 step 앞에 잰다:
    // step이 낸 NotificationCreated event가 max(seq)에 섞인다.
    const head = connection.sql.get(
      "select cast(max(seq) as text) as seq from events",
      [],
    );
    assert(head);
    const resumed = await engine.step();
    assert(resumed.ok, resumed.ok ? "" : JSON.stringify(resumed.error));
    assertEquals(storedCursor(connection), String(head["seq"]));
    assertEquals(notificationCount(connection), 2n);
    // 중간 stop이 replayable하다: 두 event 모두 notification이 됐다.
    const listed = connection.sql.all(
      `select e.type as type from notifications n
       join events e on e.seq = n.source_seq order by n.source_seq`,
      [],
    );
    assertEquals(listed.map((row) => row["type"]), [
      "QuestionCreated",
      "ProblemOpened",
    ]);
    await engine.close();
  } finally {
    reader.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R1, R11: engine step은 ticket·release 계기를 실제 생성으로 만든다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-engine-more-" });
  const connection = await schema(dir);
  const { path } = { path: `${dir}/ledger.db` };
  const { reader, backend } = notificationEventsRead(path);
  try {
    emitSource(
      connection,
      "TicketConfirmed",
      "tkt_01arz3ndektsv4rrffq69g5fav",
      {
        app: APP,
        problems: [],
        completion_seq: "1",
        release: RELEASE,
        fix_records: [],
      },
    );
    emitSource(
      connection,
      "TicketCheckFailed",
      "tkt_01arz3ndektsv4rrffq69g5faw",
      {
        app: APP,
        problems: [],
        completion_seq: "1",
        release: RELEASE,
        fix_records: [],
        failed_conditions: [3],
      },
    );
    emitSource(
      connection,
      "ReleaseActivationFailed",
      "rel_01arz3ndektsv4rrffq69g5fav",
      {
        started_seq: "1",
        failure: {
          code: "handler_mismatch",
          summary: "handler·hash가 준비와 다르다",
        },
        invocation: "inv_01arz3ndektsv4rrffq69g5fav",
      },
    );
    const head = connection.sql.get(
      "select cast(max(seq) as text) as seq from events",
      [],
    );
    assert(head);
    const engine = notificationsEngine({
      backend,
      command: engineCommand(connection),
      machine: machine(),
    });
    const scanned = await engine.step();
    assert(scanned.ok, scanned.ok ? "" : JSON.stringify(scanned.error));
    // cursor는 batch 끝 event까지 움직이고, 세 계기 모두 notification이 된다.
    assertEquals(scanned.value, String(head["seq"]));
    assertEquals(storedCursor(connection), String(head["seq"]));
    assertEquals(notificationCount(connection), 3n);
    const listed = connection.sql.all(
      `select e.type as type from notifications n
       join events e on e.seq = n.source_seq order by n.source_seq`,
      [],
    );
    assertEquals(listed.map((row) => row["type"]), [
      "TicketConfirmed",
      "TicketCheckFailed",
      "ReleaseActivationFailed",
    ]);
    await engine.close();
  } finally {
    reader.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// T33: release activation 실패는 항상 계기다(R1). fail_activation의 발생 작업
// (apps T18)은 아직 없으므로 source event를 직접 적는다(남은 것).
Deno.test("platform/notifications#R1: release activation 실패는 항상 notification을 만든다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-trigger-rel-" });
  const connection = await schema(dir);
  try {
    emitSource(
      connection,
      "ReleaseActivationFailed",
      "rel_01arz3ndektsv4rrffq69g5fav",
      {
        started_seq: "1",
        failure: {
          code: "handler_mismatch",
          summary: "handler·hash가 준비와 다르다",
        },
        invocation: "inv_01arz3ndektsv4rrffq69g5fav",
      },
    );
    const source = connection.sql.get(
      "select cast(seq as text) as seq from events where type = 'ReleaseActivationFailed'",
      [],
    );
    assert(source);
    const seeded = await seedNotification(
      connection,
      {
        seq: String(source["seq"]),
        type: "ReleaseActivationFailed",
        subject: "rel_01arz3ndektsv4rrffq69g5fav",
      },
      "create-rel-ntf",
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
    assertEquals(notificationCount(connection), 1n);
    assertEquals(
      connection.sql.get(
        "select count(*) as n from events where type = 'NotificationCreated'",
        [],
      )?.n,
      1n,
    );
    assertEquals(storedCursor(connection), String(source["seq"]));
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// T36: ticket 확인 완료·검사 실패는 항상 계기다(R1). claim·완료 보고 등
// 비계기는 만들지 않는다(R2). checker의 발생 작업(coding-agent T26)은 아직
// 없으므로 source event를 직접 적는다(남은 것).
Deno.test("platform/notifications#R1, R2: ticket 확인 완료·검사 실패만 계기다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-trigger-tkt-" });
  const connection = await schema(dir);
  try {
    const appFields = {
      app: "app_01arz3ndektsv4rrffq69g5fav",
      problems: [] as string[],
    };
    const completionFields = {
      ...appFields,
      completion_seq: "1",
      release: "rel_01arz3ndektsv4rrffq69g5fav",
      fix_records: [] as string[],
    };
    // 확인 완료는 계기다.
    emitSource(
      connection,
      "TicketConfirmed",
      "tkt_01arz3ndektsv4rrffq69g5fav",
      completionFields,
    );
    // 검사 실패는 계기다.
    emitSource(
      connection,
      "TicketCheckFailed",
      "tkt_01arz3ndektsv4rrffq69g5faw",
      { ...completionFields, failed_conditions: [3] },
    );
    // claim과 완료 보고는 계기가 아니다(R2). 계기 표 밖이다.
    emitSource(
      connection,
      "TicketClaimed",
      "tkt_01arz3ndektsv4rrffq69g5fav",
      {
        ...appFields,
        connection: "cac_01arz3ndektsv4rrffq69g5fav",
        claim_seq: "1",
        expires_at: NOW_TEXT,
      },
    );
    emitSource(
      connection,
      "TicketCompletionReported",
      "tkt_01arz3ndektsv4rrffq69g5fav",
      {
        ...completionFields,
        claim_seq: "1",
        summary_hash: "ab".repeat(32),
        outputs: [] as string[],
        verifications: [] as string[],
      },
    );
    const confirmed = connection.sql.get(
      "select cast(seq as text) as seq from events where type = 'TicketConfirmed'",
      [],
    );
    assert(confirmed);
    const checkFailed = connection.sql.get(
      "select cast(seq as text) as seq from events where type = 'TicketCheckFailed'",
      [],
    );
    assert(checkFailed);
    // 비계기 event만 모은다. seedNotification이 내는 NotificationCreated는 제외하려
    // seeding 앞에 잰다.
    const rows = connection.sql.all(
      "select cast(seq as text) as seq, type from events order by seq",
      [],
    );
    assertEquals(rows.length, 4);
    const seededConfirmed = await seedNotification(
      connection,
      {
        seq: String(confirmed["seq"]),
        type: "TicketConfirmed",
        subject: "tkt_01arz3ndektsv4rrffq69g5fav",
      },
      "create-tkt-confirmed",
    );
    assert(
      seededConfirmed.ok,
      seededConfirmed.ok ? "" : JSON.stringify(seededConfirmed.error),
    );
    const seededFailed = await seedNotification(
      connection,
      {
        seq: String(checkFailed["seq"]),
        type: "TicketCheckFailed",
        subject: "tkt_01arz3ndektsv4rrffq69g5faw",
      },
      "create-tkt-failed",
    );
    assert(
      seededFailed.ok,
      seededFailed.ok ? "" : JSON.stringify(seededFailed.error),
    );
    assertEquals(notificationCount(connection), 2n);
    // claim·완료 보고는 등록 executor가 input schema로 거른다. 계기 표 밖이다.
    assertEquals(triggerOf("TicketClaimed"), undefined);
    assertEquals(triggerOf("TicketCompletionReported"), undefined);
    for (const row of rows) {
      if (
        String(row["type"]) !== "TicketConfirmed" &&
        String(row["type"]) !== "TicketCheckFailed"
      ) {
        const rejected = await runCommand(
          connection,
          { ...ledgerDeps(), checkCredential: () => ok(machine()) },
          [createNotificationCommand],
          machine(),
          createEnvelope(
            { seq: String(row["seq"]), type: String(row["type"]) },
            storedCursor(connection),
            `create-tkt-${row["seq"]}`,
          ),
        );
        assert(!rejected.ok, JSON.stringify(rejected));
        if (!rejected.ok) assertEquals(rejected.error.code, "invalid_input");
      }
    }
    assertEquals(notificationCount(connection), 2n);
    assertEquals(storedCursor(connection), String(checkFailed["seq"]));
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

const QUESTION = "qgr_01arz3ndektsv4rrffq69g5fav";
const QUESTION_TWO = "qgr_01arz3ndektsv4rrffq69g5fb0";

Deno.test("platform/notifications#R1, R11: batch가 작아도 cursor 바로 뒤 계기 event를 건너뛰지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-engine-small-" });
  const connection = await schema(dir);
  const { reader, backend } = notificationEventsRead(`${dir}/ledger.db`);
  try {
    emitSource(connection, "QuestionCreated", QUESTION, {
      run: "run_01arz3ndektsv4rrffq69g5fav",
      session: null,
      questions: [{ id: "qst_01arz3ndektsv4rrffq69g5fav" }],
    });
    emitSource(connection, "QuestionCreated", QUESTION_TWO, {
      run: "run_01arz3ndektsv4rrffq69g5fav",
      session: null,
      questions: [{ id: "qst_01arz3ndektsv4rrffq69g5fb0" }],
    });
    const engine = notificationsEngine({
      backend,
      command: engineCommand(connection),
      machine: machine(),
      batch: 1,
      // 실제 core처럼 기록된 cursor에서 다시 시작한다.
      cursor: () => Promise.resolve(storedCursor(connection)),
    });
    for (let step = 0; step < 4; step++) {
      const stepped = await engine.step();
      assert(stepped.ok, stepped.ok ? "" : JSON.stringify(stepped.error));
    }
    const listed = connection.sql.all(
      `select e.subject as subject from notifications n
       join events e on e.seq = n.source_seq order by n.source_seq`,
      [],
    );
    assertEquals(listed.map((row) => row["subject"]), [QUESTION, QUESTION_TWO]);
    await engine.close();
  } finally {
    reader.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/notifications#R2: 공개 정책이 숨긴 event만 있는 구간도 cursor를 올리고 뒤 계기를 놓치지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ntf-engine-hidden-" });
  const connection = await schema(dir);
  const { reader, backend } = notificationEventsRead(`${dir}/ledger.db`);
  try {
    // 등록되지 않은 type은 batch에서 숨는다. 이 구간에 계기가 없다.
    emitSource(
      connection,
      "DocumentSaved",
      "doc_01arz3ndektsv4rrffq69g5fav",
      {},
    );
    emitSource(
      connection,
      "DocumentSaved",
      "doc_01arz3ndektsv4rrffq69g5fb0",
      {},
    );
    const hiddenHead = connection.sql.get(
      "select cast(max(seq) as text) as seq from events",
      [],
    );
    assert(hiddenHead);
    const engine = notificationsEngine({
      backend,
      command: engineCommand(connection),
      machine: machine(),
      cursor: () => Promise.resolve(storedCursor(connection)),
    });
    const first = await engine.step();
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    assertEquals(storedCursor(connection), String(hiddenHead["seq"]));
    assertEquals(notificationCount(connection), 0n);
    emitSource(connection, "QuestionCreated", QUESTION, {
      run: "run_01arz3ndektsv4rrffq69g5fav",
      session: null,
      questions: [{ id: "qst_01arz3ndektsv4rrffq69g5fav" }],
    });
    const second = await engine.step();
    assert(second.ok, second.ok ? "" : JSON.stringify(second.error));
    assertEquals(notificationCount(connection), 1n);
    await engine.close();
  } finally {
    reader.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// ctx-I35: context 위반 수는 직전 기록보다 늘었을 때만 계기다. 줄거나 같으면 계기 아니다.
// 첫 기록의 before는 0이다(violation_mark의 생성 값).
const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";
const BUNDLE_HASH = "c".repeat(64);

async function violationsNotifications(
  prefix: string,
  counts: readonly (readonly [number, number])[],
): Promise<string[]> {
  const dir = await Deno.makeTempDir({ prefix });
  const connection = await schema(dir);
  const { reader, backend } = notificationEventsRead(`${dir}/ledger.db`);
  try {
    for (const [before, after] of counts) {
      emitSource(connection, "ContextViolationsRecorded", CTX, {
        before,
        after,
        bundle_hash: BUNDLE_HASH,
      });
    }
    const engine = notificationsEngine({
      backend,
      command: engineCommand(connection),
      machine: machine(),
    });
    const scanned = await engine.step();
    assert(scanned.ok, scanned.ok ? "" : JSON.stringify(scanned.error));
    // 계기가 아닌 event도 읽고 지나가므로 cursor는 마지막 event까지 간다.
    assertEquals(storedCursor(connection), String(counts.length));
    const rows = connection.sql.all(
      `select e.payload as payload from notifications n
       join events e on e.seq = n.source_seq order by n.source_seq`,
      [],
    );
    await engine.close();
    return rows.map((row) => String(row["payload"]));
  } finally {
    reader.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("[ctx-I35] platform/notifications#R1: 위반 수가 늘면 기록 하나마다 notification 하나다", async () => {
  const made = await violationsNotifications("ntf-ctx-rise-", [[2, 5]]);
  assertEquals(made.length, 1);
  assertEquals(JSON.parse(made[0]).after, 5);
  // 같은 context에서 연이어 늘어도 기록마다 하나씩이다(덮어쓰지 않는다).
  assertEquals(
    (await violationsNotifications("ntf-ctx-rise2-", [[0, 1], [1, 2]])).length,
    2,
  );
});

Deno.test("[ctx-I35] platform/notifications#R2: 위반 수가 줄면 notification이 없다", async () => {
  assertEquals(
    await violationsNotifications("ntf-ctx-fall-", [[5, 1], [1, 0]]),
    [],
  );
});

Deno.test("[ctx-I35] platform/notifications#R2: 위반 수가 같으면 notification이 없다", async () => {
  assertEquals(
    await violationsNotifications("ntf-ctx-equal-", [[3, 3]]),
    [],
  );
});

Deno.test("[ctx-I35] platform/notifications#R1: 첫 기록(직전 0)이 0보다 크면 notification 하나다", async () => {
  assertEquals(
    (await violationsNotifications("ntf-ctx-first-", [[0, 2]])).length,
    1,
  );
  // 직전이 0이고 그대로 0이면 계기가 아니다.
  assertEquals(
    await violationsNotifications("ntf-ctx-first0-", [[0, 0]]),
    [],
  );
});
