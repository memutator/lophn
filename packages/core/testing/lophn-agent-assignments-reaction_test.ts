// lophn-agent/assignments#R1: AppCreated와 자리 보관·보관 해제 반응 engine. 구독자 gate가 있는 등록
// executor(applyMigrations + runCommand)를 direct connection으로 부르고, 반응 engine은
// reaction.ts의 실제 것을 쓴다. 제품 core 경로는 apps/core/assignment-reactions_test.ts가 본다. 구독자 gate를 만드는 direct connection이
// platform/ledger를 직접 부르므로 apps/core/testing/에 둔다(lophn-agent-assignments_test.ts와 같다).
import { assert, assertEquals } from "@std/assert";
import { err, type LophnError, manualClock, ok } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { ASSIGNMENT_SUBSCRIBER } from "../../protocol/lophn-agent/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import {
  createSubscriberGate,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../storage/ledger/mod.ts";
import { advanceSubscriberCursorCommand } from "../storage/ledger/commands.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../lophn-agent/assignments/mod.ts";
import {
  ASSIGNMENT_REACTION_OPERATIONS,
  assignmentEngine,
} from "../lophn-agent/assignments/reaction.ts";

const NOW = Date.UTC(2026, 0, 1);
const NOW_TEXT = "2026-01-01T00:00:00.000Z";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const PROJECT = "prj_01h455vb4pex5v6nkc6gd5fdw2";
const OPERATOR = "asg_01h455vb4pex5v6nkc6gd5fdw3";
const PRINCIPAL = "machine:lophn-agent-assignments";

async function open() {
  const dir = await Deno.makeTempDir({ prefix: "asg-r1-reaction-" });
  const path = `${dir}/ledger.db`;
  const clock = manualClock(NOW);
  const applied = await applyMigrations(
    path,
    [...LEDGER_SCHEMA_STEPS, ...assignmentSchemaSteps],
    { clock },
  );
  assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
  const opened = openConnection(path);
  assert(opened.ok, "open");
  const connection = opened.value;
  const gate = createSubscriberGate([{
    name: ASSIGNMENT_SUBSCRIBER,
    authorize: (ctx) => ok(ctx.principal === PRINCIPAL),
  }]);
  assert(gate.ok, "gate");
  const machine: AuthenticatedContext = {
    actor: "machine",
    principal: PRINCIPAL,
    credential_ref: PRINCIPAL,
    scope: {
      operations: [...ASSIGNMENT_REACTION_OPERATIONS],
      targets: {},
    },
    conditions: {},
  };
  const deps = {
    clock,
    ids: { newId: () => "doc_01arz3ndektsv4rrffq69g5fav" },
    ports: [],
    registerBlobRef: () =>
      err<LophnError>({ code: "unavailable", message: "blob 없음" }),
    call: () =>
      err<LophnError>({ code: "unavailable", message: "dispatch 없음" }),
    subscriberGate: gate.value,
    checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
  };
  const commands = createAssignmentCommands();
  const run = (
    command: string,
    input: unknown,
    key: string,
    compare: unknown = {},
  ) =>
    runCommand(
      connection,
      deps,
      [
        commands.createAppEngineer,
        commands.pause,
        commands.resume,
        advanceSubscriberCursorCommand,
      ],
      machine,
      { command, input, idempotency_key: key, compare, prepared: [] } as never,
    );
  const cursor = () => {
    const row = connection.sql.get(
      "select cast(processed_through_seq as text) as s from subscriber_cursors where subscriber = ?",
      [ASSIGNMENT_SUBSCRIBER],
    );
    return row === undefined ? "0" : String(row["s"]);
  };
  const emit = (type: string, subject: string) => {
    connection.sql.run(
      "insert into events (type, subject, actor, payload, at) values (?, ?, ?, ?, ?)",
      [type, subject, "user", JSON.stringify({}), NOW_TEXT],
    );
    return String(
      connection.sql.get("select max(seq) as seq from events", [])!["seq"],
    );
  };
  const engineer = () => {
    const row = connection.sql.get(
      "select id, revision, state from assignments where role = 'app_engineer' and scope_id = ? and state != 'withdrawn'",
      [APP],
    );
    return row === undefined ? null : {
      id: String(row["id"]),
      revision: Number(row["revision"]),
      state: String(row["state"]),
    };
  };
  // 자리에 놓인 거두지 않은 assignment다. 반응이 움직일 대상을 직접 읽는다.
  const placed = (place: string) =>
    connection.sql.all(
      "select id, revision, state from assignments where scope_id = ? and state != 'withdrawn' order by id",
      [place],
    ).map((row) => ({
      id: String(row["id"]),
      revision: Number(row["revision"]),
      state: String(row["state"]),
    }));
  const stateOf = (id: string) =>
    String(
      connection.sql.get("select state from assignments where id = ?", [id])![
        "state"
      ],
    );
  const engine = assignmentEngine({
    backend: {
      read: (_ctx, scan) => {
        const rows = connection.sql.all(
          "select seq, type, subject, payload from events where seq > ? order by seq asc limit ?",
          [BigInt(scan.position), scan.limit ?? 256],
        );
        const head = String(
          connection.sql.get(
            "select coalesce(max(seq), 0) as seq from events",
            [],
          )!["seq"],
        );
        return Promise.resolve(ok({
          events: rows.map((row) => ({
            seq: String(row["seq"]),
            type: String(row["type"]),
            subject: row["subject"] === null ? null : String(row["subject"]),
            actor: "user",
            run: null,
            payload: JSON.parse(String(row["payload"])),
            at: NOW_TEXT,
          })),
          scanned_through_seq: head,
          head_seq: head,
        } as never));
      },
    },
    command: (_ctx, envelope) =>
      run(
        envelope.command,
        envelope.input,
        envelope.idempotency_key,
        envelope.compare,
      ) as never,
    machine,
    cursor: () => Promise.resolve(cursor()),
    findAtPlace: (place) => Promise.resolve(ok(placed(place))),
  });
  return {
    connection,
    cursor,
    emit,
    engineer,
    engine,
    placed,
    stateOf,
    run,
    async close() {
      engine.close();
      connection.close();
      await Deno.remove(dir, { recursive: true });
    },
  };
}

function count(
  world: Awaited<ReturnType<typeof open>>,
  sql: string,
): bigint {
  return BigInt(String(world.connection.sql.get(sql, [])!["n"]));
}

Deno.test("lophn-agent/assignments#R1: AppCreated마다 거두지 않은 AE 하나가 assignment·event·cursor와 한 transaction으로 생기고 재전달에도 중복이 없다", async () => {
  const world = await open();
  try {
    const seq = world.emit("AppCreated", APP);
    const stepped = await world.engine.step();
    assert(stepped.ok, stepped.ok ? "" : JSON.stringify(stepped.error));
    // 반응(assignment 행·AssignmentCreated)과 cursor가 함께 확정됐다.
    const made = world.engineer();
    assert(made !== null);
    assertEquals(made.id, `asg_${seq.padStart(26, "0").slice(-26)}`);
    assertEquals(made.state, "enabled");
    assertEquals(world.cursor(), seq);
    assertEquals(
      count(
        world,
        "select count(*) as n from events where type = 'AssignmentCreated'",
      ),
      1n,
    );
    // 같은 event를 다시 읽어도(같은 반응 key) 같은 결과이고 둘째가 생기지 않는다.
    const again = await world.run("CreateAppEngineerAssignment", {
      id: made.id,
      app_created_seq: seq,
      app: APP,
    }, "other-key");
    assert(again.ok, again.ok ? "" : JSON.stringify(again.error));
    // 다른 id·다른 key로 같은 앱의 둘째 AE를 내면 거절이다.
    const second = await world.run("CreateAppEngineerAssignment", {
      id: "asg_00000000000000000000000099",
      app_created_seq: seq,
      app: APP,
    }, "second-key");
    assert(!second.ok);
    assertEquals(second.error.code, "conflict");
    assertEquals(count(world, "select count(*) as n from assignments"), 1n);
  } finally {
    await world.close();
  }
});

Deno.test("lophn-agent/assignments#R1 [agent-R12]: AppArchived pauses every enabled assignment of the app with its cursor, and AppUnarchived resumes them, a repeat does nothing", async () => {
  const world = await open();
  try {
    world.emit("AppCreated", APP);
    assert((await world.engine.step()).ok);
    const engineer = world.engineer()!;
    // 같은 앱의 Operator도 자리가 보관되면 멈춘다.
    world.connection.sql.run(
      `insert into assignments (id, role, scope_kind, scope_id, state, revision)
       values (?, 'operator', 'app', ?, 'enabled', 1)`,
      [OPERATOR, APP],
    );
    const archived = world.emit("AppArchived", APP);
    assert((await world.engine.step()).ok);
    for (const id of [engineer.id, OPERATOR]) {
      const row = world.connection.sql.get(
        "select state, pause_detail, pause_target, revision from assignments where id = ?",
        [id],
      )!;
      assertEquals(
        [row["state"], row["pause_target"]],
        ["paused", APP],
        id,
      );
      assertEquals(Number(row["revision"]), 2, id);
    }
    // 멈춤 둘과 cursor가 함께 확정됐다.
    assertEquals(world.cursor(), archived);
    assertEquals(
      count(
        world,
        "select count(*) as n from events where type = 'AssignmentPaused'",
      ),
      2n,
    );
    // 이미 멈춘 책임은 다시 멈추지 않는다. 같은 보관을 한 번 더 받아도 cursor만 간다.
    const again = world.emit("AppArchived", APP);
    assert((await world.engine.step()).ok);
    assertEquals(world.cursor(), again);
    assertEquals(
      count(
        world,
        "select count(*) as n from events where type = 'AssignmentPaused'",
      ),
      2n,
    );
    // 보관이 풀리면 멈춘 둘을 켠다.
    const unarchived = world.emit("AppUnarchived", APP);
    assert((await world.engine.step()).ok);
    assertEquals(world.cursor(), unarchived);
    assertEquals(
      [world.stateOf(engineer.id), world.stateOf(OPERATOR)],
      ["enabled", "enabled"],
    );
    assertEquals(
      count(
        world,
        "select count(*) as n from events where type = 'AssignmentResumed'",
      ),
      2n,
    );
    // 켜진 책임에 보관 해제를 다시 받아도 아무것도 하지 않는다.
    const repeat = world.emit("AppUnarchived", APP);
    assert((await world.engine.step()).ok);
    assertEquals(world.cursor(), repeat);
    assertEquals(
      count(
        world,
        "select count(*) as n from events where type = 'AssignmentResumed'",
      ),
      2n,
    );
  } finally {
    await world.close();
  }
});

Deno.test("lophn-agent/assignments#R14 [agent-R12]: a project archive pauses only that project's assignments and the unarchive resumes them", async () => {
  const world = await open();
  try {
    world.connection.sql.run(
      `insert into assignments (id, role, scope_kind, scope_id, state, revision)
       values (?, 'operator', 'project', ?, 'enabled', 1)`,
      [OPERATOR, PROJECT],
    );
    world.emit("AppCreated", APP);
    assert((await world.engine.step()).ok);
    world.emit("ProjectArchived", PROJECT);
    assert((await world.engine.step()).ok);
    assertEquals(world.stateOf(OPERATOR), "paused");
    // 다른 자리의 책임은 그대로다.
    assertEquals(world.engineer()?.state, "enabled");
    world.emit("ProjectUnarchived", PROJECT);
    assert((await world.engine.step()).ok);
    assertEquals(world.stateOf(OPERATOR), "enabled");
  } finally {
    await world.close();
  }
});
