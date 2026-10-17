// 세 질문
// - contract: boundary `app-runtime`·`app-data`(앱 write 도중 core나 앱 process가 죽으면 결과 모르는 write는 `unknown`으로
//   닫히고 다시 보내지 않으며, 기록 없는 write가 범위에 있는 rewind는 막힌다), `storage`(두 process가 한 앱 DB를 열지 않는다).
// - 현실적 회귀: 재시작 뒤 invocation이 `running`으로 남아 새 호출이 막히는 것, 모르는 write가 자동으로 다시 가서 두 번 쓰이는 것,
//   옛 앱 process가 남아 새 process와 한 DB를 여는 것(데이터 손상).
// - 왜 지금 test로 못 잡나: `closeUnfinishedInvocations`는 unit으로 볼 수 있어도 core 재시작 ↔ supervisor ↔ 앱 process가 실제로
//   다시 뜨는 것과 두 process가 한 DB를 안 여는 것은 process를 건너야 한다.
//
// fake 대답: 앱 activation helper의 App Engineer 대답뿐이다(README 정한 것 11의 예외).
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { releasesGetRecord } from "../../packages/protocol/apps/activation/activation.ts";
import {
  appApiCallOutputSchema,
  appCallApi,
  type AppInvocation,
  appInvocations,
  appRewindPlan,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import { activateTestApp, type TestApp } from "../support/app/activate.ts";
import { slowPatch } from "../support/app/patch-restart.ts";
import { appCoreEnv } from "../support/coding/deps.ts";
import {
  bootCore,
  type Core,
  createRun,
  type Run,
} from "../support/core/mod.ts";
import { connectFakeProvider, until } from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

const caller = { kind: "person", view_session: "e2e" } as const;

// 앱 process가 죽었을 때 코드가 정한 unknown 이유다. core가 다시 켜진 이유(core_restarted)는 다른 행이 본다.
const unknownReasons: readonly string[] = (appApiCallOutputSchema.shape.outcome
  .options.find((option) => option.shape.status.value === "unknown") as
    | { shape: { reason: { options: readonly string[] } } }
    | undefined)!.shape.reason.options.filter((reason) =>
    reason !== "core_restarted");

// 앱 bundle 경로가 든 cmdline의 process. 앱 process는 env를 비워 띄워지므로 LOPHN_HOME으로는 찾지 못한다. bundle 경로는 run마다
// 다르다.
async function appPids(bundle: string): Promise<number[]> {
  const found: number[] = [];
  for await (const entry of Deno.readDir("/proc")) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      const argv = await Deno.readTextFile(`/proc/${entry.name}/cmdline`);
      if (argv.includes(bundle)) found.push(Number(entry.name));
    } catch { /* 그 사이 끝났다 */ }
  }
  return found;
}

async function nonceOf(core: Core, app: TestApp): Promise<string | undefined> {
  const now = await core.call(appRuntime, { app: app.app });
  const seen = now.observation;
  return now.state.state === "running" && seen !== null && seen.ready &&
      seen.accepting
    ? seen.process_nonce
    : undefined;
}

// 응답하지 않는 write를 await 없이 시작하고, ledger에 running 항목이 보일 때까지 기다린다.
// 요청이 끊기면 거절로 끝나므로 잡는다(끝나지 않은 요청을 test 밖에 남기지 않는다).
async function startSlowWrite(core: Core, app: TestApp, title: string) {
  const seen = new Set(
    (await core.call(appInvocations, { app: app.app })).invocations.map((
      item,
    ) => item.id),
  );
  let early: unknown;
  const call = core.call(appCallApi, {
    target: { mode: "live", app: app.app, release: null },
    api: "slow_write",
    input: { title },
    caller,
  }).catch((error) => {
    early = String(error);
    return undefined;
  }).then((answered) => {
    early ??= answered;
    return answered;
  });
  const running = await until("slow_write가 running으로 보임", async () => {
    if (early !== undefined) {
      throw new Error(`slow_write가 먼저 끝났다: ${JSON.stringify(early)}`);
    }
    const { invocations } = await core.call(appInvocations, {
      app: app.app,
      effect: "write",
      status: "running",
    });
    return invocations.find((item) => !seen.has(item.id));
  });
  // running은 core가 보내기 전에 남기는 기록이다. 앱이 row를 넣기 전에 죽이면 "다시 보내지 않았다"를 센 수로 볼 수 없다.
  await until(
    "slow_write의 row가 들어감",
    async () => (await countSlow(core, app)) === 1 ? true : undefined,
  );
  return { call, invocation: running.id };
}

async function invocationOf(
  core: Core,
  app: TestApp,
  id: string,
): Promise<AppInvocation> {
  const { invocations } = await core.call(appInvocations, { app: app.app });
  const found = invocations.find((item) => item.id === id);
  assert(found !== undefined, `${id}가 ledger에 없다`);
  return found;
}

async function countSlow(core: Core, app: TestApp): Promise<number> {
  const called = await core.call(appCallApi, {
    target: { mode: "live", app: app.app, release: null },
    api: "count_slow",
    caller,
  });
  assertEquals(
    called.outcome.status,
    "succeeded",
    JSON.stringify(called.outcome),
  );
  const result = (called.outcome as { result: unknown }).result as {
    rows: { count: number }[];
  };
  return result.rows[0]!.count;
}

type Slow = {
  run: Run;
  env: Record<string, string>;
  /** core를 다시 띄우면 바뀐다. */
  core: Core;
  app: TestApp;
  bundle: string;
  /** 지금 떠 있는 앱 process의 nonce. */
  nonce: string;
  pid: number;
};

// 두 행이 같이 쓰는 준비다. 행은 core를 따로 띄우고 앱도 새로 activate한다.
async function withSlowApp(row: (slow: Slow) => Promise<void>): Promise<void> {
  const run = await createRun();
  const fake = await startFakeServer();
  const env = await appCoreEnv();
  let core: Core | undefined;
  let app: TestApp | undefined;
  try {
    core = await bootCore(run, { env });
    await connectFakeProvider(core, fake);
    app = await activateTestApp(core, fake, {
      name: "Slow",
      slug: "slow",
      patch: slowPatch,
    });
    const release = (await core.call(appRuntime, { app: app.app }))
      .observation!.release!;
    const record = (await core.call(releasesGetRecord, { release })).release;
    assert(record !== null);
    const bundle = `${run.home}/apps/${app.app}/bundles/${record.bundle_hash}`;
    const pids = await appPids(bundle);
    assertEquals(pids.length, 1);
    const slow: Slow = {
      run,
      env,
      core,
      app,
      bundle,
      nonce: (await nonceOf(core, app))!,
      pid: pids[0]!,
    };
    try {
      await row(slow);
    } finally {
      core = slow.core;
    }
  } finally {
    await app?.gateway.close().catch(() => {});
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
}

async function newNonce(core: Core, app: TestApp, old: string) {
  return await until("새 process가 running으로 뜸", async () => {
    const now = await nonceOf(core, app);
    return now !== undefined && now !== old ? now : undefined;
  });
}

Deno.test("E2E 앱 write 도중 core가 죽었다 켜지면 그 호출은 unknown으로 닫혀 다시 가지 않고 앱 process는 하나만 뜬다", async () => {
  await withSlowApp(async (slow) => {
    const { app, bundle } = slow;
    const sent = await startSlowWrite(slow.core, app, "one");
    await slow.core.kill();
    await sent.call;
    // core.kill이 확인하는 LOPHN_HOME process에 앱 process는 들지 않으므로 따로 본다. 옛 process가 남으면 새 process와 한 DB를 연다.
    await until(
      "옛 앱 process가 없어짐",
      async () => (await appPids(bundle)).length === 0 ? true : undefined,
    );
    slow.core = await bootCore(slow.run, { env: slow.env });
    const core = slow.core;
    const nonce = await newNonce(core, app, slow.nonce);

    // ledger
    const closed = await invocationOf(core, app, sent.invocation);
    assertEquals(closed.status, "unknown");
    assertEquals(closed.summary["reason"], "core_restarted");
    // route
    assertEquals(
      (await core.call(appRewindPlan, {
        app: app.app,
        from_invocation: sent.invocation,
      })).plan.blocked,
      { reason: "unrecoverable_write", invocation: sent.invocation },
    );
    assertEquals(await countSlow(core, app), 1);
    // process
    const pids = await appPids(bundle);
    assertEquals(pids.length, 1);
    assertNotEquals(pids[0], slow.pid);
    assertNotEquals(nonce, slow.nonce);
  });
});

Deno.test("E2E 앱 write 도중 앱 process만 죽으면 그 호출은 unknown으로 닫혀 다시 가지 않고 새 process가 하나만 뜬다", async () => {
  await withSlowApp(async (slow) => {
    const { core, app, bundle } = slow;
    const sent = await startSlowWrite(core, app, "one");
    Deno.kill(slow.pid, "SIGKILL");
    const answered = await sent.call;
    const nonce = await newNonce(core, app, slow.nonce);

    // ledger: 이유는 부른 쪽에 돌아온 outcome에 있다. ledger summary에는 outcome만 남는다.
    const lost = await invocationOf(core, app, sent.invocation);
    assertEquals(lost.status, "unknown");
    assertEquals(lost.summary["outcome"], "unknown");
    assert(
      answered?.outcome.status === "unknown" &&
        unknownReasons.includes(answered.outcome.reason),
      `unknown 이유가 ${JSON.stringify(answered?.outcome)}`,
    );
    // route
    assertEquals(
      (await core.call(appRewindPlan, {
        app: app.app,
        from_invocation: sent.invocation,
      })).plan.blocked,
      { reason: "unrecoverable_write", invocation: sent.invocation },
    );
    assertEquals(await countSlow(core, app), 1);
    // process: core는 살아 있고(위 호출이 답했다) 새 process가 하나 떴다.
    const pids = await appPids(bundle);
    assertEquals(pids.length, 1);
    assertNotEquals(pids[0], slow.pid);
    assertNotEquals(nonce, slow.nonce);
  });
});
