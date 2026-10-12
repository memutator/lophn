// activation(apps/releases#R8, R12–R16)을 실제 core(임시 LOPHN_HOME)의 HTTP route로 본다. 시작은 정확한
// 대상 release의 사람 approval을 `/v1/approvals/apply`로 적용해서만 되고 확정·실패·복원 기록은 machine이 보낸다.
// 단계 순서와 끊김은 `testing/activation.ts`의 대역 세계로 본다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  call,
  codeOf,
  command,
  inspect,
} from "../../../../../apps/core/testing/approvals-fixture.ts";
import { runActivation } from "./orchestrator.ts";
import { activationWorld, PREVIOUS } from "../testing/activation.ts";
import { sha256 } from "../testing/mod.ts";
import {
  activeOf,
  approvalId,
  bundleOf,
  complete,
  events,
  grantNetwork,
  prepare,
  recordBackup,
  releaseRow,
  start,
  startedSeq,
  statusOf,
  withWorld,
} from "./world_test.ts";

Deno.test("apps/releases#R8: 사람 approval 없이는 준비된 release가 activating이 되지 않고 대상이 다른 approval도 받지 않으며 재시도에는 새 결정이 필요하다", async () => {
  await withWorld(async (world) => {
    const release = await prepare(world);
    const other = await prepare(world);

    // 직접 부르는 길은 없다. 어느 자격이든 approval 적용만 시작을 낸다.
    const direct = await call(
      world.harness,
      "releases/start_activation",
      world.machine.token,
      command({
        release,
        approval: approvalId(world),
        previous_release: null,
        expected_grants_seq: 0,
        expected_schema: 0,
        key: "direct-start-0001",
      }),
    );
    assertEquals(codeOf(direct), "invalid_input", JSON.stringify(direct.body));

    // 사람이 허락하지 않은 approval은 적용되지 않는다.
    const undecided = await start(world, release, { undecided: true });
    assert(undecided.reply.status >= 400, JSON.stringify(undecided.reply.body));
    assertEquals(statusOf(world, release), "prepared");

    // 다른 release를 허락한 approval로는 이 release를 시작하지 못한다.
    const wrongTarget = await start(world, release, { target: other });
    assertEquals(
      codeOf(wrongTarget.reply),
      "forbidden",
      JSON.stringify(wrongTarget.reply.body),
    );
    assertEquals(statusOf(world, release), "prepared");

    // 정확한 대상의 허락은 activating을 만들고 시작 event의 seq가 시도의 이름이다.
    const first = await start(world, release);
    assertEquals(first.reply.status, 200, JSON.stringify(first.reply.body));
    const seq = startedSeq(first.reply);
    assertEquals(statusOf(world, release), "activating");
    const activation = JSON.parse(
      String(releaseRow(world, release)["activation"]),
    );
    assertEquals(activation.started_seq, seq);
    assertEquals(activation.approval, first.approval);
    assertEquals(events(world, "ReleaseActivationStarted").length, 1);
    assertEquals(
      JSON.parse(String(events(world, "ReleaseActivationStarted")[0].payload))
        .started_seq,
      seq,
    );

    // 실패한 시도의 재시도는 같은 approval을 다시 쓰지 못하고 새 결정을 받는다.
    const failed = await call(
      world.harness,
      "releases/fail_activation",
      world.machine.token,
      command({
        release,
        started_seq: seq,
        failure: { code: "start_failed", summary: "did not start" },
      }),
    );
    assertEquals(failed.status, 200, JSON.stringify(failed.body));
    assertEquals(statusOf(world, release), "failed");
    const replay = await start(world, release, { approval: first.approval });
    assertEquals(statusOf(world, release), "failed");
    assertEquals(replay.reply.status, 200, JSON.stringify(replay.reply.body));
    assertEquals(events(world, "ReleaseActivationStarted").length, 1);
    const retry = await start(world, release);
    assertEquals(retry.reply.status, 200, JSON.stringify(retry.reply.body));
    assertEquals(statusOf(world, release), "activating");
    assertEquals(events(world, "ReleaseActivationStarted").length, 2);
    assert(startedSeq(retry.reply) !== seq);
  });
});

Deno.test("apps/releases#R12: approval 뒤 grant 집합이나 채택 release가 바뀌면 낡은 activation은 시작되지 않는다", async () => {
  await withWorld(async (world) => {
    const release = await prepare(world);
    const stale = await start(world, release, {
      between: async () => {
        const granted = await grantNetwork(world);
        assertEquals(granted.status, 200, JSON.stringify(granted.body));
      },
    });
    assertEquals(
      codeOf(stale.reply),
      "conflict",
      JSON.stringify(stale.reply.body),
    );
    assertEquals(statusOf(world, release), "prepared");
    assertEquals(events(world, "ReleaseActivationStarted").length, 0);

    // 허락 뒤 채택 release가 바뀐 경우도 같다.
    const adopted = await prepare(world);
    const changed = await start(world, release, {
      between: async () => {
        const done = await call(
          world.harness,
          "releases_tests/adopt",
          world.machine.token,
          command({ release: adopted }),
        );
        assertEquals(done.status, 200, JSON.stringify(done.body));
      },
    });
    assertEquals(
      codeOf(changed.reply),
      "conflict",
      JSON.stringify(changed.reply.body),
    );
    assertEquals(statusOf(world, release), "prepared");
  });
});

Deno.test("apps/releases#R13: 앱마다 activation은 하나만 진행하고 그동안 다른 activation과 grant 변경은 거절한다", async () => {
  await withWorld(async (world) => {
    const first = await prepare(world);
    const second = await prepare(world);
    // 둘을 동시에 허락받아 동시에 적용한다. 하나만 진행한다.
    const one = await start(world, first, { undecided: false });
    assertEquals(one.reply.status, 200, JSON.stringify(one.reply.body));
    const other = await start(world, second);
    assertEquals(
      codeOf(other.reply),
      "conflict",
      JSON.stringify(other.reply.body),
    );
    assertEquals(statusOf(world, first), "activating");
    assertEquals(statusOf(world, second), "prepared");
    // 진행 중에는 grant도 바뀌지 않는다.
    const granted = await grantNetwork(world);
    assertEquals(
      codeOf(granted),
      "conflict",
      JSON.stringify(granted.body),
    );
    assertEquals(events(world, "ReleaseActivationStarted").length, 1);
  });
});

Deno.test("apps/releases#R12, R14: 확정은 hash·handler·schema·시도가 맞아야 하고 같은 transaction에서 active 참조·이름·설명·첫 run_enabled와 이전 release 대체를 바꾼다", async () => {
  await withWorld(async (world) => {
    const release = await prepare(world);
    const seq = startedSeq((await start(world, release)).reply);
    const bundle = bundleOf(world, release);
    assertEquals(bundle.length, 64);

    // handler·hash·schema·시도가 맞지 않으면 채택하지 않는다.
    const mismatches: [string, Parameters<typeof complete>[3]][] = [
      ["handler", { attestation: { commands: ["list", "extra"] } }],
      ["hash", { attestation: { bundle_hash: sha256("another bundle") } }],
      ["schema", { attestation: { data_schema: 4 } }],
      ["release", { attestation: { release: PREVIOUS } }],
    ];
    for (const [name, options] of mismatches) {
      const rejected = await complete(world, release, seq, options);
      assert(
        rejected.status >= 400,
        `${name}: ${JSON.stringify(rejected.body)}`,
      );
      assertEquals(statusOf(world, release), "activating", name);
      assertEquals(activeOf(world), null, name);
    }
    const wrongSeq = await complete(world, release, String(Number(seq) + 1));
    assertEquals(codeOf(wrongSeq), "conflict");
    assertEquals(events(world, "ReleaseActivated").length, 0);

    // 모두 맞으면 한 번에 바뀐다.
    const done = await complete(world, release, seq);
    assertEquals(done.status, 200, JSON.stringify(done.body));
    assertEquals(statusOf(world, release), "active");
    const app = inspect(
      world.harness,
      "SELECT name, description, active_release, run_enabled, revision FROM apps WHERE id = ?",
      [world.app],
    )[0];
    assertEquals(app["name"], "Calendar app");
    assert(String(app["description"]).startsWith("Keeps one calendar"));
    assertEquals(app["active_release"], release);
    assertEquals(Number(app["run_enabled"]), 1);
    assertEquals(events(world, "ReleaseActivated").length, 1);
    // 응답을 잃은 재전송은 같은 결과이고 새 event가 없다.
    const again = await complete(world, release, seq);
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(events(world, "ReleaseActivated").length, 1);

    // 다음 release의 확정은 이전 release를 같은 transaction에서 대체한다.
    const next = await prepare(world);
    const nextSeq = startedSeq((await start(world, next)).reply);
    const swapped = await complete(world, next, nextSeq);
    assertEquals(swapped.status, 200, JSON.stringify(swapped.body));
    assertEquals(statusOf(world, release), "superseded");
    assertEquals(statusOf(world, next), "active");
    assertEquals(activeOf(world), next);
    assertEquals(events(world, "ReleaseSuperseded").length, 1);
  });
});

Deno.test("apps/releases#R16, apps/data#R4: 다른 schema의 옛 release는 바로 activation되지 않고 같은 schema의 rollback은 새 activation이며 필요한 변경은 backup 확정과 변경 결과 뒤에만 확정된다", async () => {
  await withWorld(async (world) => {
    const step = {
      from: 0,
      to: 1,
      script_hash: "d".repeat(64),
      description: "add the events table",
    };
    const old = await prepare(world);
    const oldSeq = startedSeq((await start(world, old)).reply);
    assertEquals((await complete(world, old, oldSeq)).status, 200);

    // schema 0 -> 1 변경이 있는 release.
    const migrating = await prepare(world, {
      data_schema: 1,
      data_changes: [step],
    });
    const seq = startedSeq(
      (await start(world, migrating, { schema: 0 })).reply,
    );
    // backup 확정과 변경 결과가 없으면 확정하지 못한다.
    const early = await complete(world, migrating, seq, { schema: 1 });
    assertEquals(codeOf(early), "unavailable", JSON.stringify(early.body));
    const backed = await recordBackup(world, migrating, seq, 0, "backup one");
    assertEquals(backed.reply.status, 200, JSON.stringify(backed.reply.body));
    const invocation = "inv_01h455vb4pex5v6nkc6gd5fdw1";
    const changed = await call(
      world.harness,
      "releases/record_data_change",
      world.machine.token,
      command({
        result: {
          release: migrating,
          activation_seq: seq,
          invocation,
          data_schema: 1,
          integrity_ok: true,
        },
      }),
    );
    assertEquals(changed.status, 200, JSON.stringify(changed.body));
    const activation = JSON.parse(
      String(releaseRow(world, migrating)["activation"]),
    );
    assertEquals(activation.backup_hash, backed.hash);
    assertEquals(activation.data_change_invocation, invocation);
    const done = await complete(world, migrating, seq, {
      schema: 1,
      invocation,
    });
    assertEquals(done.status, 200, JSON.stringify(done.body));
    assertEquals(statusOf(world, old), "superseded");

    // schema 0의 옛 release를 schema 1에서 바로 고르지 못한다.
    const rollback = await start(world, old, { schema: 1 });
    assertEquals(
      codeOf(rollback.reply),
      "invalid_input",
      JSON.stringify(rollback.reply.body),
    );
    assertEquals(statusOf(world, old), "superseded");
    // ledger가 아는 schema와 다른 실제 schema 보고는 conflict다.
    const lying = await start(world, old, { schema: 0 });
    assertEquals(codeOf(lying.reply), "conflict");

    // 같은 schema의 release로의 rollback은 새 activation이다.
    const same = await prepare(world, {
      data_schema: 1,
      data_changes: [step],
    });
    const sameStart = await start(world, same, { schema: 1 });
    assertEquals(
      sameStart.reply.status,
      200,
      JSON.stringify(sameStart.reply.body),
    );
    const sameSeq = startedSeq(sameStart.reply);
    assert(sameSeq !== seq);
    assertEquals(statusOf(world, same), "activating");
    assertEquals(statusOf(world, migrating), "active");
    const finished = await complete(world, same, sameSeq, { schema: 1 });
    assertEquals(finished.status, 200, JSON.stringify(finished.body));
    assertEquals(statusOf(world, migrating), "superseded");
    assertEquals(activeOf(world), same);
  });
});

Deno.test("apps/releases#R15: backup을 확정한 시도는 복원 결과를 확정하기 전에는 실패로 닫히지 않고 실패는 이전 active 참조를 그대로 둔다", async () => {
  await withWorld(async (world) => {
    const old = await prepare(world);
    assertEquals(
      (await complete(world, old, startedSeq((await start(world, old)).reply)))
        .status,
      200,
    );
    const migrating = await prepare(world, {
      data_schema: 1,
      data_changes: [{
        from: 0,
        to: 1,
        script_hash: "d".repeat(64),
        description: "add the events table",
      }],
    });
    const seq = startedSeq(
      (await start(world, migrating, { schema: 0 })).reply,
    );
    const saved = await recordBackup(world, migrating, seq, 0, "backup two");
    const backup = saved.hash;
    assertEquals(saved.reply.status, 200, JSON.stringify(saved.reply.body));
    const failure = { code: "migration_failed", summary: "the change failed" };
    const early = await call(
      world.harness,
      "releases/fail_activation",
      world.machine.token,
      command({ release: migrating, started_seq: seq, failure }),
    );
    assertEquals(codeOf(early), "conflict", JSON.stringify(early.body));
    assertEquals(statusOf(world, migrating), "activating");

    // 복원 결과(실제 schema 0·무결성)를 확정한 뒤에는 실패로 닫힌다. 같은 보고의 재전송은 새 사실이 아니다.
    const restore = command({
      result: {
        release: migrating,
        activation_seq: seq,
        invocation: null,
        data_schema: 0,
        integrity_ok: true,
      },
      backup_hash: backup,
    });
    const restored = await call(
      world.harness,
      "releases/record_data_restore",
      world.machine.token,
      restore,
    );
    assertEquals(restored.status, 200, JSON.stringify(restored.body));
    const again = await call(
      world.harness,
      "releases/record_data_restore",
      world.machine.token,
      { ...restore, idempotency_key: "restore-resend-0001" },
    );
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(events(world, "ReleaseDataRestored").length, 1);
    const closed = await call(
      world.harness,
      "releases/fail_activation",
      world.machine.token,
      command({ release: migrating, started_seq: seq, failure }),
    );
    assertEquals(closed.status, 200, JSON.stringify(closed.body));
    assertEquals(statusOf(world, migrating), "failed");
    assertEquals(activeOf(world), old);
    assertEquals(statusOf(world, old), "active");
    assertEquals(events(world, "ReleaseActivationFailed").length, 1);
  });
});

Deno.test("apps/releases#R13: 이전 자식의 종료를 확인한 뒤에만 새 자식을 띄우고 같은 DB를 둘이 쓰지 않는다", async () => {
  const world = activationWorld({ schema: 0, targetSchema: 1 });
  const outcome = await runActivation(world.ports, world.ledger.release);
  assertEquals(outcome, { status: "active", opened: true });
  const order = world.log;
  assert(
    order.indexOf("supervisor.stopCurrent") <
      order.indexOf("supervisor.startCandidate"),
  );
  assertEquals(order.filter((line) => line.startsWith("VIOLATION")), []);
  // 종료 확인이 늦으면 새 자식도 데이터 작업도 없다.
  const slow = activationWorld({ schema: 0, targetSchema: 1 });
  const release = slow.hold("supervisor.stopCurrent");
  const running = runActivation(slow.ports, slow.ledger.release);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(slow.log, ["supervisor.stopCurrent"]);
  release();
  assertEquals((await running).status, "active");
});

Deno.test("apps/releases#R14: 준비 확인(handler·hash·schema·probe)이 맞지 않으면 active 참조는 그대로이고 통로는 성공 commit 뒤에만 열린다", async () => {
  const mismatches: Record<string, Record<string, unknown>> = {
    handler: { commands: ["list"] },
    hash: { bundle_hash: sha256("another bundle") },
    schema: { data_schema: 7 },
    release: { release: PREVIOUS },
  };
  for (const [name, attestation] of Object.entries(mismatches)) {
    const world = activationWorld({
      schema: 0,
      targetSchema: 1,
      attestation: attestation as never,
    });
    const outcome = await runActivation(world.ports, world.ledger.release);
    assertEquals(outcome.status, "failed", name);
    assertEquals(world.ledger.active, PREVIOUS, name);
    assertEquals(world.ledger.release.status, "failed", name);
    assertEquals(world.log.includes("supervisor.openCandidate"), false, name);
    assertEquals(world.children.candidate, "none", name);
    // 새 업무 전 실패라 변경 전 data로 되돌아간다.
    assertEquals(world.db.schema, 0, name);
    assertEquals(world.db.rows, ["a", "b"], name);
    assertEquals(world.children.reopened, 1, name);
  }
  // probe 자체가 실패하는 경우.
  const probe = activationWorld({ schema: 0, targetSchema: 1 });
  probe.fault("supervisor.startCandidate", "error");
  assertEquals(
    (await runActivation(probe.ports, probe.ledger.release)).status,
    "failed",
  );
  assertEquals(probe.ledger.active, PREVIOUS);
  assertEquals(probe.log.includes("supervisor.openCandidate"), false);
  // 성공은 commit 다음에만 연다.
  const good = activationWorld({ schema: 0, targetSchema: 1 });
  await runActivation(good.ports, good.ledger.release);
  assert(
    good.log.indexOf("core.completeActivation") <
      good.log.indexOf("supervisor.openCandidate"),
  );
  assertEquals(good.ledger.active, good.ledger.release.id);
  assertEquals(good.children.candidate, "open");
});
