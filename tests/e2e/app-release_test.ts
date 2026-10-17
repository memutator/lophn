// 세 질문
// - contract: boundary `app-releases`·`app-tickets`·`app-runtime`(ticket -> claim -> 준비 -> 확정 -> 보고 -> 확인 -> activation -> 앱 process
//   순서가 제품의 길로 끝까지 간다), `external-coding-agent`·`coding-agent-cli-interface`(coding agent는 token + CLI로만 닿는다).
// - 현실적 회귀: 새 data root에서 template 앱의 release 준비가 깨지는 것(sdk 사본이 없다, file 수 상한 10,000에 걸린다, 화면이 둘
//   이상인 앱의 `app.js.map`에 `mappings`가 없다, sdk package가 catalog에 없다), 준비/확정/보고 단계 중 하나가 CLI에서 끊기는 것,
//   activation이 앱 process를 못 띄우는 것.
// - 왜 지금 test로 못 잡나: 각 닫음이 "실제 template 앱으로 손으로 확인하지 않았다"였다. 이 길을 지나는 test가 없고 unit은 단계
//   하나씩만 본다.
//
// fake 대답: App Engineer의 ticket_create·call·ticket_verify는 앱 activation helper(`deliverRelease`)가 거는 것이라 행의 fake
// 대답 상한(3)에 세지 않는다(README 정한 것 11).
import { assert, assertEquals } from "@std/assert";
import { releasesGetRecord } from "../../packages/protocol/apps/activation/activation.ts";
import {
  appCallApi,
  appGet,
  appRuntime,
  RELEASE_FILE_MAX_COUNT,
} from "../../packages/protocol/apps/mod.ts";
import { approvalsPending } from "../../packages/protocol/approvals/mod.ts";
import {
  approveActivation,
  deliverRelease,
  startTestApp,
  verifyTicket,
  waitRunning,
} from "../support/app/activate.ts";
import { projectScopePatch } from "../support/app/patches.ts";
import { appCoreEnv } from "../support/coding/deps.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { connectFakeProvider, until } from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory) count += await countFiles(`${dir}/${entry.name}`);
    else if (entry.isFile) count += 1;
  }
  return count;
}

// 이 앱의 activation 요청이다. 사람 화면의 대기 목록이 읽는 것과 같다.
async function activationRequests(core: Core, app: string) {
  const { requests } = await core.call(approvalsPending, {});
  return requests.filter((item) =>
    item.intent.target.kind === "activation" && item.intent.target.app === app
  );
}

Deno.test("E2E template 앱이 제품의 길로 release 준비를 지나 확인 뒤 첫 activation 허락으로만 뜨고, 거절하면 뜨지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  const gateways: { close(): Promise<void> }[] = [];
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);

    // needs-verify-then-first-asks: 준비만으로는 시작하지 않고, 확인이 있어야 요청이 오고, 허락 뒤에만 뜬다.
    const first = await startTestApp(core, fake, {
      name: "Notes",
      slug: "notes",
      patch: projectScopePatch,
    });
    gateways.push(first.gateway);
    const delivered = await deliverRelease(core, fake, first, {
      goal: "Make the first release of the notes app",
      verify: false,
    });
    // ledger
    assertEquals(
      (await core.call(appGet, { app: first.app })).app.active_release,
      null,
    );
    // route
    assertEquals(await activationRequests(core, first.app), []);
    await verifyTicket(core, fake, first, delivered.ticket);
    const asked = await until("activation 요청이 하나 옴", async () => {
      const found = await activationRequests(core!, first.app);
      return found.length === 0 ? undefined : found;
    });
    assertEquals(asked.length, 1);
    // process
    assert(
      (await core.call(appRuntime, { app: first.app })).state.state !==
        "running",
      "허락 전에 앱 process가 떴다",
    );
    await approveActivation(core, first, "allow");
    const observed = await waitRunning(core, first, delivered.release);

    // disk: 제품이 새 data root에 깐 bundle 사본과 sdk 사본
    const record = (await core.call(releasesGetRecord, {
      release: delivered.release,
    })).release;
    assert(record !== null);
    const bundle =
      `${core.run.home}/apps/${first.app}/bundles/${record.bundle_hash}`;
    assert((await countFiles(bundle)) < RELEASE_FILE_MAX_COUNT);
    assert((await Deno.stat(`${bundle}/screens/items/main.js.map`)).isFile);
    assertEquals(
      (await Deno.stat(`${core.run.home}/sdk/ui/1.0.0`)).mode! & 0o222,
      0,
    );
    // ledger
    assertEquals(record.status, "active");
    assertEquals(
      (await core.call(appGet, { app: first.app })).app.active_release,
      delivered.release,
    );
    // process: 앱 process가 실제로 답했다
    assertEquals(observed.ready, true);
    const called = await core.call(appCallApi, {
      target: { mode: "live", app: first.app, release: null },
      api: "list_items",
      caller: { kind: "person", view_session: "e2e" },
    });
    assertEquals(called.outcome.status, "succeeded");

    // first-activation-rejected: 첫 activation을 거절하면 앱은 뜨지 않고 release는 prepared로 남는다.
    // 터미널 frame은 접속한 shell main 하나가 받으므로 앞 앱의 Gateway를 닫고 둘째 앱이 새로 붙는다.
    await first.gateway.close();
    gateways.length = 0;
    const second = await startTestApp(core, fake, {
      name: "Todos",
      slug: "todos",
    });
    gateways.push(second.gateway);
    const rejected = await deliverRelease(core, fake, second, {
      goal: "Make the first release of the todos app",
    });
    const { request } = await approveActivation(core, second, "reject");
    // route
    assertEquals(
      (await core.call(approvalsPending, {})).requests.some((item) =>
        item.id === request
      ),
      false,
    );
    // ledger
    assertEquals(
      (await core.call(appGet, { app: second.app })).app.active_release,
      null,
    );
    assertEquals(
      (await core.call(releasesGetRecord, { release: rejected.release }))
        .release?.status,
      "prepared",
    );
    // process
    assertEquals(
      (await core.call(appRuntime, { app: second.app })).observation,
      null,
    );
  } finally {
    for (const gateway of gateways) await gateway.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
