// 세 질문
// - contract: boundary `app-runtime`·`app-capability`(앱 process의 권한은 선언과 grant의 교집합이고 앱 code가 어겨도 flag 밖은
//   열리지 않는다).
// - 현실적 회귀: activation 경로가 flag를 넓게 만들어, 앱이 data root의 `secrets.json`을 읽거나 밖에 쓰거나 network로
//   나가는 것(AI가 만든 앱 code의 실수를 막는 마지막 층).
// - 왜 지금 test가 못 잡나: `sandbox-boundary_test.ts`는 flag를 만드는 쪽을 subprocess 한 번으로 본다. 실제 activation을 거친
//   앱 process가 정말 막는지는 안 본다.
//
// fake 대답: Project Manager의 ticket_create·call·ticket_verify는 앱 activation helper(`activateTestApp`)가 거는 것이라 case의
// fake 대답 상한(3)에 세지 않는다(README 정한 것 11). 이 case 자신은 model을 쓰지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  appCallTool,
  appInvocations,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import { activateTestApp } from "../support/app/activate.ts";
import { escapePatch } from "../support/app/patch-sandbox.ts";
import { appCoreEnv } from "../support/coding/deps.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { connectFakeProvider } from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

Deno.test("E2E activate된 앱 process는 선언 밖의 파일 읽기·쓰기와 network에 닿지 못하고 정상 api는 계속 된다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  let gateway: { close(): Promise<void> } | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    // 읽힐 secrets.json이 있게 key 있는 provider를 붙인다.
    await connectFakeProvider(core, fake, { key: "sk-e2e-sandbox-secret" });
    const app = await activateTestApp(core, fake, {
      name: "Escape",
      slug: "escape",
      patch: escapePatch,
    });
    gateway = app.gateway;

    // 막히지 않았다면 닿았을 대상이 실제로 있어야 한다: 읽을 secrets.json, 쓸 수 있는 폴더, 요청을 셀 수 있는 서버.
    const secrets = `${core.run.home}/secrets.json`;
    const before = await Deno.readFile(secrets);
    const outside = `${core.run.work}/outside`;
    await Deno.mkdir(outside);
    const journalBefore = fake.journal().length;
    const nonce = (await core.call(appRuntime, { app: app.app }))
      .observation?.process_nonce;
    assert(nonce !== undefined);

    const call = (api: string, input?: Record<string, string>) =>
      core!.call(appCallTool, {
        target: { mode: "live", app: app.app, release: null },
        tool: api,
        ...(input === undefined ? {} : { input }),
        caller: { kind: "person", view_session: "e2e" },
      });
    const escaped = await call("escape", {
      secrets,
      outside: `${outside}/x.txt`,
      url: `${fake.url}/probe`,
    });
    // route: 세 칸이 모두 막혔고, 정상 api는 그 뒤에도 된다
    const outcome = escaped.outcome;
    assert(outcome.status === "succeeded", JSON.stringify(outcome));
    const rows = (outcome.result as { rows: unknown[] }).rows;
    assertEquals(rows, [{
      secrets: "blocked",
      outside: "blocked",
      url: "blocked",
    }]);
    assertEquals((await call("list_items")).outcome.status, "succeeded");
    const { invocations } = await core.call(appInvocations, { app: app.app });
    assertEquals(invocations.filter((item) => item.status !== "succeeded"), []);

    // process: 권한 오류가 process 죽음이 되지 않았다
    assertEquals(
      (await core.call(appRuntime, { app: app.app })).observation
        ?.process_nonce,
      nonce,
    );
    // disk
    assertEquals([...Deno.readDirSync(outside)], []);
    assertEquals(await Deno.readFile(secrets), before);
    // fake: 앱의 fetch가 닿지 않았다
    assertEquals(
      fake.journal().slice(journalBefore).filter((entry) =>
        entry.path === "/probe"
      ),
      [],
    );
  } finally {
    await gateway?.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
