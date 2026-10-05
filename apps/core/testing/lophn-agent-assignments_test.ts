import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import {
  canonicalize,
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
import { presetSchemaSteps } from "../../../packages/lophn-agent/presets/mod.ts";
import { createPresetCommands } from "../../../packages/lophn-agent/presets/mod.ts";
import { presetValidateDeps } from "../../../packages/lophn-agent/assignments/registration_test.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../../../packages/lophn-agent/assignments/mod.ts";

// assignment ledger integration 테스트. harness 밖의 direct connection으로
// 등록 executor(applyMigrations + runCommand)와 실제 notification 생성을
// 관측한다. probeWrite는 항상 rollback이라 이벤트를 남길 수 없어서다.

const NOW = Date.UTC(2026, 0, 1);
const NOW_TEXT = "2026-01-01T00:00:00.000Z";

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

function definitionHash(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

function presetDefinitionJson(
  kind: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    kind,
    name: "Review",
    origin: "product",
    prompt: "a".repeat(64),
    capability: {
      bundles: [{ name: "read-only", revision: 1 }],
      tools: [],
    },
    context: [{ kind: "document", target: DOC, section: null }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: {
      provider: "pvd_01arz3ndektsv4rrffq69g5fav",
      credentials: ["key-main"],
      model_name: "claude-haiku-4-5",
      reasoning_level: "medium",
      options: {},
    },
    organizing_model: null,
    instructions: [],
    ...overrides,
  };
}

Deno.test("lophn-agent/assignments#T9: machine pause emits AssignmentPaused and the notification trigger creates a notification", async () => {
  const dir = await Deno.makeTempDir({ prefix: "asg-t9-ntf-" });
  const path = `${dir}/ledger.db`;
  try {
    // 등록 executor 경로의 schema다. preset·assignment·approval·notifications 순서로 만든다.
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [
        ...LEDGER_SCHEMA_STEPS,
        ...presetSchemaSteps,
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
    const subscriberGate = gate.value;

    const machineCtx: AuthenticatedContext = {
      actor: "machine",
      principal: "machine-1",
      credential_ref: "cred-m",
      scope: {
        operations: [
          "RegisterDefaultPreset",
          "CreateBuiltinAssignment",
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
      subscriberGate,
      checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
    };

    const presetCommands = createPresetCommands(presetValidateDeps());
    const assignmentCommands = createAssignmentCommands();

    const definition = presetDefinitionJson("lophn");
    const seeded = await runCommand(
      connection,
      deps,
      [presetCommands.registerDefault],
      machineCtx,
      {
        command: "RegisterDefaultPreset",
        input: {
          id: "pst_01arz3ndektsv4rrffq69g5fav",
          definition,
          definition_hash: definitionHash(definition),
        },
        idempotency_key: "seed-preset",
        compare: {},
        prepared: [],
      },
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));

    const created = await runCommand(
      connection,
      deps,
      [assignmentCommands.createBuiltin],
      machineCtx,
      {
        command: "CreateBuiltinAssignment",
        input: {
          id: "asg_01arz3ndektsv4rrffq69g5fav",
          preset: "pst_01arz3ndektsv4rrffq69g5fav",
          preset_revision: 1,
          role: "lophn",
          scope: { kind: "all", id: null },
        },
        idempotency_key: "create-asg",
        compare: {},
        prepared: [],
      },
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
    const envelopeOf = (sourceSeq: string) => {
      ntf++;
      return {
        command: "create_notification",
        input: {
          id: `ntf_${sourceSeq.padStart(26, "0").slice(-26)}`,
          source_seq: sourceSeq,
          source_event: "AssignmentPaused",
          processed_through_seq: sourceSeq,
          subscriber: NOTIFICATION_SUBSCRIBER,
        },
        idempotency_key: `create-ntf-${ntf}`,
        compare: { processed_through_seq: storedCursor() },
        prepared: [] as string[],
      };
    };

    // 사람 pause는 user 근거로 진행되고 machine pause와 Notification은 만들지 않는다.
    const userPause = await runCommand(
      connection,
      deps,
      [assignmentCommands.pause],
      userCtxOf(machineCtx),
      {
        command: "PauseAssignment",
        input: {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "user",
            detail: "사람이 직접 멈췄다",
            runs: [],
            target: null,
          },
        },
        idempotency_key: "pause-user",
        compare: { revision: 1, state: "enabled" },
        prepared: [],
      },
    );
    assert(userPause.ok, userPause.ok ? "" : JSON.stringify(userPause.error));
    // 사람 pause는 notification을 만들지 않는다(R1 계기 표 conditionMet).
    const userNtf = await runCommand(
      connection,
      deps,
      [NOTIFICATION_COMMANDS[0]],
      machineCtx,
      envelopeOf(getEventSeq(connection, "AssignmentPaused")),
    );
    // createNotification이 forbidden으로 0n notification이면 사실이다.
    assert(!userNtf.ok && userNtf.error.code === "forbidden");
    assertEquals(countNotifications(connection), 0n);

    // 사람 재개(R9)다. 이어서 machine pause로 계기를 낸다.
    const resumed = await runCommand(
      connection,
      deps,
      [assignmentCommands.resume],
      userCtxOf(machineCtx),
      {
        command: "ResumeAssignment",
        input: { assignment: "asg_01arz3ndektsv4rrffq69g5fav" },
        idempotency_key: "resume-user",
        compare: { revision: 2, state: "paused" },
        prepared: [],
      },
    );
    assert(resumed.ok, resumed.ok ? "" : JSON.stringify(resumed.error));

    // T9 이어받음: machine pause가 AssignmentPaused를 낸 것을 확인하는 정상 경로는
    // T10 run ledger 자리다. 여기서는 실제 시작한 최종 실패 3회 근거를 RunFinished
    // event로 직접 남긴다(R10, 질문 Q17).
    for (
      const run of [
        "run_01arz3ndektsv4rrffq69g5fav",
        "run_01arz3ndektsv4rrffq69g5fbw",
        "run_01arz3ndektsv4rrffq69g5fbx",
      ]
    ) {
      emitSource(
        connection,
        "RunFinished",
        run,
        {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          started: true,
          started_at: NOW_TEXT,
          outcome: { kind: "failed", reason: "model_error" },
          result: "a".repeat(64),
          finished_at: NOW_TEXT,
        },
      );
    }

    const machinePause = await runCommand(
      connection,
      deps,
      [assignmentCommands.pause],
      machineCtx,
      {
        command: "PauseAssignment",
        input: {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "consecutive_failures",
            detail: "최종 실패 3회",
            runs: [
              "run_01arz3ndektsv4rrffq69g5fav",
              "run_01arz3ndektsv4rrffq69g5fbw",
              "run_01arz3ndektsv4rrffq69g5fbx",
            ],
            target: null,
          },
        },
        idempotency_key: "pause-machine",
        compare: { revision: 3, state: "enabled" },
        prepared: [],
      },
    );
    assert(
      machinePause.ok,
      machinePause.ok ? "" : JSON.stringify(machinePause.error),
    );
    // AssignmentPaused event가 machine pause로 남았다(R10, platform#T29 이어받음).
    const events = connection.sql.all(
      "select seq, actor from events where type = 'AssignmentPaused' order by seq",
      [],
    );
    assertEquals(events.length, 2);
    assertEquals(
      events.some((row) => String(row["actor"]) === "machine"),
      true,
    );

    // 실제 등록 executor 경로에서 notification이 만들어진다.
    const machineNtfSeq = String(events[1]!["seq"]);
    const machineNtf = await runCommand(
      connection,
      deps,
      [NOTIFICATION_COMMANDS[0]],
      machineCtx,
      envelopeOf(machineNtfSeq),
    );
    assert(
      machineNtf.ok,
      machineNtf.ok ? "" : JSON.stringify(machineNtf.error),
    );
    assertEquals(countNotifications(connection), 1n);
    // cursor가 전진한다(platform#T29 이어받음, architecture 5.10).
    assertEquals(storedCursor(), machineNtfSeq);

    connection.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lophn-agent/assignments#R13: failure pause stays scoped to its assignment, other assignments continue, no credential values in evidence", async () => {
  const dir = await Deno.makeTempDir({ prefix: "asg-r13-" });
  const path = `${dir}/ledger.db`;
  try {
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [
        ...LEDGER_SCHEMA_STEPS,
        ...presetSchemaSteps,
        ...assignmentSchemaSteps,
      ],
      { clock },
    );
    assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
    const opened = openConnection(path);
    assert(opened.ok, "open");
    const connection = opened.value;

    const machineCtx: AuthenticatedContext = {
      actor: "machine",
      principal: "machine-1",
      credential_ref: "cred-m",
      scope: {
        operations: [
          "RegisterDefaultPreset",
          "CreateBuiltinAssignment",
          "PauseAssignment",
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
      checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
    };

    const presetCommands = createPresetCommands(presetValidateDeps());
    const assignmentCommands = createAssignmentCommands();

    const definition = presetDefinitionJson("lophn");
    const seeded = await runCommand(
      connection,
      deps,
      [presetCommands.registerDefault],
      machineCtx,
      {
        command: "RegisterDefaultPreset",
        input: {
          id: "pst_01arz3ndektsv4rrffq69g5fav",
          definition,
          definition_hash: definitionHash(definition),
        },
        idempotency_key: "seed-preset",
        compare: {},
        prepared: [],
      },
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));

    const ceDefinition = presetDefinitionJson("context_engineer");
    const ceSeeded = await runCommand(
      connection,
      deps,
      [presetCommands.registerDefault],
      machineCtx,
      {
        command: "RegisterDefaultPreset",
        input: {
          id: "pst_01arz3ndektsv4rrffq69g5fcv",
          definition: ceDefinition,
          definition_hash: definitionHash(ceDefinition),
        },
        idempotency_key: "seed-ce-preset",
        compare: {},
        prepared: [],
      },
    );
    assert(ceSeeded.ok, ceSeeded.ok ? "" : JSON.stringify(ceSeeded.error));

    const created = await runCommand(
      connection,
      deps,
      [assignmentCommands.createBuiltin],
      machineCtx,
      {
        command: "CreateBuiltinAssignment",
        input: {
          id: "asg_01arz3ndektsv4rrffq69g5fav",
          preset: "pst_01arz3ndektsv4rrffq69g5fav",
          preset_revision: 1,
          role: "lophn",
          scope: { kind: "all", id: null },
        },
        idempotency_key: "create-asg",
        compare: {},
        prepared: [],
      },
    );
    assert(created.ok, created.ok ? "" : JSON.stringify(created.error));

    const ceCreated = await runCommand(
      connection,
      deps,
      [assignmentCommands.createBuiltin],
      machineCtx,
      {
        command: "CreateBuiltinAssignment",
        input: {
          id: "asg_01arz3ndektsv4rrffq69g5fbx",
          preset: "pst_01arz3ndektsv4rrffq69g5fcv",
          preset_revision: 1,
          role: "context_engineer",
          scope: { kind: "all", id: null },
        },
        idempotency_key: "create-ce-asg",
        compare: {},
        prepared: [],
      },
    );
    assert(ceCreated.ok, ceCreated.ok ? "" : JSON.stringify(ceCreated.error));

    // 첫 assignment에 실패 근거를 남긴다(R10).
    const finished = {
      assignment: "asg_01arz3ndektsv4rrffq69g5fav",
      started: true,
      started_at: NOW_TEXT,
      outcome: { kind: "failed", reason: "model_error" },
      result: "a".repeat(64),
      finished_at: NOW_TEXT,
    };
    for (
      const run of [
        "run_01arz3ndektsv4rrffq69g5fav",
        "run_01arz3ndektsv4rrffq69g5fbw",
        "run_01arz3ndektsv4rrffq69g5fbx",
      ]
    ) {
      emitSource(connection, "RunFinished", run, finished);
    }
    const paused = await runCommand(
      connection,
      deps,
      [assignmentCommands.pause],
      machineCtx,
      {
        command: "PauseAssignment",
        input: {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "consecutive_failures",
            detail: "최종 실패 3회",
            runs: [
              "run_01arz3ndektsv4rrffq69g5fav",
              "run_01arz3ndektsv4rrffq69g5fbw",
              "run_01arz3ndektsv4rrffq69g5fbx",
            ],
            target: null,
          },
        },
        idempotency_key: "pause-machine",
        compare: { revision: 1, state: "enabled" },
        prepared: [],
      },
    );
    assert(paused.ok, paused.ok ? "" : JSON.stringify(paused.error));

    // 다른 assignment는 계속된다(R13).
    assertEquals(
      String(
        connection.sql.get("select state from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fbx",
        ])!["state"],
      ),
      "enabled",
    );
    assertEquals(
      String(
        connection.sql.get("select state from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fav",
        ])!["state"],
      ),
      "paused",
    );
    // pause 근거에 credential 값이 없다(R13). detail·runs·target만 남는다.
    const row = connection.sql.get(
      "select pause_reason_kind, pause_detail, pause_runs, pause_target from assignments where id = ?",
      ["asg_01arz3ndektsv4rrffq69g5fav"],
    );
    assertEquals(String(row!["pause_reason_kind"]), "consecutive_failures");
    assertEquals(String(row!["pause_detail"]), "최종 실패 3회");
    assertEquals(row!["pause_target"], null);
    const runs = JSON.parse(String(row!["pause_runs"])) as string[];
    for (const run of runs) {
      assert(run.startsWith("run_"));
      assert(!run.includes("key-") && !run.includes("cred-"));
    }

    connection.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lophn-agent/assignments#R14: archived scope makes machine pause, transient failure makes no change", async () => {
  const dir = await Deno.makeTempDir({ prefix: "asg-r14-" });
  const path = `${dir}/ledger.db`;
  try {
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [
        ...LEDGER_SCHEMA_STEPS,
        ...presetSchemaSteps,
        ...assignmentSchemaSteps,
      ],
      { clock },
    );
    assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
    const opened = openConnection(path);
    assert(opened.ok, "open");
    const connection = opened.value;

    const machineCtx: AuthenticatedContext = {
      actor: "machine",
      principal: "machine-1",
      credential_ref: "cred-m",
      scope: {
        operations: [
          "RegisterDefaultPreset",
          "CreateBuiltinAssignment",
          "CreateAppEngineerAssignment",
          "PauseAssignment",
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
      checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
    };

    const presetCommands = createPresetCommands(presetValidateDeps());
    const assignmentCommands = createAssignmentCommands();

    const definition = presetDefinitionJson("lophn");
    const seeded = await runCommand(
      connection,
      deps,
      [presetCommands.registerDefault],
      machineCtx,
      {
        command: "RegisterDefaultPreset",
        input: {
          id: "pst_01arz3ndektsv4rrffq69g5fav",
          definition,
          definition_hash: definitionHash(definition),
        },
        idempotency_key: "seed-preset",
        compare: {},
        prepared: [],
      },
    );
    assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));

    const created = await runCommand(
      connection,
      deps,
      [assignmentCommands.createBuiltin],
      machineCtx,
      {
        command: "CreateBuiltinAssignment",
        input: {
          id: "asg_01arz3ndektsv4rrffq69g5fav",
          preset: "pst_01arz3ndektsv4rrffq69g5fav",
          preset_revision: 1,
          role: "lophn",
          scope: { kind: "all", id: null },
        },
        idempotency_key: "create-asg",
        compare: {},
        prepared: [],
      },
    );
    assert(created.ok, created.ok ? "" : JSON.stringify(created.error));

    // 전역 builtin은 scope가 all이라 scope_archived 근거는 목표 불일치다(R14).
    const scopeMismatch = await runCommand(
      connection,
      deps,
      [assignmentCommands.pause],
      machineCtx,
      {
        command: "PauseAssignment",
        input: {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "scope_archived",
            detail: "앱이 보관됐다",
            runs: [],
            target: "app_01arz3ndektsv4rrffq69g5fav",
          },
        },
        idempotency_key: "pause-scope-mismatch",
        compare: { revision: 1, state: "enabled" },
        prepared: [],
      },
    );
    assert(!scopeMismatch.ok && scopeMismatch.error.code === "forbidden");

    // 보관되지 않은 대상으로 scope_archived는 forbidden이고 상태 변경을 만들지
    // 않는다(R14. 일시 접근 불가는 새 일을 만들지 않는다).
    emitSource(connection, "AppCreated", "app_01arz3ndektsv4rrffq69g5fav", {
      slug: "review-app",
      name: "Review App",
      description: "보관 근거 테스트 앱",
    });
    const beforeArchive = await runCommand(
      connection,
      deps,
      [assignmentCommands.pause],
      machineCtx,
      {
        command: "PauseAssignment",
        input: {
          assignment: "asg_01arz3ndektsv4rrffq69g5fbw",
          reason: {
            kind: "scope_archived",
            detail: "아직 보관되지 않은 앱",
            runs: [],
            target: "app_01arz3ndektsv4rrffq69g5fav",
          },
        },
        idempotency_key: "pause-before-archive",
        compare: { revision: 1, state: "enabled" },
        prepared: [],
      },
    );
    assert(
      !beforeArchive.ok && beforeArchive.error.code === "forbidden" ||
        (!beforeArchive.ok && beforeArchive.error.code === "not_found"),
    );
    const aeDefinition = presetDefinitionJson("app_engineer");
    const aeSeeded = await runCommand(
      connection,
      deps,
      [presetCommands.registerDefault],
      machineCtx,
      {
        command: "RegisterDefaultPreset",
        input: {
          id: "pst_01arz3ndektsv4rrffq69g5fcv",
          definition: aeDefinition,
          definition_hash: definitionHash(aeDefinition),
        },
        idempotency_key: "seed-ae-preset",
        compare: {},
        prepared: [],
      },
    );
    assert(aeSeeded.ok, aeSeeded.ok ? "" : JSON.stringify(aeSeeded.error));

    const appCreatedSeq = String(
      connection.sql.get(
        "select cast(seq as text) as seq from events where type = 'AppCreated' and subject = ? order by seq desc limit 1",
        ["app_01arz3ndektsv4rrffq69g5fav"],
      )!["seq"],
    );
    const aeCreated = await runCommand(
      connection,
      deps,
      [assignmentCommands.createAppEngineer],
      machineCtx,
      {
        command: "CreateAppEngineerAssignment",
        input: {
          id: "asg_01arz3ndektsv4rrffq69g5fbw",
          preset: "pst_01arz3ndektsv4rrffq69g5fcv",
          preset_revision: 1,
          app: "app_01arz3ndektsv4rrffq69g5fav",
          app_created_seq: appCreatedSeq,
        },
        idempotency_key: "create-ae-asg",
        compare: {},
        prepared: [],
      },
    );
    assert(aeCreated.ok, aeCreated.ok ? "" : JSON.stringify(aeCreated.error));

    emitSource(connection, "AppArchived", "app_01arz3ndektsv4rrffq69g5fav", {
      run_enabled: false,
    });
    const archived = await runCommand(
      connection,
      deps,
      [assignmentCommands.pause],
      machineCtx,
      {
        command: "PauseAssignment",
        input: {
          assignment: "asg_01arz3ndektsv4rrffq69g5fbw",
          reason: {
            kind: "scope_archived",
            detail: "담당 앱이 보관됐다",
            runs: [],
            target: "app_01arz3ndektsv4rrffq69g5fav",
          },
        },
        idempotency_key: "pause-archived",
        compare: { revision: 1, state: "enabled" },
        prepared: [],
      },
    );
    assert(archived.ok, archived.ok ? "" : JSON.stringify(archived.error));
    const aeRow = connection.sql.get(
      "select state, pause_reason_kind, pause_target from assignments where id = ?",
      ["asg_01arz3ndektsv4rrffq69g5fbw"],
    );
    assertEquals(String(aeRow!["state"]), "paused");
    assertEquals(String(aeRow!["pause_reason_kind"]), "scope_archived");
    assertEquals(
      String(aeRow!["pause_target"]),
      "app_01arz3ndektsv4rrffq69g5fav",
    );

    connection.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

function userCtxOf(machine: AuthenticatedContext): AuthenticatedContext {
  return {
    ...machine,
    actor: "user",
    principal: "user-1",
    credential_ref: "cred-u",
  };
}

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
