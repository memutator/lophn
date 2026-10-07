// lophn-agent/assignments#R1: AppCreated·AppArchived 반응 engine. 구독자 gate가 있는 등록
// executor(applyMigrations + runCommand)를 direct connection으로 부르고, 반응 engine은
// reaction.ts의 실제 것을 쓴다. 제품 core 경로는 apps/core/assignment-reactions_test.ts가 본다. 구독자 gate를 만드는 direct connection이
// platform/ledger를 직접 부르므로 apps/core/testing/에 둔다(lophn-agent-assignments_test.ts와 같다).
import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import {
  canonicalize,
  err,
  type LophnError,
  manualClock,
  ok,
} from "../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../packages/contracts/platform/mod.ts";
import { ASSIGNMENT_SUBSCRIBER } from "../../../packages/contracts/lophn-agent/mod.ts";
import { applyMigrations } from "../../../packages/platform/backup-and-migration/mod.ts";
import {
  createSubscriberGate,
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../../../packages/platform/ledger/mod.ts";
import { advanceSubscriberCursorCommand } from "../../../packages/platform/ledger/commands.ts";
import {
  createPresetCommands,
  presetSchemaSteps,
} from "../../../packages/lophn-agent/presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../../../packages/lophn-agent/assignments/mod.ts";
import {
  ASSIGNMENT_REACTION_OPERATIONS,
  assignmentEngine,
} from "../../../packages/lophn-agent/assignments/reaction.ts";
import { presetValidateDeps } from "../../../packages/lophn-agent/assignments/registration_test.ts";

const NOW = Date.UTC(2026, 0, 1);
const NOW_TEXT = "2026-01-01T00:00:00.000Z";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const PRESET = "pst_01arz3ndektsv4rrffq69g5fav";
const PRINCIPAL = "machine:lophn-agent-assignments";

function presetDefinition() {
  return {
    kind: "app_engineer",
    name: "App Engineer",
    origin: "product",
    prompt: "a".repeat(64),
    capability: { bundles: [], tools: [] },
    context: [{ kind: "assignment_scope", target: null, section: null }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: null,
    organizing_model: null,
    instructions: [],
  };
}

async function open() {
  const dir = await Deno.makeTempDir({ prefix: "asg-r1-reaction-" });
  const path = `${dir}/ledger.db`;
  const clock = manualClock(NOW);
  const applied = await applyMigrations(
    path,
    [...LEDGER_SCHEMA_STEPS, ...presetSchemaSteps, ...assignmentSchemaSteps],
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
      operations: [...ASSIGNMENT_REACTION_OPERATIONS, "RegisterDefaultPreset"],
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
        createPresetCommands(presetValidateDeps()).registerDefault,
        commands.createAppEngineer,
        commands.pause,
        advanceSubscriberCursorCommand,
      ],
      machine,
      { command, input, idempotency_key: key, compare, prepared: [] } as never,
    );
  const definition = presetDefinition();
  const seeded = await run("RegisterDefaultPreset", {
    id: PRESET,
    definition,
    definition_hash: createHash("sha256").update(
      canonicalize(definition),
      "utf8",
    ).digest("hex"),
  }, "seed-preset");
  assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));

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
  const presetNow: {
    current: { preset: string; preset_revision: number } | null;
  } = {
    current: { preset: PRESET, preset_revision: 1 },
  };
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
    preset: () => Promise.resolve(ok(presetNow.current)),
    findAppEngineer: () => Promise.resolve(ok(engineer())),
  });
  return {
    connection,
    cursor,
    emit,
    engineer,
    engine,
    presetNow,
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
      preset: PRESET,
      preset_revision: 1,
    }, "other-key");
    assert(again.ok, again.ok ? "" : JSON.stringify(again.error));
    // 다른 id·다른 key로 같은 앱의 둘째 AE를 내면 거절이다.
    const second = await world.run("CreateAppEngineerAssignment", {
      id: "asg_00000000000000000000000099",
      app_created_seq: seq,
      app: APP,
      preset: PRESET,
      preset_revision: 1,
    }, "second-key");
    assert(!second.ok);
    assertEquals(second.error.code, "conflict");
    assertEquals(count(world, "select count(*) as n from assignments"), 1n);
  } finally {
    await world.close();
  }
});

Deno.test("lophn-agent/assignments#R1: AE preset이 아직 없으면 그 AppCreated에서 멈추고 cursor를 올리지 않으며 준비되면 이어서 만든다", async () => {
  const world = await open();
  try {
    const first = world.emit("AppCreated", APP);
    world.presetNow.current = null;
    const blocked = await world.engine.step();
    assert(!blocked.ok);
    assertEquals(world.engineer(), null);
    // AppCreated 앞의 event(preset 등록)까지만 cursor가 갔고 AppCreated는 처리되지 않았다.
    assert(BigInt(world.cursor()) < BigInt(first));
    world.presetNow.current = { preset: PRESET, preset_revision: 1 };
    const resumed = await world.engine.step();
    assert(resumed.ok, resumed.ok ? "" : JSON.stringify(resumed.error));
    assertEquals(world.engineer()?.state, "enabled");
    assertEquals(world.cursor(), first);
  } finally {
    await world.close();
  }
});

Deno.test("lophn-agent/assignments#R1: AppArchived는 담당 AE를 멈추고 cursor와 같이 확정하며 보관 해제·재전달은 자동으로 켜거나 다시 멈추지 않는다", async () => {
  const world = await open();
  try {
    world.emit("AppCreated", APP);
    assert((await world.engine.step()).ok);
    const before = world.engineer()!;
    const archived = world.emit("AppArchived", APP);
    assert((await world.engine.step()).ok);
    // 멈춤은 scope_archived이고 cursor가 같은 transaction에 올랐다.
    const row = world.connection.sql.get(
      "select state, pause_reason_kind, pause_target, revision from assignments where id = ?",
      [before.id],
    )!;
    assertEquals(
      [row["state"], row["pause_reason_kind"], row["pause_target"]],
      ["paused", "scope_archived", APP],
    );
    assertEquals(Number(row["revision"]), before.revision + 1);
    assertEquals(world.cursor(), archived);
    // 보관 해제는 계기가 아니다. cursor만 올라가고 멈춘 채다(재개는 사람의 ResumeAssignment).
    const unarchived = world.emit("AppUnarchived", APP);
    assert((await world.engine.step()).ok);
    assertEquals(world.cursor(), unarchived);
    assertEquals(world.engineer()?.state, "paused");
    assertEquals(
      count(
        world,
        "select count(*) as n from events where type in ('AssignmentResumed', 'AssignmentWithdrawn')",
      ),
      0n,
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
      1n,
    );
  } finally {
    await world.close();
  }
});
