// activation의 backup 관문·실패 복원·끊긴 시도 이어받기(apps/data#R4, R9, R11, R12, apps/releases#R15,
// architecture/apps 8장)를 본다. supervisor 자식·앱 DB·core 응답은 `testing/activation.ts`의 대역 세계이고
// migration 이력은 실제 core의 event에서 읽는다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  call,
  command,
  inspect,
} from "../../../../apps/core/testing/approvals-fixture.ts";
import {
  activationWorld,
  APP,
  Crash,
  NEXT,
  PREVIOUS,
  type World as Fake,
  type WorldOptions,
} from "../testing/activation.ts";
import { observeReleaseActivations, recoverActivation } from "./recovery.ts";
import { releasesLedger } from "../testing/mod.ts";
import { runActivation } from "./orchestrator.ts";
import { loadMigrationHistory } from "./recovery.ts";
import {
  complete,
  prepare,
  start,
  startedSeq,
  withWorld,
} from "./world_test.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

function without(log: readonly string[], ...points: string[]): boolean {
  return points.every((point) => !log.includes(point));
}

function order(log: readonly string[], ...points: string[]): void {
  const at = points.map((point) => log.lastIndexOf(point));
  for (const [index, point] of points.entries()) {
    assert(at[index] >= 0, `${point} did not happen: ${log.join(", ")}`);
  }
  for (let index = 1; index < at.length; index++) {
    assert(
      at[index - 1] < at[index],
      `${points[index - 1]} should come before ${points[index]}: ${
        log.join(", ")
      }`,
    );
  }
}

Deno.test("apps/data#R4: 이전 자식의 종료 확인이나 backup 확정이 늦으면 migration도 새 업무도 시작되지 않는다", async () => {
  // 종료 확인이 늦다.
  const slowStop = activationWorld({ schema: 0, targetSchema: 1 });
  const stopped = slowStop.hold("supervisor.stopCurrent");
  const first = runActivation(slowStop.ports, slowStop.ledger.release);
  await tick();
  assert(
    without(
      slowStop.log,
      "data.inspect",
      "data.backup",
      "data.migrate",
      "supervisor.startCandidate",
    ),
    slowStop.log.join(", "),
  );
  assertEquals(slowStop.db.rows, ["a", "b"]);
  stopped();
  assertEquals((await first).status, "active");

  // backup 확정이 늦다. backup 파일은 있어도 ledger가 확정하기 전에는 변경하지 않는다.
  const slowBackup = activationWorld({ schema: 0, targetSchema: 1 });
  const recorded = slowBackup.hold("core.recordBackup");
  const second = runActivation(slowBackup.ports, slowBackup.ledger.release);
  await tick();
  assert(slowBackup.log.includes("data.backup"));
  assert(
    without(slowBackup.log, "data.migrate", "supervisor.startCandidate"),
    slowBackup.log.join(", "),
  );
  assertEquals(slowBackup.db.schema, 0);
  recorded();
  assertEquals((await second).status, "active");
  order(slowBackup.log, "core.recordBackup", "data.migrate");

  // 종료를 확인하지 못하면 데이터 작업 없이 unavailable이고 시도는 진행 중으로 남는다.
  const unconfirmed = activationWorld({ schema: 0, targetSchema: 1 });
  unconfirmed.fault("supervisor.stopCurrent", "error");
  const outcome = await runActivation(
    unconfirmed.ports,
    unconfirmed.ledger.release,
  );
  assertEquals(outcome, {
    status: "unavailable",
    code: "termination_unconfirmed",
  });
  assert(without(unconfirmed.log, "data.backup", "data.migrate"));
  assertEquals(unconfirmed.ledger.release.status, "activating");
});

Deno.test("apps/data#R11, apps/releases#R15: migration이나 새 준비가 실패하면 새 자식 종료 → backup restore → 무결성·schema 확인 → record_data_restore → fail_activation → 이전 release 재준비 순서이다", async () => {
  const cases: [string, WorldOptions, (world: Fake) => void][] = [
    [
      "migration",
      { schema: 0, targetSchema: 1, migrateBreaks: true },
      () => {},
    ],
    ["준비", { schema: 0, targetSchema: 2 }, (world) => {
      world.fault("supervisor.startCandidate", "error");
    }],
  ];
  for (const [name, options, setup] of cases) {
    const world = activationWorld(options);
    setup(world);
    const outcome = await runActivation(world.ports, world.ledger.release);
    assertEquals(
      outcome,
      {
        status: "failed",
        code: name === "migration" ? "migration_failed" : "start_failed",
        previous: "started",
      },
      name,
    );
    order(
      world.log,
      "supervisor.stopCandidate",
      "data.restore",
      "core.recordDataRestore",
      "core.failActivation",
      "supervisor.run",
    );
    // 실제 DB가 backup 시점으로 돌아왔고 이전 release가 active 참조로 남는다.
    assertEquals(world.db.schema, 0, name);
    assertEquals(world.db.rows, ["a", "b"], name);
    assertEquals(world.ledger.records.restore?.schema, 0, name);
    assertEquals(world.ledger.release.status, "failed", name);
    assertEquals(world.ledger.active, PREVIOUS, name);
    assertEquals(world.children.runs, [PREVIOUS], name);
    assertEquals(world.children.candidate, "none", name);
    assert(without(world.log, "supervisor.openCandidate"), name);
  }
});

Deno.test("apps/data#R11, apps/releases#R15: 복원이 실패하거나 확인되지 않으면 unavailable로 문제를 보고하고 데이터를 더 덮지도 이전 코드를 시작하지도 않는다", async () => {
  const cases: [string, (world: Fake) => void, string][] = [
    ["restore가 끝나지 않음", (world) => {
      world.fault("data.restore", "error");
    }, "restore_failed"],
    ["restore 결과를 확정하지 못함", (world) => {
      world.fault("core.recordDataRestore", "error");
    }, "restore_not_recorded"],
    ["자식 종료를 확인하지 못함", (world) => {
      world.fault("supervisor.stopCandidate", "error");
    }, "termination_unconfirmed"],
  ];
  for (const [name, setup, code] of cases) {
    const world = activationWorld({
      schema: 0,
      targetSchema: 1,
      migrateBreaks: true,
    });
    setup(world);
    const outcome = await runActivation(world.ports, world.ledger.release);
    assertEquals(outcome, { status: "unavailable", code }, name);
    assertEquals(world.problems.length, 1, name);
    assertEquals(world.problems[0].code, code, name);
    assertEquals(world.problems[0].release, NEXT, name);
    // 실패로 닫지도 이전 코드를 시작하지도 않고 backup과 진행 중 시도를 그대로 둔다.
    assert(without(world.log, "core.failActivation", "supervisor.run"), name);
    assertEquals(world.ledger.release.status, "activating", name);
    assertEquals(world.ledger.active, PREVIOUS, name);
    assertEquals(world.backups.size, 1, name);
  }
});

Deno.test("apps/data#R12: 새 release가 채택되고 업무를 받은 뒤에는 옛 backup으로 자동 덮지 않는다", async () => {
  // 성공 뒤 새 업무 data가 쌓였다. 재시작 점검이 같은 시도를 이어받아도 복원하지 않는다.
  const world = activationWorld({ schema: 0, targetSchema: 1 });
  assertEquals(
    (await runActivation(world.ports, world.ledger.release)).status,
    "active",
  );
  world.businessWrite("new item");
  const restores = world.log.filter((line) => line === "data.restore").length;
  const recovered = await recoverActivation(world.ports, NEXT);
  assertEquals(recovered, { status: "active", opened: true });
  assertEquals(
    world.log.filter((line) => line === "data.restore").length,
    restores,
  );
  assertEquals(world.db.rows, ["a", "b", "migrated", "new item"]);
  assertEquals(world.ledger.records.restore, null);

  // complete_activation의 응답을 잃어도 같다. ledger가 새 release를 채택했으므로 복원하지 않고 다시 준비한다.
  const lost = activationWorld({ schema: 0, targetSchema: 1 });
  lost.fault("core.completeActivation", "lost");
  const outcome = await runActivation(lost.ports, lost.ledger.release);
  assertEquals(outcome, { status: "active", opened: true });
  assertEquals(lost.ledger.active, NEXT);
  assertEquals(lost.db.rows, ["a", "b", "migrated"]);
  assert(without(lost.log, "data.restore", "core.failActivation"));
  assertEquals(lost.children.runs, [NEXT]);
});

// 각 단계의 호출을 끊는다. child(supervisor 자식)·core(응답 유실 포함)·supervisor 자체(process 종료)를 끊고
// 같은 시도를 이어받은 뒤의 최종 상태가 어느 쪽이든 하나로 일관되어야 한다.
const POINTS = [
  "supervisor.stopCurrent",
  "data.inspect",
  "data.backup",
  "core.recordBackup",
  "data.migrate",
  "core.recordDataChange",
  "supervisor.startCandidate",
  "core.completeActivation",
  "supervisor.openCandidate",
];

Deno.test("apps/data#R11, apps/releases#R14: 각 단계에서 child·core·supervisor를 끊어도 이어받은 뒤에는 새 release 채택과 migration 결과 또는 복원과 이전 release 중 하나뿐이다", async () => {
  for (const point of POINTS) {
    for (const mode of ["error", "lost", "crash", "crash_after"] as const) {
      const label = `${point} ${mode}`;
      const world = activationWorld({ schema: 0, targetSchema: 1 });
      world.fault(point, mode);
      try {
        await runActivation(world.ports, world.ledger.release);
      } catch (thrown) {
        // supervisor process가 끊긴 것이다. 새 process가 같은 ledger와 실제 관측에서 이어받는다.
        assert(thrown instanceof Crash, label);
      }
      world.clearFaults();
      const resumed = await recoverActivation(world.ports, NEXT);
      const adopted = world.ledger.active === NEXT;
      assertEquals(
        world.log.filter((line) => line.startsWith("VIOLATION")),
        [],
        label,
      );
      if (adopted) {
        // 채택됐으면 data는 새 schema 그대로이고 복원한 적이 없으며 새 release가 열려 있다.
        assertEquals(world.db.schema, 1, label);
        assertEquals(world.db.rows, ["a", "b", "migrated"], label);
        assertEquals(world.ledger.records.restore, null, label);
        assertEquals(world.children.candidate, "open", label);
        assertEquals(world.children.previous, false, label);
        assertEquals(resumed.status, "active", label);
      } else {
        // 채택되지 않았으면 data는 시작 때로 돌아와 있고 시도는 실패로 닫혔으며 이전 release가 다시 열렸다.
        assertEquals(world.db.schema, 0, label);
        assertEquals(world.db.rows, ["a", "b"], label);
        assertEquals(world.ledger.release.status, "failed", label);
        assertEquals(world.children.previous, true, label);
        assertEquals(world.children.candidate, "none", label);
        assertEquals(resumed.status, "failed", label);
      }
    }
  }
});

Deno.test("apps/data#R11: core를 읽지 못하는 동안은 unavailable로 두고 core가 돌아오면 이어받는다", async () => {
  const world = activationWorld({ schema: 0, targetSchema: 1 });
  world.fault("supervisor.startCandidate", "crash");
  try {
    await runActivation(world.ports, world.ledger.release);
  } catch (thrown) {
    assert(thrown instanceof Crash);
  }
  world.fault("core.release", "error");
  const blind = await recoverActivation(world.ports, NEXT);
  assertEquals(blind, { status: "unavailable", code: "core_unreachable" });
  assert(without(world.log, "data.restore", "core.failActivation"));
  assertEquals(world.ledger.release.status, "activating");
  world.clearFaults();
  assertEquals((await recoverActivation(world.ports, NEXT)).status, "failed");
  assertEquals(world.db.rows, ["a", "b"]);
});

Deno.test("apps/data#R9: migration 이력에서 출발·도착 schema·설명·backup·결과·시각을 성공과 실패 시도마다 찾는다", async () => {
  await withWorld(async (world) => {
    const first = await prepare(world);
    assertEquals(
      (await complete(
        world,
        first,
        startedSeq((await start(world, first)).reply),
      ))
        .status,
      200,
    );
    const steps = [{
      from: 0,
      to: 1,
      script_hash: "d".repeat(64),
      description: "add the events table (drops nothing)",
    }];
    const migrating = await prepare(world, {
      data_schema: 1,
      data_changes: steps,
    });
    const record = (route: string, body: unknown) =>
      call(
        world.harness,
        `releases/${route}`,
        world.machine.token,
        command(body),
      );
    const restoreBody = (seq: string, backup: string) => ({
      result: {
        release: migrating,
        activation_seq: seq,
        invocation: null,
        data_schema: 0,
        integrity_ok: true,
      },
      backup_hash: backup,
    });

    // 시도 1: backup 뒤 변경까지 갔지만 복원하고 실패한다.
    const failed = startedSeq(
      (await start(world, migrating, { schema: 0 })).reply,
    );
    assertEquals(
      (await record("record_backup", {
        release: migrating,
        activation_seq: failed,
        backup_hash: "e".repeat(64),
        data_schema: 0,
      })).status,
      200,
    );
    assertEquals(
      (await record("record_data_restore", restoreBody(failed, "e".repeat(64))))
        .status,
      200,
    );
    assertEquals(
      (await record("fail_activation", {
        release: migrating,
        started_seq: failed,
        failure: { code: "start_failed", summary: "the new app did not start" },
      })).status,
      200,
    );

    // 시도 2: 새 approval로 다시 시작해 변경이 적용되고 채택된다.
    const applied = startedSeq(
      (await start(world, migrating, { schema: 0 })).reply,
    );
    const invocation = "inv_01h455vb4pex5v6nkc6gd5fdw1";
    await record("record_backup", {
      release: migrating,
      activation_seq: applied,
      backup_hash: "f".repeat(64),
      data_schema: 0,
    });
    await record("record_data_change", {
      result: {
        release: migrating,
        activation_seq: applied,
        invocation,
        data_schema: 1,
        integrity_ok: true,
      },
    });
    assertEquals(
      (await complete(world, migrating, applied, { schema: 1, invocation }))
        .status,
      200,
    );

    const sql = {
      get: (query: string, params: (string | number)[]) =>
        inspect(world.harness, query, params)[0] as never,
      all: (query: string, params: (string | number)[]) =>
        inspect(world.harness, query, params) as never,
    };
    const history = loadMigrationHistory(sql, world.app);
    // 변경이 없던 첫 시도는 migration이 아니다. 두 시도가 시도 순서로 나온다.
    assertEquals(history.length, 2);
    const [one, two] = history;
    assertEquals([one.release, one.started_seq], [migrating, failed]);
    assertEquals([one.from, one.to], [0, 1]);
    assertEquals(one.steps, [{
      from: 0,
      to: 1,
      description: "add the events table (drops nothing)",
    }]);
    assertEquals(one.backup?.hash, "e".repeat(64));
    assertEquals(one.change, null);
    assertEquals(one.restore?.backup_hash, "e".repeat(64));
    assertEquals(one.restore?.data_schema, 0);
    assertEquals(one.result, "restored");
    assert(one.started_at.length > 0 && one.backup!.at.length > 0);
    assert(one.finished_at !== null);

    assertEquals([two.release, two.started_seq], [migrating, applied]);
    assertEquals(two.backup?.hash, "f".repeat(64));
    assertEquals(two.change?.invocation, invocation);
    assertEquals(two.change?.data_schema, 1);
    assertEquals(two.restore, null);
    assertEquals(two.result, "applied");
    assert(two.finished_at !== null);
  });
});

Deno.test("apps/releases#R15: 재시작 점검은 진행 중으로 남은 activation을 추정 없이 unknown과 근거로 낸다", () => {
  const ledger = releasesLedger();
  try {
    const insert = (
      id: string,
      number: number,
      status: string,
      activation: unknown,
    ) =>
      ledger.db.prepare(
        `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
           data_schema, data_changes, ticket_source, created_by, created_at, status,
           activation, failure, blueprint, declarations)
         VALUES (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'machine', 'at', ?, ?, ?, '{}', '{}')`,
      ).run(
        id,
        APP,
        number,
        "a".repeat(40),
        "b".repeat(64),
        "c".repeat(64),
        status,
        activation === null ? null : JSON.stringify(activation),
        status === "failed" ? '{"code":"x","summary":"y"}' : null,
      );
    const attempt = (seq: string, backup: string | null) => ({
      started_seq: seq,
      previous_release: null,
      approval: "apr_01h455vb4pex5v6nkc6gd5fdw1",
      expected_grants_seq: 0,
      expected_schema: 0,
      backup_hash: backup,
      data_change_invocation: null,
    });
    insert("rel_01h455vb4pex5v6nkc6gd5fdw1", 1, "prepared", null);
    insert(
      "rel_01h455vb4pex5v6nkc6gd5fdw2",
      2,
      "activating",
      attempt("7", null),
    );
    insert(
      "rel_01h455vb4pex5v6nkc6gd5fdw3",
      3,
      "failed",
      attempt("5", "e".repeat(64)),
    );
    const observed = observeReleaseActivations(ledger.snapshot().sql, "now");
    assertEquals(observed, [{
      target: "rel_01h455vb4pex5v6nkc6gd5fdw2",
      baseSeq: "7",
      outcome: "unknown",
      evidence: [
        "releases:rel_01h455vb4pex5v6nkc6gd5fdw2:activating",
        "releases:rel_01h455vb4pex5v6nkc6gd5fdw2:started_seq:7",
        "releases:rel_01h455vb4pex5v6nkc6gd5fdw2:backup:none",
      ],
      reason: "activation_not_settled",
    }]);
  } finally {
    ledger.close();
  }
});
