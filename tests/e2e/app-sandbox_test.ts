// 세 질문
// - contract: boundary `app-runtime`·`app-capability`(앱 process의 권한은 선언과 grant의 교집합이고 앱 code가 어겨도 flag 밖은
//   열리지 않는다).
// - 현실적 회귀: activation 경로가 flag를 넓게 만들어, 앱이 data root의 `secrets.json`을 읽거나 밖에 쓰거나 network로
//   나가는 것(AI가 만든 앱 code의 실수를 막는 마지막 층).
// - 왜 지금 test가 못 잡나: `sandbox-boundary_test.ts`는 flag를 만드는 쪽을 subprocess 한 번으로 본다. 실제 activation을 거친
//   앱 process가 정말 막는지는 안 본다.
//
// fake 대답: App Engineer의 `release_prepare`·`release_activate`는 앱 activation helper(`activateTestApp`)가 거는 것이라
// case의 fake 대답 상한(3)에 세지 않는다(`architecture/testing.md` "case 고르는 규칙" 4). 이 case 자신은 model을 쓰지 않는다.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  appCallTool,
  appInvocations,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import { activateTestApp } from "../support/app/activate.ts";
import { escapePatch } from "../support/app/patch-sandbox.ts";
import { appCoreEnv } from "../support/app/deps.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { connectFakeProvider } from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

test("E2E activate된 앱 process는 선언 밖의 파일 읽기·쓰기와 network에 닿지 못하고 정상 tool은 계속 된다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    // 읽힐 secrets.json이 있게 key 있는 provider를 붙인다.
    await connectFakeProvider(core, fake, { key: "sk-e2e-sandbox-secret" });
    const app = await activateTestApp(core, fake, {
      name: "Escape",
      slug: "escape",
      patch: escapePatch,
    });

    // 막히지 않았다면 닿았을 대상이 실제로 있어야 한다: 읽을 secrets.json, 쓸 수 있는 폴더, 요청을 셀 수 있는 서버.
    const secrets = `${core.run.home}/secrets.json`;
    const before = await readFile(secrets);
    const outside = `${core.run.work}/outside`;
    await mkdir(outside);
    const journalBefore = fake.journal().length;
    const nonce = (await core.call(appRuntime, { app: app.app })).observation
      ?.process_nonce;
    assert.ok(nonce !== undefined);

    const call = (tool: string, input?: Record<string, string>) =>
      core!.call(appCallTool, {
        target: { mode: "live", app: app.app, release: null },
        tool,
        ...(input === undefined ? {} : { input }),
        caller: { kind: "person", view_session: "e2e" },
      });
    const escaped = await call("escape", {
      secrets,
      outside: `${outside}/x.txt`,
      url: `${fake.url}/probe`,
    });
    // route: 세 칸이 모두 막혔고, 정상 tool은 그 뒤에도 된다
    const outcome = escaped.outcome;
    assert.ok(outcome.status === "succeeded", JSON.stringify(outcome));
    const rows = (outcome.result as { rows: unknown[] }).rows;
    assert.deepStrictEqual(rows, [
      {
        secrets: "blocked",
        outside: "blocked",
        url: "blocked",
      },
    ]);
    assert.deepStrictEqual(
      (await call("list_items")).outcome.status,
      "succeeded",
    );
    const { invocations } = await core.call(appInvocations, { app: app.app });
    assert.deepStrictEqual(
      invocations.filter((item) => item.status !== "succeeded"),
      [],
    );

    // process: 권한 오류가 process 죽음이 되지 않았다
    assert.deepStrictEqual(
      (await core.call(appRuntime, { app: app.app })).observation
        ?.process_nonce,
      nonce,
    );
    // disk
    assert.deepStrictEqual(readdirSync(outside), []);
    assert.deepStrictEqual(await readFile(secrets), before);
    // fake: 앱의 fetch가 닿지 않았다
    assert.deepStrictEqual(
      fake
        .journal()
        .slice(journalBefore)
        .filter((entry) => entry.path === "/probe"),
      [],
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
