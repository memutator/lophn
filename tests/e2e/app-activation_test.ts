// 세 질문
// - contract: boundary `app-releases`·`app-data`(migration 전에 복구본을 확정하고, 실패하면 복원하고 이전 release를 다시
//   띄운다. 실패 기록은 fail 한 tx이고 `release.activate`가 그것을 돌려준다. 더 새 release의 activation이 시작되면 이전 동의
//   줄을 닫는다. 허락은 표에 남아 재시작에 다시 적용된다), `event-stream`(동의 줄이 닫히면 `ActivationConsentClosed`).
// - 현실적 회귀: migration이 실패했는데 data가 반쯤 바뀐 채 남는 것, 이전 release가 안 뜨는 것, 실패 이유가 앱 place session에
//   안 닿는 것(두 번 이상 고친 흔적: archived/activation.md의 끊긴 시도·복구본 보존), 넓어진 선언을 묻지 않고 올리는 것,
//   낡은 동의가 새 release에 쓰이는 것, 허락이 재시작에 사라져 적용 안 되는 것.
// - 왜 지금 test가 못 잡나: 순서와 복원은 unit이 일부 있지만 이전 process 종료 확인, 실제 DB 복원, 새 process 준비 모드,
//   허락의 재적용은 process를 건너야 한다.
//
// fake 대답: 행의 fake 대답은 앱 activation helper(`deliverRelease`, `prepareRelease`, `activateRelease`)가 거는 앱 place session의
// `release prepare`·`release activate`뿐이라 행 상한(3)에 세지 않는다(`architecture/testing.md` "case 고르는 규칙" 4).
//
// 한 test, core 하나, 앱 하나. `rewind-not-across-release` 이후 행은 앞 행이 만든 release를 이어 쓰므로 표 순서대로 돈다.
// 모든 release는 처음 commit(v1)에 patch를 얹어 만든다.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  activationActivatePrevious,
  activationsQueue,
  releasesGetRecord,
} from "../../packages/protocol/apps/activation/activation.ts";
import {
  activationConsent,
  activationConsents,
} from "../../packages/protocol/apps/activation/consent.ts";
import {
  appCallTool,
  appGet,
  appInvocation,
  appRewindPlan,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import {
  activateRelease,
  activateTestApp,
  approveActivation,
  deliverRelease,
  prepareRelease,
  waitRunning,
} from "../support/app/activate.ts";
import { appCoreEnv } from "../support/app/deps.ts";
import {
  codeOnlyPatch,
  failingMigrationPatch,
  okMigrationPatch,
  resetSource,
  slowReadPatch,
  widenPatch,
  widenPatch2,
  widenPatch3,
} from "../support/app/patch-migration.ts";
import { type AppPatch, amendAppSource } from "../support/app/source.ts";
import { connectFakeProvider, settle, until } from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { connectGateway, type Gateway } from "../support/gateway/mod.ts";

const person = { kind: "person", view_session: "e2e" } as const;

function call(core: Core, app: string, tool: string, input?: unknown) {
  return core.call(appCallTool, {
    target: { mode: "live", app, release: null },
    kind: "command",
    name: tool,
    ...(input === undefined ? {} : { input: input as never }),
    caller: person,
  });
}

async function titles(core: Core, app: string): Promise<string[]> {
  const { outcome } = await call(core, app, "list_items");
  assert.deepStrictEqual(outcome.status, "succeeded");
  if (outcome.status !== "succeeded") return [];
  return (outcome.result as { rows: { title: string }[] }).rows
    .map((row) => row.title)
    .sort();
}

async function recordOf(core: Core, release: string) {
  const { release: record } = await core.call(releasesGetRecord, { release });
  assert.ok(record !== null);
  return record;
}

async function activeOf(core: Core, app: string): Promise<string | null> {
  return (await core.call(appGet, { app })).app.active_release;
}

// 앱 process의 수. 앱 번들 폴더의 진입 파일을 여는 process를 /proc에서 센다.
async function appProcesses(core: Core, app: string): Promise<number> {
  const needle = `${core.run.home}/apps/${app}/bundles/`;
  let count = 0;
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      const cmd = await readFile(`/proc/${entry.name}/cmdline`, "utf8");
      const args = cmd.split("\0");
      if (args.some((arg) => arg.startsWith(needle) && arg.endsWith(".ts"))) {
        count += 1;
      }
    } catch {
      /* 그사이 끝난 process */
    }
  }
  return count;
}

test("E2E release activation은 실패하면 data와 이전 release를 그대로 두고, 넓어진 선언은 허락으로만 올리며, 재시작을 넘는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  let gateway: Gateway | undefined;
  try {
    const env = await appCoreEnv();
    core = await bootCore(run, { env });
    await connectFakeProvider(core, fake);
    const app = await activateTestApp(core, fake, {
      name: "Notes",
      slug: "notes",
    });
    const base = app.commit;
    const v1 = (await activeOf(core, app.app))!;
    const firstWrite = await call(core, app.app, "add_item", { title: "dup" });
    await call(core, app.app, "add_item", { title: "dup" });
    const seeded = ["dup", "dup"];
    // 재시작 뒤 행은 event를 보지 않아 이 연결은 다시 열지 않는다.
    gateway = await connectGateway(core, {
      conditions: [{ types: ["ActivationConsentClosed"] }],
    });

    // source를 처음 commit으로 되돌리고 patch를 얹는다.
    const amend = async (patches: AppPatch[]) => {
      await resetSource(app.source, base);
      for (const patch of patches) await amendAppSource(app.source, patch);
    };
    // 한 release를 낸다: 앱 place의 lophn이 prepare → activate를 부른다.
    const deliver = async (patches: AppPatch[]) => {
      await amend(patches);
      return await deliverRelease(core!, fake, app, {
        goal: "Make the next release",
      });
    };
    // 준비까지만 한다. 올리는 것은 `activateRelease`가 따로 한다.
    const prepareOnly = async (patches: AppPatch[]) => {
      await amend(patches);
      const prepared = await prepareRelease(core!, fake, app);
      if (prepared.status !== "prepared") {
        throw new Error(
          `release 준비가 ${prepared.stage}에서 떨어졌다: ${prepared.reason}`,
        );
      }
      return prepared.release.id;
    };
    // runtime이 ready여야 다음 앱 place session turn이 끊기지 않는다.
    const reboot = async (): Promise<void> => {
      await core!.kill();
      core = await bootCore(run, { env });
      await settle(core);
    };
    const waitDrain = (release: string) =>
      until("activation이 drain 중", async () => {
        const { entries } = await core!.call(activationsQueue, {
          app: app.app,
        });
        return entries.find(
          (item) => item.release === release && item.step === "drain",
        )
          ? true
          : undefined;
      });

    // fail-keeps-data: v1 data가 있을 때 실패하는 migration. 데이터를 잃지 않고 이전 release가 계속 서빙한다.
    const failing = await deliver([failingMigrationPatch]);
    // route(tool 결과): `release activate`가 activation의 끝을 기다려 실패와 그 이유를 돌려준다.
    assert.ok(failing.activated.status === "failed");
    assert.deepStrictEqual(failing.activated.failure.code, "migration_failed");
    assert.deepStrictEqual(failing.activated.failure.restored, true);
    assert.ok(
      failing.activated.failure.summary.includes("step 1-2 was rolled back"),
    );
    assert.ok(
      failing.activated.failure.summary.includes("UNIQUE constraint failed"),
    );
    // ledger: release 기록의 failure가 tool 결과와 같다.
    const failed = await recordOf(core, failing.release);
    assert.deepStrictEqual(failed.status, "failed");
    assert.deepStrictEqual(failed.failure, failing.activated.failure);
    assert.deepStrictEqual(await activeOf(core, app.app), v1);
    // app state: 이전 release가 다시 떠서 data를 그대로 돌려준다.
    await until("v1이 다시 답함", async () => {
      const { outcome } = await call(core!, app.app, "list_items");
      return outcome.status === "succeeded" ? true : undefined;
    });
    assert.deepStrictEqual(await titles(core, app.app), seeded);
    const runtime = await core.call(appRuntime, { app: app.app });
    assert.deepStrictEqual(runtime.state.state, "running");
    assert.deepStrictEqual(runtime.observation?.release, v1);

    // widened-asks: 선언이 넓어지면 묻고, 허락 뒤에만 올린다. 앞 release는 안 넓어서 묻지 않았다.
    const widened = await deliver([widenPatch]);
    // route: 동의 줄이 하나 있고 넓어진 자원이 하나다.
    assert.deepStrictEqual(widened.activated.status, "waiting_consent");
    const { consents } = await core.call(activationConsents, { app: app.app });
    assert.deepStrictEqual(consents.length, 1);
    assert.deepStrictEqual(consents[0]!.release, widened.release);
    assert.deepStrictEqual(consents[0]!.comparison.added_resources.length, 1);
    // ledger: 허락 전에는 올라가지 않았다.
    assert.deepStrictEqual(await activeOf(core, app.app), v1);
    await approveActivation(core, app, "allow");
    // process
    await waitRunning(core, app, widened.release);
    // ledger
    assert.deepStrictEqual(await activeOf(core, app.app), widened.release);
    assert.deepStrictEqual((await recordOf(core, v1)).status, "superseded");

    // rewind-not-across-release: v1 때의 write는 rewind 대상으로 고를 수 없다.
    const rewind = await core.tryCall(appRewindPlan, {
      app: app.app,
      from_invocation: firstWrite.invocation!,
    });
    assert.ok(!rewind.ok);
    assert.deepStrictEqual(rewind.error.code, "invalid_input");

    // supersedes-pending: 묻는 release A는 허락하지 않고 두고, 안 묻는 더 새 release B가 시작하면 A의 동의 줄이 닫힌다.
    const pending = await deliver([widenPatch2]);
    assert.deepStrictEqual(pending.activated.status, "waiting_consent");
    const [stale] = (await core.call(activationConsents, { app: app.app }))
      .consents;
    assert.ok(stale !== undefined);
    const newer = await deliver([codeOnlyPatch]);
    assert.deepStrictEqual(newer.activated.status, "active");
    await waitRunning(core, app, newer.release);
    // route: 낡은 동의는 쓰이지 않고 동의 줄에는 아무것도 없다.
    const late = await core.tryCall(
      activationConsent,
      { release: pending.release, choice: "allow" },
      { requested_at: stale.requested_at },
    );
    assert.ok(!late.ok);
    assert.deepStrictEqual(late.error.code, "conflict");
    assert.deepStrictEqual(
      (await core.call(activationConsents, { app: app.app })).consents,
      [],
    );
    // event
    const closed = await gateway.next(
      "event",
      (frame) =>
        frame.event.type === "ActivationConsentClosed" &&
        frame.event.subject === pending.release,
    );
    assert.deepStrictEqual(closed.event.payload, {
      app: app.app,
      release: pending.release,
      outcome: "cancelled",
    });
    // ledger
    assert.deepStrictEqual(
      (await recordOf(core, pending.release)).status,
      "prepared",
    );
    // app state
    assert.deepStrictEqual(await activeOf(core, app.app), newer.release);

    // rollback: 사람이 data schema가 같은 이전 release로 돌아간다. data는 그대로다.
    await core.call(activationActivatePrevious, {
      release: widened.release,
      key: core.ids.newId("key"),
    });
    await waitRunning(core, app, widened.release);
    // ledger
    assert.deepStrictEqual(await activeOf(core, app.app), widened.release);
    assert.deepStrictEqual(
      (await recordOf(core, newer.release)).status,
      "superseded",
    );
    // app state
    assert.deepStrictEqual(await titles(core, app.app), seeded);
    // route: superseded가 아닌 release로는 돌아갈 수 없다.
    const notBack = await core.tryCall(activationActivatePrevious, {
      release: failing.release,
      key: core.ids.newId("key"),
    });
    assert.ok(!notBack.ok);
    assert.deepStrictEqual(notBack.error.code, "invalid_input");

    // holds-calls: activation 도중 온 호출은 붙잡았다가 새 release가 받는다.
    const slowOne = await deliver([slowReadPatch]);
    await waitRunning(core, app, slowOne.release);
    const swap = await prepareOnly([slowReadPatch, codeOnlyPatch]);
    // 읽기는 invocation을 남기지 않아 실행 중인 것을 볼 수 없다. 5초 읽기를 먼저 시작하면 앱 place session의 model 요청을 한
    // 번 거친 뒤 activation이 시작되어 drain이 그 읽기를 기다린다.
    const slow = call(core, app.app, "delay", { ms: 5000 });
    slow.catch(() => {});
    const activating = activateRelease(core, fake, app, swap);
    activating.catch(() => {});
    await waitDrain(swap);
    const held = call(core, app.app, "add_item", { title: "held" });
    held.catch(() => {});
    // route: queue가 붙잡은 호출 수를 보인다.
    const heldCalls = await until("붙잡은 호출이 queue에 보임", async () => {
      const { entries } = await core!.call(activationsQueue, { app: app.app });
      const count = entries.find((item) => item.release === swap)?.held_calls;
      return count === undefined || count < 1 ? undefined : count;
    });
    assert.ok(heldCalls >= 1);
    // route: 둘 다 실패하지 않고 끝나고 activation도 올라간다.
    const heldDone = await held;
    assert.deepStrictEqual(
      [(await slow).outcome.status, heldDone.outcome.status],
      ["succeeded", "succeeded"],
    );
    assert.deepStrictEqual((await activating).status, "active");
    // ledger: 붙잡았던 호출은 새 release가 받았다.
    const { invocation } = await core.call(appInvocation, {
      invocation: heldDone.invocation!,
    });
    assert.deepStrictEqual(invocation?.release, swap);
    // process
    await waitRunning(core, app, swap);
    seeded.push("held");

    // allow-reapplied-after-restart: 허락 직후 core가 죽어도 허락이 적용되어 올라간다. 결정과 kill 사이에 적용이 끼는지는
    // 보장하지 못한다(어느 쪽이든 단정이 같다).
    const reapplied = await deliver([slowReadPatch, widenPatch3]);
    assert.deepStrictEqual(reapplied.activated.status, "waiting_consent");
    await approveActivation(core, app, "allow");
    await reboot();
    await waitRunning(core, app, reapplied.release);
    // ledger
    assert.deepStrictEqual(await activeOf(core, app.app), reapplied.release);
    assert.deepStrictEqual(
      (await recordOf(core, reapplied.release)).status,
      "active",
    );
    // route: 같은 동의가 두 번 적용되지 않았다.
    assert.deepStrictEqual(
      (await core.call(activationConsents, { app: app.app })).consents,
      [],
    );
    // process
    assert.deepStrictEqual(await appProcesses(core, app.app), 1);

    // restart-resume: activation이 도는 도중 core가 죽어도 반쯤 바뀐 채 남지 않는다.
    const resumed = await prepareOnly([slowReadPatch, codeOnlyPatch]);
    const slowAgain = call(core, app.app, "delay", { ms: 5000 });
    slowAgain.catch(() => {});
    // 그 앱 place session turn은 kill에 끊긴다.
    const resuming = activateRelease(core, fake, app, resumed).catch(
      () => undefined,
    );
    await waitDrain(resumed);
    await reboot();
    const settledRecord = await until("activation이 닫힘", async () => {
      const record = await recordOf(core!, resumed);
      return record.status === "active" || record.status === "failed"
        ? record
        : undefined;
    });
    // ledger: 활성 release가 하나이고 status와 맞다.
    const settledActive = await activeOf(core, app.app);
    assert.deepStrictEqual(
      settledActive,
      settledRecord.status === "active" ? resumed : reapplied.release,
    );
    // process
    await waitRunning(core, app, settledActive!);
    assert.deepStrictEqual(await appProcesses(core, app.app), 1);
    // app state
    assert.deepStrictEqual(await titles(core, app.app), seeded);
    await resuming;
    await slowAgain.catch(() => {});

    // rollback-refused: schema가 다른 release로는 돌아갈 수 없다. migration이 성공하는 release로 schema를 올린 뒤 시험한다.
    const migrated = await deliver([okMigrationPatch]);
    await waitRunning(core, app, migrated.release);
    // ledger
    assert.deepStrictEqual(
      (await recordOf(core, migrated.release)).data_schema,
      2,
    );
    // route
    const back = await core.tryCall(activationActivatePrevious, {
      release: reapplied.release,
      key: core.ids.newId("key"),
    });
    assert.ok(!back.ok);
    assert.deepStrictEqual(back.error.code, "invalid_input");
    // app state
    assert.deepStrictEqual(await titles(core, app.app), seeded);
  } finally {
    await gateway?.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
