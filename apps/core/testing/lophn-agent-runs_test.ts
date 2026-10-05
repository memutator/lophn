import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import {
  canonicalize,
  createIdSource,
  err,
  type LophnError,
  manualClock,
  ok,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../packages/contracts/platform/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../../packages/platform/settings/mod.ts";
import { applyMigrations } from "../../../packages/platform/backup-and-migration/mod.ts";
import {
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../../../packages/platform/ledger/mod.ts";
import {
  createPresetCommands,
  presetSchemaSteps,
} from "../../../packages/lophn-agent/presets/mod.ts";
import { presetValidateDeps } from "../../../packages/lophn-agent/assignments/registration_test.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../../../packages/lophn-agent/assignments/mod.ts";
import {
  createRunCommands,
  runSchemaSteps,
} from "../../../packages/lophn-agent/harness/run-loop/mod.ts";

// run ledger 통합 테스트. 명령마다 새 connection으로 실행하고 commit 직후 닫아
// (kill과 같다) 다시 연 파일에서 저장된 사실을 관측한다. harness로는 닫고 다시
// 열 수 없고 operator 등록은 승인 흐름이라, 그 두 가지를 이 파일이 맡는다.

const NOW = Date.UTC(2026, 0, 1);
const PRESET_LOPHN = "pst_01arz3ndektsv4rrffq69g5fav";
const PRESET_OPERATOR = "pst_01arz3ndektsv4rrffq69g5fbw";
const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const ASG_OPERATOR = "asg_01arz3ndektsv4rrffq69g5fbw";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const RUN_B = "run_01arz3ndektsv4rrffq69g5fbw";
const RUN_C = "run_01arz3ndektsv4rrffq69g5fbx";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

const machineCtx: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "cred-m",
  scope: {
    operations: [
      "RegisterDefaultPreset",
      "CreateBuiltinAssignment",
      "AcceptRun",
      "StartRun",
      "FinishRun",
    ],
    targets: {},
  },
  conditions: {},
};

function hashOf(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

function presetDefinition(kind: string) {
  return {
    kind,
    name: "Review",
    origin: "product",
    prompt: "a".repeat(64),
    capability: { bundles: [{ name: "read-only", revision: 1 }], tools: [] },
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
  };
}

Deno.test("lophn-agent/harness/run-loop#R2: an accepted run survives a kill right after each commit and a resend after restart returns the earlier result", async () => {
  const dir = await Deno.makeTempDir({ prefix: "run-r2-" });
  const path = `${dir}/ledger.db`;
  try {
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [
        ...LEDGER_SCHEMA_STEPS,
        ...presetSchemaSteps,
        ...assignmentSchemaSteps,
        ...runSchemaSteps,
        ...SETTINGS_SCHEMA_STEPS,
      ],
      { clock },
    );
    assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
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
    const presets = createPresetCommands(presetValidateDeps());
    const assignments = createAssignmentCommands();
    const runs = createRunCommands();
    const registry = [
      presets.registerDefault,
      assignments.createBuiltin,
      runs.accept,
      runs.start,
      runs.finish,
    ];
    // 새 connection으로 한 명령을 실행하고 곧바로 닫는다. 정상 종료 절차는 없다.
    const execute = async (
      command: string,
      input: unknown,
      compare: unknown,
      key: string,
    ) => {
      const opened = openConnection(path);
      assert(opened.ok, "open");
      try {
        return await runCommand(opened.value, deps, registry, machineCtx, {
          command,
          input,
          idempotency_key: key,
          compare,
          prepared: [],
        });
      } finally {
        opened.value.close();
      }
    };
    const observe = <T>(
      read: (sql: {
        get: (q: string, p: never[]) => Record<string, unknown> | undefined;
      }) => T,
    ): T => {
      const opened = openConnection(path);
      assert(opened.ok, "reopen");
      try {
        return read(opened.value.sql as never);
      } finally {
        opened.value.close();
      }
    };

    const definition = presetDefinition("lophn");
    for (
      const result of [
        await execute(
          "RegisterDefaultPreset",
          {
            id: PRESET_LOPHN,
            definition,
            definition_hash: hashOf(definition),
          },
          {},
          "k-preset",
        ),
        await execute(
          "CreateBuiltinAssignment",
          {
            id: ASG,
            preset: PRESET_LOPHN,
            preset_revision: 1,
            role: "lophn",
            scope: { kind: "all", id: null },
          },
          {},
          "k-asg",
        ),
      ]
    ) assert(result.ok, result.ok ? "" : JSON.stringify(result.error));

    const acceptInput = {
      id: RUN,
      assignment: ASG,
      session: null,
      source: { kind: "message", message: MSG },
      continued_from: null,
      start_after: null,
    };
    const accepted = await execute(
      "AcceptRun",
      acceptInput,
      { assignment_revision: 1 },
      "k-accept",
    );
    assert(accepted.ok, accepted.ok ? "" : JSON.stringify(accepted.error));
    // commit 직후 닫았어도 접수 run과 event가 남아 있다.
    const stored = observe((sql) =>
      sql.get(
        "select state, state_seq, source_message from runs where id = ?",
        [
          RUN,
        ] as never,
      )
    );
    assertEquals(stored?.["state"], "accepted");
    assertEquals(stored?.["source_message"], MSG);
    const acceptedEvents = observe((sql) =>
      sql.get(
        "select count(*) as n from events where type = 'RunAccepted' and subject = ?",
        [RUN] as never,
      )
    );
    assertEquals(acceptedEvents?.["n"], 1n);

    // 재시작 뒤 같은 요청을 다시 보내면 이전 결과이고 run은 하나다.
    const resent = await execute(
      "AcceptRun",
      acceptInput,
      { assignment_revision: 1 },
      "k-accept",
    );
    assert(resent.ok, resent.ok ? "" : JSON.stringify(resent.error));
    assertEquals(resent.value.replayed, true);
    assertEquals(resent.value.result, accepted.value.result);
    assertEquals(
      observe((sql) => sql.get("select count(*) as n from runs", [] as never))
        ?.["n"],
      1n,
    );

    const startInput = {
      run: RUN,
      basis: "b".repeat(64),
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      scope: { role: "lophn", assignment: ASG, apps: [] },
    };
    const started = await execute(
      "StartRun",
      startInput,
      { state_seq: String(stored?.["state_seq"]) },
      "k-start",
    );
    assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
    const running = observe((sql) =>
      sql.get("select state, basis from runs where id = ?", [RUN] as never)
    );
    assertEquals(running?.["state"], "running");
    assertEquals(running?.["basis"], "b".repeat(64));

    const startedSeq = String(
      observe((sql) =>
        sql.get("select state_seq from runs where id = ?", [RUN] as never)
      )?.["state_seq"],
    );
    const finished = await execute(
      "FinishRun",
      {
        run: RUN,
        outcome: { kind: "failed", reason: "model_error" },
        result: "c".repeat(64),
      },
      { state_seq: startedSeq },
      "k-finish",
    );
    assert(finished.ok, finished.ok ? "" : JSON.stringify(finished.error));
    const done = observe((sql) =>
      sql.get(
        "select state, outcome_kind, outcome_reason, result from runs where id = ?",
        [RUN] as never,
      )
    );
    assertEquals(done?.["state"], "finished");
    assertEquals(done?.["outcome_reason"], "model_error");
    // 재시작 뒤 진행 중으로 되돌아간 run이 없다.
    assertEquals(
      observe((sql) =>
        sql.get(
          "select count(*) as n from runs where state in ('running', 'waiting_user')",
          [] as never,
        )
      )?.["n"],
      0n,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lophn-agent/harness/run-loop#R1 #R2: an operator round makes one run per scheduled time and a stale revision is refused", async () => {
  const dir = await Deno.makeTempDir({ prefix: "run-r1-" });
  const path = `${dir}/ledger.db`;
  try {
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [
        ...LEDGER_SCHEMA_STEPS,
        ...presetSchemaSteps,
        ...assignmentSchemaSteps,
        ...runSchemaSteps,
        ...SETTINGS_SCHEMA_STEPS,
      ],
      { clock },
    );
    assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
    const opened = openConnection(path);
    assert(opened.ok, "open");
    const connection = opened.value;
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
    const presets = createPresetCommands(presetValidateDeps());
    const runs = createRunCommands();
    let key = 0;
    const run = (
      command: (typeof runs)["accept"],
      name: string,
      input: unknown,
      compare: unknown,
    ) =>
      runCommand(connection, deps, [command], machineCtx, {
        command: name,
        input,
        idempotency_key: `k-${++key}`,
        compare,
        prepared: [],
      });
    try {
      const definition = presetDefinition("operator");
      const seeded = await runCommand(
        connection,
        deps,
        [presets.registerDefault],
        machineCtx,
        {
          command: "RegisterDefaultPreset",
          input: {
            id: PRESET_OPERATOR,
            definition,
            definition_hash: hashOf(definition),
          },
          idempotency_key: "k-preset",
          compare: {},
          prepared: [],
        },
      );
      assert(seeded.ok, seeded.ok ? "" : JSON.stringify(seeded.error));
      // operator 등록은 승인 흐름이므로 이 시험은 행을 직접 놓는다.
      connection.sql.run(
        `insert into assignments (id, preset_id, preset_revision, role,
           scope_kind, scope_id, state, revision)
         values (?, ?, 1, 'operator', 'project', ?, 'enabled', 1)`,
        [ASG_OPERATOR, PRESET_OPERATOR, PROJECT],
      );
      const schedule = (id: string, scheduledAt: string, revision = 1) => ({
        id,
        assignment: ASG_OPERATOR,
        session: null,
        source: {
          kind: "schedule",
          assignment_revision: revision,
          scheduled_at: scheduledAt,
        },
        continued_from: null,
        start_after: null,
      });
      const first = await run(
        runs.accept,
        "AcceptRun",
        schedule(RUN, "2026-01-01T09:00:00.000Z"),
        { assignment_revision: 1 },
      );
      assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
      // 같은 회차는 다른 run id로 와도 기존 run이다.
      const again = await run(
        runs.accept,
        "AcceptRun",
        schedule(RUN_B, "2026-01-01T09:00:00.000Z"),
        { assignment_revision: 1 },
      );
      assert(again.ok, again.ok ? "" : JSON.stringify(again.error));
      assertEquals((again.value.result as { id: string }).id, RUN);
      // 다음 회차는 새 run이다.
      const next = await run(
        runs.accept,
        "AcceptRun",
        schedule(RUN_C, "2026-01-01T10:00:00.000Z"),
        { assignment_revision: 1 },
      );
      assert(next.ok, next.ok ? "" : JSON.stringify(next.error));
      // 낡은 assignment 판의 회차는 거절된다.
      const stale = await run(
        runs.accept,
        "AcceptRun",
        schedule(
          "run_01arz3ndektsv4rrffq69g5fby",
          "2026-01-01T11:00:00.000Z",
          2,
        ),
        { assignment_revision: 1 },
      );
      assert(!stale.ok && stale.error.code === "conflict");
      // operator는 handoff를 받지 않는다.
      const handoff = await run(runs.accept, "AcceptRun", {
        id: "run_01arz3ndektsv4rrffq69g5fbz",
        assignment: ASG_OPERATOR,
        session: null,
        source: {
          kind: "handoff",
          sender_run: RUN,
          original_message: MSG,
          body: "d".repeat(64),
          references: [],
          dedup_key: "k",
        },
        continued_from: null,
        start_after: null,
      }, { assignment_revision: 1 });
      assert(!handoff.ok && handoff.error.code === "invalid_input");
      assertEquals(
        connection.sql.get("select count(*) as n from runs", [])?.["n"],
        2n,
      );
    } finally {
      connection.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
