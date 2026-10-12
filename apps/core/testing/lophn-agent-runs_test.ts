import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  type LophnError,
  manualClock,
  ok,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../packages/protocol/platform/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../../packages/core/config/mod.ts";
import { applyMigrations } from "../../../packages/core/storage/migration/mod.ts";
import {
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../../../packages/core/storage/ledger/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../../../packages/core/lophn-agent/assignments/mod.ts";
import {
  createRunCommands,
  runSchemaSteps,
} from "../../../packages/core/lophn-agent/run-loop/mod.ts";

// run ledger 통합 테스트. 명령마다 새 connection으로 실행하고 commit 직후 닫아
// (kill과 같다) 다시 연 파일에서 저장된 사실을 관측한다. harness로는 닫고 다시
// 열 수 없고 operator 등록은 승인 흐름이라, 그 두 가지를 이 파일이 맡는다.

const NOW = Date.UTC(2026, 0, 1);
const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const ASG_OPERATOR = "asg_01arz3ndektsv4rrffq69g5fbw";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";

const machineCtx: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "cred-m",
  scope: {
    operations: [
      "CreateBuiltinAssignment",
      "AcceptRun",
      "StartRun",
      "FinishRun",
    ],
    targets: {},
  },
  conditions: {},
};

Deno.test("lophn-agent/harness/run-loop#R2: an accepted run survives a kill right after each commit and a resend after restart returns the earlier result", async () => {
  const dir = await Deno.makeTempDir({ prefix: "run-r2-" });
  const path = `${dir}/ledger.db`;
  try {
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [
        ...LEDGER_SCHEMA_STEPS,
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
    const assignments = createAssignmentCommands();
    const runs = createRunCommands();
    const registry = [
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

    for (
      const result of [
        await execute(
          "CreateBuiltinAssignment",
          {
            id: ASG,
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

Deno.test("lophn-agent/harness/run-loop#R1 #R2: an operator takes no handoff run", async () => {
  const dir = await Deno.makeTempDir({ prefix: "run-r1-" });
  const path = `${dir}/ledger.db`;
  try {
    const clock = manualClock(NOW);
    const applied = await applyMigrations(
      path,
      [
        ...LEDGER_SCHEMA_STEPS,
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
      // 이 시험은 Operator 행을 직접 놓는다.
      connection.sql.run(
        `insert into assignments (id, role, scope_kind, scope_id, state,
           revision)
         values (?, 'operator', 'project', ?, 'enabled', 1)`,
        [ASG_OPERATOR, PROJECT],
      );
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
        0n,
      );
    } finally {
      connection.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
