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
  appCallTool,
  appGet,
  appRuntime,
  RELEASE_FILE_MAX_COUNT,
} from "../../packages/protocol/apps/mod.ts";
import { approvalsPending } from "../../packages/protocol/approvals/mod.ts";
import {
  type AcceptanceCheck,
  ticketShow,
} from "../../packages/protocol/coding-agent/ticket/mod.ts";
import {
  approveActivation,
  deliverRelease,
  startTestApp,
  verifyTicket,
  waitRunning,
} from "../support/app/activate.ts";
import { appCoreEnv } from "../support/coding/deps.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { connectFakeProvider, until } from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { lastToolResult } from "../support/fake-server/probe.ts";

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
    const called = await core.call(appCallTool, {
      target: { mode: "live", app: first.app, release: null },
      tool: "list_items",
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

// App Engineer가 template의 app-api로 건 예시가 ticket 확인의 관문이 되는 길이다. core 하나에 행마다 template 앱을 새로 시작한다.
// - contract: boundary `app-tickets`(examples check는 완료 보고 뒤 돌아 pass일 때만 `ticket.verify`를 통과시킨다), `app-releases`.
// - 현실적 회귀: 예시가 release 준비/test 요청을 지나 돌지 않는다, 틀린 예시인데 verified가 된다.
// - 왜 지금 test로 못 잡나: 관문(unit)과 예시 비교(harness)는 따로 본다. 보고 -> reactor -> app test runner(격리 사본의 앱 process) ->
//   기록 -> verify가 process 경계를 건너 이어지는 것은 여기서만 보인다.
// fake 대답: ticket_create·ticket_verify는 helper가 건다. 행 몫은 없다.
type Example = Extract<AcceptanceCheck, { kind: "examples" }>["steps"][number];
const examplesRows: {
  name: string;
  slug: string;
  expect: Example["expect"];
  result: "pass" | "fail";
  state: "verified" | "reported";
}[] = [
  {
    name: "맞는 예시는 pass가 되어 verified가 된다",
    slug: "right",
    expect: { rows: [], coverage: "complete" },
    result: "pass",
    state: "verified",
  },
  {
    name: "틀린 예시는 fail이 되어 verified가 conflict로 막힌다",
    slug: "wrong",
    expect: { rows: [{ title: "never added" }] },
    result: "fail",
    state: "reported",
  },
];

Deno.test("E2E App Engineer가 건 app-api 예시가 맞아야 ticket이 verified가 된다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  let gateway: { close(): Promise<void> } | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    for (const row of examplesRows) {
      // 터미널 frame은 접속한 shell main 하나가 받으므로 앞 행의 Gateway를 닫고 이 행의 앱이 새로 붙는다.
      await gateway?.close();
      const app = await startTestApp(core, fake, {
        name: row.slug,
        slug: row.slug,
      });
      gateway = app.gateway;
      const delivered = await deliverRelease(core, fake, app, {
        goal: `Make the first release of the ${row.slug} app`,
        verify: false,
        check: {
          kind: "examples",
          steps: [{ tool: "list_items", expect: row.expect }],
        },
      });
      // ledger: 보고 뒤 예시가 돌아 결과가 남는다.
      const checked = await until("예시 결과가 남음", async () => {
        const { ticket } = await core!.call(ticketShow, {
          ticket: delivered.ticket,
        });
        return ticket.check_result ?? undefined;
      }, 120_000);
      assertEquals(checked.result, row.result, row.name);
      await verifyTicket(core, fake, app, delivered.ticket, row.state);
      // route: `verifyTicket`이 tickets/show의 상태를 본다.
      // fake가 받은 요청: 막힌 ticket_verify는 conflict 결과로 App Engineer에게 돌아간다.
      const verifyResult = fake.journal().filter((entry) =>
        entry.lane === `ae-${app.app}`
      ).map((entry) => lastToolResult(entry, "tc_verify") ?? "").join(" ");
      assertEquals(
        verifyResult.includes('"code":"conflict"'),
        row.result === "fail",
        verifyResult,
      );
    }
  } finally {
    await gateway?.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
