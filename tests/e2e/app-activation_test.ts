// 세 질문
// - contract: boundary `app-releases`·`app-data`(migration 전에 복구본을 ledger에 확정하고, 실패하면 복원하고 이전 release를
//   다시 띄운다. 실패 기록과 event는 같은 tx. 더 새 release가 시작되면 이전 보류 request를 취소한다. 허락은 접수와 적용이
//   따로라 재시작에 다시 적용한다), `approvals`(선언이 넓어지면 다시 묻는다), `events`(실패가 program -> App Engineer
//   reaction으로 이어진다).
// - 현실적 회귀: migration이 실패했는데 data가 반쯤 바뀐 채 남는 것, 이전 release가 안 뜨는 것, 실패 기록이 없거나 App
//   Engineer가 모르는 것(두 번 이상 고친 흔적: archived/activation.md의 끊긴 시도·복구본 보존), 선언이 넓어졌는데 묻지 않고
//   올리는 것, 허락이 재시작에 사라져 적용 안 되는 것.
// - 왜 지금 test가 못 잡나: 순서와 복원은 unit이 일부 있지만 이전 process 종료 확인, 실제 DB 복원, 새 process 준비 모드,
//   허락의 재적용은 process를 건너야 한다.
//
// fake 대답: App Engineer의 ticket_create·call·ticket_verify는 앱 activation helper(`deliverRelease`)가 거는 것이라 행의 fake
// 대답 상한(3)에 세지 않는다(README 정한 것 11). 행마다 줄을 새로 걸어야 하므로 `fake.reset()`을 먼저 한다(그래야 helper가
// journal에서 이번 ticket을 고른다). 실패한 release의 reaction turn은 새 session이라 기본 줄이 받고, 거기 text 1개를 건다.
//
// 한 Deno.test, core 하나, 앱 하나. `rewind-not-across-release` 이후 행은 앞 행이 만든 release를 이어 쓰므로 표 순서대로 돈다.
// 모든 release는 처음 commit(v1)에 patch를 얹어 만든다.
import { assert, assertEquals } from "@std/assert";
import {
  activationActivatePrevious,
  activationsCompare,
  activationsQueue,
  releasesGetRecord,
} from "../../packages/protocol/apps/activation/activation.ts";
import {
  appCallTool,
  appGet,
  appInvocation,
  appRewindPlan,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import {
  approvalsDecide,
  approvalsPending,
} from "../../packages/protocol/approvals/mod.ts";
import {
  activateTestApp,
  approveActivation,
  deliverRelease,
  type TestApp,
  verifyTicket,
  waitRunning,
} from "../support/app/activate.ts";
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
import { amendAppSource, type AppPatch } from "../support/app/source.ts";
import { appCoreEnv } from "../support/coding/deps.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { connectFakeProvider, until } from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { connectGateway, type Gateway } from "../support/gateway/mod.ts";
import { reportHarness } from "../support/gateway/shell.ts";

const person = { kind: "person", view_session: "e2e" } as const;

function call(core: Core, app: string, api: string, input?: unknown) {
  return core.call(appCallTool, {
    target: { mode: "live", app, release: null },
    tool: api,
    ...(input === undefined ? {} : { input: input as never }),
    caller: person,
  });
}

async function titles(core: Core, app: string): Promise<string[]> {
  const { outcome } = await call(core, app, "list_items");
  assertEquals(outcome.status, "succeeded");
  if (outcome.status !== "succeeded") return [];
  return (outcome.result as { rows: { title: string }[] }).rows.map((row) =>
    row.title
  ).sort();
}

async function recordOf(core: Core, release: string) {
  const { release: record } = await core.call(releasesGetRecord, { release });
  assert(record !== null);
  return record;
}

async function activeOf(core: Core, app: string): Promise<string | null> {
  return (await core.call(appGet, { app })).app.active_release;
}

// 이 앱의 activation 요청이다. 사람 화면의 대기 목록이 읽는 것과 같다.
async function activationRequests(core: Core, app: string) {
  const { requests } = await core.call(approvalsPending, {});
  return requests.filter((item) =>
    item.intent.target.kind === "activation" && item.intent.target.app === app
  );
}

// 앱 process의 수. 앱 번들 폴더의 진입 파일을 여는 deno process를 /proc에서 센다.
async function appProcesses(core: Core, app: string): Promise<number> {
  const needle = `${core.run.home}/apps/${app}/bundles/`;
  let count = 0;
  for await (const entry of Deno.readDir("/proc")) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      const cmd = await Deno.readTextFile(`/proc/${entry.name}/cmdline`);
      const args = cmd.split("\0");
      if (args.some((arg) => arg.startsWith(needle) && arg.endsWith(".ts"))) {
        count += 1;
      }
    } catch { /* 그사이 끝난 process */ }
  }
  return count;
}

Deno.test("E2E release activation은 실패하면 data와 이전 release를 그대로 두고, 넓어진 선언은 허락으로만 올리며, 재시작을 넘는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  const gateways: Gateway[] = [];
  try {
    const env = await appCoreEnv();
    core = await bootCore(run, { env });
    await connectFakeProvider(core, fake);
    const notes = await activateTestApp(core, fake, {
      name: "Notes",
      slug: "notes",
    });
    gateways.push(notes.gateway);
    let app: TestApp = notes;
    const base = app.commit;
    const v1 = (await activeOf(core, app.app))!;
    const firstWrite = await call(core, app.app, "add_item", { title: "dup" });
    await call(core, app.app, "add_item", { title: "dup" });
    const seeded = ["dup", "dup"];

    // 한 release를 낸다: source를 처음 commit으로 되돌리고 patch를 얹어 `deliverRelease`한다.
    const deliver = async (
      patches: AppPatch[],
      options: { verify?: boolean; reaction?: boolean } = {},
    ) => {
      fake.reset();
      // 실패한 release의 reaction turn은 기본 줄이 받는다.
      if (options.reaction) {
        fake.script([{ reply: { kind: "text", text: "noted" } }]);
      }
      await resetSource(app.source, base);
      let commit = base;
      for (const patch of patches) {
        commit = await amendAppSource(app.source, patch);
      }
      return await deliverRelease(core!, fake, { ...app, commit }, {
        goal: "Make the next release",
        ...(options.verify === undefined ? {} : { verify: options.verify }),
      });
    };

    // 재시작 뒤: 새 core에 Gateway를 다시 붙이고 harness를 알린다. 터미널 frame은 접속한 shell main 하나가 받는다.
    const reboot = async (): Promise<void> => {
      await core!.kill();
      core = await bootCore(run, { env });
      const gateway = await connectGateway(core);
      gateways.push(gateway);
      await reportHarness(core);
      app = { ...app, gateway };
    };

    // fail-keeps-data: v1 data가 있을 때 실패하는 migration. 데이터를 잃지 않고 이전 release가 계속 서빙한다.
    await app.gateway.watch([{ types: ["ReleaseActivationFailed"] }]);
    const failing = await deliver([failingMigrationPatch], { reaction: true });
    const failed = await until("migration release가 failed가 됨", async () => {
      const record = await recordOf(core!, failing.release);
      return record.status === "failed" ? record : undefined;
    });
    // ledger·event
    assertEquals(failed.failure?.code, "migration_failed");
    assert(failed.failure!.summary.length > 0);
    assertEquals(failed.failure?.restored, true);
    const event = await app.gateway.next(
      "event",
      (frame) => frame.event.type === "ReleaseActivationFailed",
    );
    assertEquals(
      (event.event as { subject: string }).subject,
      failing.release,
    );
    // fake: App Engineer가 이 실패를 안다(새 session의 reaction turn이 기본 줄로 온다).
    const reaction = await until("AE reaction turn 요청", () =>
      Promise.resolve(
        fake.journal().find((entry) =>
          entry.lane === null &&
          JSON.stringify(entry.body).includes(failing.release)
        ),
      ));
    assert(JSON.stringify(reaction.body).includes("migration_failed"));
    assertEquals(reaction.mismatch, null);
    // app state: 이전 release가 다시 떠서 data를 그대로 돌려준다.
    assertEquals(await activeOf(core, app.app), v1);
    await until("v1이 다시 답함", async () => {
      const { outcome } = await call(core!, app.app, "list_items");
      return outcome.status === "succeeded" ? true : undefined;
    });
    assertEquals(await titles(core, app.app), seeded);
    const runtime = await core.call(appRuntime, { app: app.app });
    assertEquals(runtime.state.state, "running");
    assertEquals(runtime.observation?.release, v1);

    // widened-asks: 선언이 넓어지면 묻고, 허락 뒤에만 올린다. 앞 release는 안 넓어서 묻지 않았다.
    const widened = await deliver([widenPatch]);
    const asked = await until("activation 요청이 하나 옴", async () => {
      const found = await activationRequests(core!, app.app);
      return found.length === 0 ? undefined : found;
    });
    // route
    assertEquals(asked.length, 1);
    const { comparison } = await core.call(activationsCompare, {
      release: widened.release,
    });
    assertEquals(comparison.added_resources.length, 1);
    // ledger: 허락 전에는 올라가지 않았다.
    assertEquals(await activeOf(core, app.app), v1);
    await approveActivation(core, app, "allow");
    // process
    await waitRunning(core, app, widened.release);
    // ledger
    assertEquals(await activeOf(core, app.app), widened.release);
    assertEquals((await recordOf(core, v1)).status, "superseded");

    // rewind-not-across-release: v1 때의 write는 rewind 대상으로 고를 수 없다.
    const rewind = await core.tryCall(appRewindPlan, {
      app: app.app,
      from_invocation: firstWrite.invocation!,
    });
    assert(!rewind.ok);
    assertEquals(rewind.error.code, "invalid_input");

    // supersedes-pending: 묻는 release A는 허락하지 않고 두고, 안 묻는 더 새 release B가 시작하면 A의 request가 취소된다.
    const pendingRelease = await deliver([widenPatch2]);
    const [stale] = await until("A의 activation 요청이 옴", async () => {
      const found = await activationRequests(core!, app.app);
      return found.length === 0 ? undefined : found;
    });
    assertEquals(stale!.intent.target.kind, "activation");
    const newer = await deliver([codeOnlyPatch]);
    await waitRunning(core, app, newer.release);
    // route: 취소된 request는 더 결정할 수 없고 pending에는 아무것도 없다.
    const late = await core.tryCall(approvalsDecide, {
      request: stale!.id,
      choice: { kind: "allow" },
    });
    assert(!late.ok);
    assertEquals(late.error.code, "conflict");
    assertEquals(await activationRequests(core, app.app), []);
    // ledger
    assertEquals(
      (await recordOf(core, pendingRelease.release)).status,
      "prepared",
    );
    // app state
    assertEquals(await activeOf(core, app.app), newer.release);

    // rollback: 사람이 data schema가 같은 이전 release로 돌아간다. data는 그대로다.
    await core.call(activationActivatePrevious, {
      release: widened.release,
      key: core.ids.newId("key"),
    });
    await waitRunning(core, app, widened.release);
    // ledger
    assertEquals(await activeOf(core, app.app), widened.release);
    assertEquals((await recordOf(core, newer.release)).status, "superseded");
    // app state
    assertEquals(await titles(core, app.app), seeded);
    // route: superseded가 아닌 release로는 돌아갈 수 없다.
    const notBack = await core.tryCall(activationActivatePrevious, {
      release: failing.release,
      key: core.ids.newId("key"),
    });
    assert(!notBack.ok);
    assertEquals(notBack.error.code, "invalid_input");

    // holds-calls: activation 도중 온 호출은 붙잡았다가 새 release가 받는다.
    const slowOne = await deliver([slowReadPatch]);
    await waitRunning(core, app, slowOne.release);
    const swap = await deliver([slowReadPatch, codeOnlyPatch], {
      verify: false,
    });
    // 읽기는 invocation을 남기지 않아 실행 중인 것을 볼 수 없다. 5초 읽기를 먼저 시작해 확인 뒤 activation이 이를 기다리게 한다.
    const slow = call(core, app.app, "delay", { ms: 5000 });
    slow.catch(() => {});
    await verifyTicket(core, fake, app, swap.ticket);
    await until("activation이 drain 중", async () => {
      const { entries } = await core!.call(activationsQueue, { app: app.app });
      return entries.find((item) =>
          item.release === swap.release && item.step === "drain"
        )
        ? true
        : undefined;
    });
    const held = call(core, app.app, "add_item", { title: "held" });
    held.catch(() => {});
    // route: queue가 붙잡은 호출 수를 보인다.
    const heldCalls = await until("붙잡은 호출이 queue에 보임", async () => {
      const { entries } = await core!.call(activationsQueue, { app: app.app });
      const count = entries.find((item) => item.release === swap.release)
        ?.held_calls;
      return count === undefined || count < 1 ? undefined : count;
    });
    assert(heldCalls >= 1);
    // route: 둘 다 실패하지 않고 끝난다.
    const heldDone = await held;
    assertEquals(
      [(await slow).outcome.status, heldDone.outcome.status],
      ["succeeded", "succeeded"],
    );
    // ledger: 붙잡았던 호출은 새 release가 받았다.
    const { invocation } = await core.call(appInvocation, {
      invocation: heldDone.invocation!,
    });
    assertEquals(invocation?.release, swap.release);
    // process
    await waitRunning(core, app, swap.release);
    seeded.push("held");

    // allow-reapplied-after-restart: 허락 직후 core가 죽어도 허락이 적용되어 올라간다. 결정과 kill 사이에 적용이 끼는지는
    // 보장하지 못한다(어느 쪽이든 단정이 같다).
    const reapplied = await deliver([slowReadPatch, widenPatch3]);
    const [request] = await until("activation 요청이 옴", async () => {
      const found = await activationRequests(core!, app.app);
      return found.length === 0 ? undefined : found;
    });
    await core.call(approvalsDecide, {
      request: request!.id,
      choice: { kind: "allow" },
    });
    await reboot();
    await waitRunning(core, app, reapplied.release);
    // ledger
    assertEquals(await activeOf(core, app.app), reapplied.release);
    assertEquals((await recordOf(core, reapplied.release)).status, "active");
    // route: 같은 request가 두 번 적용되지 않았다.
    assertEquals(await activationRequests(core, app.app), []);
    // process
    assertEquals(await appProcesses(core, app.app), 1);

    // restart-resume: activation이 도는 도중 core가 죽어도 반쯤 바뀐 채 남지 않는다.
    const resumed = await deliver([slowReadPatch, codeOnlyPatch], {
      verify: false,
      reaction: true,
    });
    const slowAgain = call(core, app.app, "delay", { ms: 5000 });
    slowAgain.catch(() => {});
    await verifyTicket(core, fake, app, resumed.ticket);
    await until("activation이 drain 중", async () => {
      const { entries } = await core!.call(activationsQueue, { app: app.app });
      return entries.find((item) =>
          item.release === resumed.release && item.step === "drain"
        )
        ? true
        : undefined;
    });
    await reboot();
    const closed = await until("activation이 닫힘", async () => {
      const record = await recordOf(core!, resumed.release);
      return record.status === "active" || record.status === "failed"
        ? record
        : undefined;
    });
    // ledger: 활성 release가 하나이고 status와 맞다.
    const settledActive = await activeOf(core, app.app);
    assertEquals(
      settledActive,
      closed.status === "active" ? resumed.release : reapplied.release,
    );
    // process
    await waitRunning(core, app, settledActive!);
    assertEquals(await appProcesses(core, app.app), 1);
    // app state
    assertEquals(await titles(core, app.app), seeded);

    // rollback 거절: schema가 다른 release로는 돌아갈 수 없다. migration이 성공하는 release로 schema를 올린 뒤 시험한다.
    const migrated = await deliver([okMigrationPatch]);
    await waitRunning(core, app, migrated.release);
    assertEquals((await recordOf(core, migrated.release)).data_schema, 2);
    const back = await core.tryCall(activationActivatePrevious, {
      release: reapplied.release,
      key: core.ids.newId("key"),
    });
    assert(!back.ok);
    assertEquals(back.error.code, "invalid_input");
    assertEquals(await titles(core, app.app), seeded);
  } finally {
    for (const gateway of gateways) await gateway.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
