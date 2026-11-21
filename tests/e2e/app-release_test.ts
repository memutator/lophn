// 세 질문
// - contract: boundary `app-releases`·`app-runtime`·`app-data`(앱 workspace session의 `release.prepare`는 handler 검사까지 지난 것만
//   release 행으로 남기고, preview는 일회용 DB로 돌아 live ledger와 data에 닿지 않고, 첫 activation은 사람의 동의 뒤에만 앱
//   process를 띄운다).
// - 현실적 회귀: 새 data root에서 template 앱의 준비가 깨진다(sdk 사본이 없다, file 수 상한, 화면 map에 `mappings`가 없다),
//   release 행이 handler 검사 전에 생긴다, preview 호출이 live process·ledger·DB로 간다, 거절한 동의 뒤에도 앱이 뜬다.
// - 왜 지금 test로 못 잡나: `release.prepare`를 보는 unit이 없고, 준비 자식 -> 봉인 -> preview launcher -> 앱 process -> 기록은
//   process를 건너야 보인다.
//
// fake 대답: helper(`prepareRelease`, `activateRelease`)가 거는 앱 workspace session 대답은 행 몫에 세지 않는다. preview 단계만 대답
// 둘(tool 넷을 실은 대답 하나와 text)을 건다.
//
// 한 test, core 하나, 앱 둘. 앞 단계의 앱과 release를 다음 단계가 이어 쓰므로 순서대로 돈다.
import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  releasesGetRecord,
  releasesListRecords,
} from "../../packages/protocol/apps/activation/activation.ts";
import { activationConsents } from "../../packages/protocol/apps/activation/consent.ts";
import { appBundleCopy } from "../../packages/protocol/apps/app-storage.ts";
import {
  appCallTool,
  appGet,
  appInvocations,
  appRuntime,
  RELEASE_FILE_MAX_COUNT,
} from "../../packages/protocol/apps/mod.ts";
import { previewsGet } from "../../packages/protocol/apps/previews.ts";
import {
  activateRelease,
  lophnToolResult,
  lophnTurn,
  approveActivation,
  prepareRelease,
  startTestApp,
  waitRunning,
} from "../support/app/activate.ts";
import { appCoreEnv } from "../support/app/deps.ts";
import type { AppPatch } from "../support/app/source.ts";
import { connectFakeProvider } from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { lophnCall } from "../support/fake-server/lophn.ts";

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += await countFiles(`${dir}/${entry.name}`);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

// 선언은 add_item을 선언한 채라 handler 검사(stage `handlers`)에서 떨어진다.
const dropAddItemHandler: AppPatch = async (dir) => {
  const path = `${dir}/src/handlers.ts`;
  const from = `  handle("add_item", addItemHandler(deps));\n`;
  const text = await readFile(path, "utf8");
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await writeFile(path, text.replace(from, ""));
};

test("E2E 앱 workspace의 lophn이 준비하고 preview로 확인한 template 앱은 사람이 동의한 뒤에만 뜨고, preview는 live ledger와 data에 닿지 않으며, 떨어진 준비는 release를 남기지 않는다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    const c = core;
    const notes = await startTestApp(c, fake, { name: "Notes", slug: "notes" });
    let release = "";

    await t.test(
      "prepare-preview: 준비하고 preview로 확인해도 live ledger와 data는 그대로다",
      async () => {
        const prepared = await prepareRelease(c, fake, notes, {
          goal: "Make the first release of the notes app",
        });
        if (prepared.status !== "prepared") {
          throw new Error(
            `준비가 ${prepared.stage}에서 떨어졌다: ${prepared.reason}`,
          );
        }
        release = prepared.release.id;

        let n = 0;
        const id = (name: string) => `pv_${name}_${n}`;
        const previewed = await lophnTurn(
          c,
          fake,
          notes,
          `preview release ${release}`,
          (index) => {
            n = index;
            return [
              {
                reply: {
                  kind: "tool" as const,
                  calls: [
                    lophnCall(id("start"), `preview start ${release}`),
                    lophnCall(
                      id("add"),
                      `preview call ${notes.app} command add_item`,
                      undefined,
                      ["--args", JSON.stringify({ title: "from preview" })],
                    ),
                    lophnCall(
                      id("list"),
                      `preview call ${notes.app} command list_items`,
                    ),
                    lophnCall(id("stop"), `preview stop ${notes.app}`),
                  ],
                },
              },
              { reply: { kind: "text" as const, text: "previewed" } },
            ];
          },
        );

        // fake: 앱 workspace의 lophn이 받은 tool 결과
        const results = Object.fromEntries(
          ["start", "add", "list", "stop"].map((name) => [
            name,
            lophnToolResult(previewed, id(name)),
          ]),
        );
        for (const [name, result] of Object.entries(results)) {
          assert.deepStrictEqual(
            result.status,
            "success",
            `${name}: ${result.code} ${result.summary}`,
          );
        }
        assert.deepStrictEqual(
          (results.start!.content as { ready: boolean }).ready,
          true,
        );
        type Outcome = { outcome: { status: string; result?: unknown } };
        assert.deepStrictEqual(
          (results.add!.content as Outcome).outcome.status,
          "succeeded",
        );
        const listed = (results.list!.content as Outcome).outcome;
        assert.deepStrictEqual(listed.status, "succeeded");
        assert.ok(
          (listed.result as { rows: { title: string }[] }).rows.some(
            (row) => row.title === "from preview",
          ),
        );
        // ledger: preview 호출은 invocation을 남기지 않고 preview는 멈췄다.
        assert.deepStrictEqual(
          (await c.call(appInvocations, { app: notes.app })).invocations,
          [],
        );
        assert.deepStrictEqual(
          (await c.call(previewsGet, { app: notes.app })).observation,
          null,
        );
        // process: preview가 live process를 띄우지 않았다.
        assert.deepStrictEqual(
          (await c.call(appRuntime, { app: notes.app })).observation,
          null,
        );
      },
    );

    await t.test(
      "first-activation-rejected: 첫 activation은 묻고, 거절하면 뜨지 않는다",
      async () => {
        assert.deepStrictEqual(
          (await activateRelease(c, fake, notes, release)).status,
          "waiting_consent",
        );
        const line = await approveActivation(c, notes, "reject");
        assert.deepStrictEqual(line.release, release);
        // route
        assert.deepStrictEqual(
          (await c.call(activationConsents, { app: notes.app })).consents,
          [],
        );
        // ledger
        assert.deepStrictEqual(
          (await c.call(releasesGetRecord, { release })).release?.status,
          "prepared",
        );
        assert.deepStrictEqual(
          (await c.call(appGet, { app: notes.app })).app.active_release,
          null,
        );
        // process
        assert.deepStrictEqual(
          (await c.call(appRuntime, { app: notes.app })).observation,
          null,
        );
      },
    );

    await t.test(
      "activation-allowed: 앱 workspace의 lophn이 다시 올리고 사람이 허락하면 그 release가 뜬다",
      async () => {
        // 거절된 prepared release는 앱 workspace의 lophn이 다시 부르는 것이 제품 길이다.
        assert.deepStrictEqual(
          (await activateRelease(c, fake, notes, release)).status,
          "waiting_consent",
        );
        await approveActivation(c, notes, "allow");
        const observed = await waitRunning(c, notes, release);

        // disk: 제품이 새 data root에 깐 bundle 사본과 sdk 사본
        const record = (await c.call(releasesGetRecord, { release })).release;
        assert.ok(record !== null);
        const bundle = appBundleCopy(c.run.home, notes.app, record.bundle_hash);
        assert.ok((await countFiles(bundle)) < RELEASE_FILE_MAX_COUNT);
        assert.ok((await stat(`${bundle}/screens/items/main.js.map`)).isFile());
        // 판을 박아 두면 SDK를 올릴 때마다 깨진다. 지금 판은 그 SDK 부분의 package.json이 안다.
        const ui = JSON.parse(
          await readFile(
            new URL("../../packages/design/package.json", import.meta.url),
            "utf8",
          ),
        ) as { version: string };
        assert.deepStrictEqual(
          (await stat(`${c.run.home}/sdk/ui/${ui.version}`)).mode & 0o222,
          0,
        );
        // ledger
        assert.deepStrictEqual(record.status, "active");
        assert.deepStrictEqual(
          (await c.call(appGet, { app: notes.app })).app.active_release,
          release,
        );
        // process·data: 앱 process가 실제로 답했고 preview의 쓰기는 live DB에 없다.
        assert.deepStrictEqual(observed.ready, true);
        const live = await c.call(appCallTool, {
          target: { mode: "live", app: notes.app, release: null },
          kind: "command",
          name: "list_items",
          caller: { kind: "person", view_session: "e2e" },
        });
        assert.ok(live.outcome.status === "succeeded");
        assert.deepStrictEqual(
          (live.outcome.result as { rows: { title: string }[] }).rows.some(
            (row) => row.title === "from preview",
          ),
          false,
        );
      },
    );

    await t.test(
      "prepare-failed: 준비가 떨어지면 결과에 stage와 reason이 있고 release 행이 없다",
      async () => {
        const broken = await startTestApp(c, fake, {
          name: "Broken",
          slug: "broken",
          patch: dropAddItemHandler,
        });
        const failed = await prepareRelease(c, fake, broken, {
          goal: "Make the first release of the broken app",
        });
        // fake·route: probe 거절의 reason에 빠진 tool 이름이 실린다.
        assert.ok(failed.status === "failed", JSON.stringify(failed));
        assert.deepStrictEqual(failed.stage, "handlers");
        assert.ok(failed.reason.includes("add_item"), failed.reason);
        // ledger
        assert.deepStrictEqual(
          (await c.call(releasesListRecords, { app: broken.app })).releases,
          [],
        );
        assert.deepStrictEqual(
          (await c.call(appGet, { app: broken.app })).app.active_release,
          null,
        );
      },
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
