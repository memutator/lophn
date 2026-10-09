// apps#T27 flow restore-app-release E2E(docs/flows/restore-app-release.md). 실제 headless shell과 실제
// core·apps supervisor·앱 자식으로 돈다. 앱은 fixture source(todo)를 commit해 봉인한 bundle 두 개이고
// (prepareFromSource), ledger에는 등록 transaction이 남기는 모양으로 앱 행과 release 두 행을 심는다
// (앱 만들기·release 준비 화면은 이 flow의 범위가 아니다). 사람이 하는 조작은 화면(app 공간의 운영
// 패널·app-detail Version 탭과 confirmation window)으로 하고, 사람이 확인하는 결과(지금 Version,
// 실제로 도는 release)는 사람 token의 같은 core 읽기 통로(`window.lophnCore`)로 읽는다. 사람 데이터
// root(~/.lophn)는 열지 않는다. HOME·LOPHN_HOME은 임시 폴더이고 띄운 Electron·core 트리는 정확한 pid로만
// 끝낸다.
//
// 이 시험이 보는 것: flow 1(지금 Version과 돌아갈 Version·당시 결과), flow 3(사람이 정확한 release를
// 확인하고 허락), flow 4·5(기존 자식 종료 확인 뒤 적용·시작 확인), 다른 갈래(사람이 거절·그만둠).
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import { declarationsOfBlueprint } from "../../packages/apps/releases/mod.ts";
import { prepareFromSource } from "../../packages/apps/releases/prepare/from-source.ts";
import { migrateAppDatabase } from "../../packages/apps/data/worker/migrate.ts";
import { sha256Hex } from "../../packages/base/mod.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../packages/apps/sdk/mod.ts";
import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { e2eEnabled } from "../harness.ts";
import {
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
} from "../flow-support.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const OLDER = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const NEWER = "rel_01h455vb4pex5v6nkc6gd5fdw2";
// 두 release 모두 같은 schema다. schema가 다른 release를 적용하지 못하는 갈래는 여기서 돌리지 않는다.
const DATA_SCHEMA = 2;
const FIXTURE = new URL("../../fixtures/apps/todo/", import.meta.url).pathname;

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout).trim();
}

type Bundle = {
  bundleHash: string;
  blueprintHash: string;
  blueprint: string;
  copyPath: string;
};

/** fixture source를 commit하고 봉인 bundle로 준비해 `home` 아래에 둔다. 그 blueprint를 돌려준다. */
async function prepareFixtureApp(
  home: string,
  options: { edit: boolean },
): Promise<Bundle> {
  const installed = await installedHome(["@lophn/cap-fs"]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-e2e-restore-src-" });
  try {
    const dir = `${parent}/app`;
    const config = JSON.parse(
      await Deno.readTextFile(`${FIXTURE}/deno.json.tmpl`),
    ) as { imports: Record<string, string> };
    const files = await readTemplateDirectory(FIXTURE, { stripSuffix: true });
    assert(files.ok, files.ok ? "" : files.error.message);
    for (const file of files.value) {
      const target = `${dir}/${file.path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeFile(target, file.bytes);
    }
    // 새 release의 bundle hash가 옛 release와 달라지도록 source를 고친다.
    if (options.edit) {
      const entry = `${dir}/main.ts`;
      await Deno.writeTextFile(
        entry,
        `${await Deno.readTextFile(entry)}\n// newer release\n`,
      );
    }
    await Deno.mkdir(`${dir}/.lophn`);
    await Deno.writeTextFile(
      `${dir}/.lophn/import-map.json`,
      JSON.stringify(devImportMap(config.imports, installed.sdkRoot, dir)),
    );
    await git(dir, ["init", "-q"]);
    await git(dir, ["config", "user.email", "dev@lophn.local"]);
    await git(dir, ["config", "user.name", "dev"]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "init"]);
    const commit = await git(dir, ["rev-parse", "HEAD"]);
    const prepared = await prepareFromSource({
      dataRoot: home,
      app: APP,
      sourceRoot: dir,
      commit,
      sdkRoot: installed.sdkRoot,
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    return {
      bundleHash: prepared.value.bundleHash,
      blueprintHash: prepared.value.blueprintHash,
      copyPath: prepared.value.copyPath,
      blueprint: await Deno.readTextFile(
        `${prepared.value.copyPath}/blueprint.json`,
      ),
    };
  } finally {
    await removeTree(parent);
    await installed.dispose();
  }
}

/** 봉인 사본의 migration 단계(0-1, 1-2)다. release 준비가 data_changes로 내는 것과 같은 모양이다. */
async function dataChangesOf(bundle: Bundle) {
  const scripts = [];
  for (let from = 0; from < DATA_SCHEMA; from++) {
    const sql = await Deno.readTextFile(
      `${bundle.copyPath}/migrations/${from}-${from + 1}.sql`,
    );
    scripts.push({
      change: {
        from,
        to: from + 1,
        script_hash: await sha256Hex(sql),
        description: `migration ${from}-${from + 1}`,
      },
      sql,
    });
  }
  return scripts;
}

/** 지금 release(새 release)의 activation이 남겼을 앱 DB를 만든다. schema가 DATA_SCHEMA에 있다. */
async function seedAppData(home: string, bundle: Bundle): Promise<void> {
  const dataArea = `${home}/apps/${APP}/data`;
  await Deno.mkdir(`${dataArea}/backups`, { recursive: true });
  const migrated = await migrateAppDatabase({
    dataArea,
    databasePath: `${dataArea}/app.sqlite`,
    backupPath: `${dataArea}/backups/seed`,
    targetSchema: DATA_SCHEMA,
    scripts: await dataChangesOf(bundle),
    appliedAt: "2026-10-02T00:00:00.000Z",
    result: { release: NEWER, activation_seq: "1", invocation: null },
  });
  assert(migrated.ok, migrated.ok ? "" : JSON.stringify(migrated.error));
  assertEquals(migrated.value.result.data_schema, DATA_SCHEMA);
}

/** 등록 transaction이 남기는 모양으로 앱 행과 release 두 행을 심는다(core를 멈춘 동안). */
function seedLedger(home: string, older: Bundle, newer: Bundle): void {
  const db = new DatabaseSync(`${home}/lophn.db`);
  const row = (release: string, bundle: Bundle) => ({
    release,
    blueprint: bundle.blueprint,
    declarations: declarationsOfBlueprint(
      release,
      JSON.parse(bundle.blueprint),
    ),
    bundle,
  });
  try {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'todos', 'Todo', 'A todo app', NULL, NULL, ?, 1, '1', 'active')`,
    ).run(APP, NEWER);
    const insert = db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', NULL, 'machine', ?, ?, NULL, NULL, ?, ?)`,
    );
    for (
      const [number, made, status, at, commit] of [
        [1, row(OLDER, older), "superseded", "2026-10-01T00:00:00.000Z", "a"],
        [2, row(NEWER, newer), "active", "2026-10-02T00:00:00.000Z", "b"],
      ] as const
    ) {
      assert(made.declarations !== undefined, "선언 사실을 만들지 못했다");
      insert.run(
        made.release,
        APP,
        number,
        commit.repeat(40),
        made.bundle.bundleHash,
        made.bundle.blueprintHash,
        DATA_SCHEMA,
        at,
        status,
        made.blueprint,
        JSON.stringify(made.declarations),
      );
      // release row는 유효한 app test 참조를 요구한다(apps/releases#R5).
      db.prepare(
        "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
      ).run(made.release, `vrf_01h455vb4pex5v6nkc6gd5fdw${number}`);
    }
  } finally {
    db.close();
  }
}

/** 사람 token의 앱 읽기. 지금 적용된 release다. */
async function activeRelease(flow: FlowShell): Promise<string | null> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "apps",
    method: "get",
    body: { app: APP },
  });
  return (got.app as { active_release: string | null }).active_release;
}

/** 사람 token의 release 읽기. 준비·적용 상태다. */
async function releaseStatus(
  flow: FlowShell,
  release: string,
): Promise<string> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "releases",
    method: "get",
    body: { release },
  });
  return String((got.release as { status: string }).status);
}

/** 사람 token의 앱 runtime 읽기. 실제로 도는 release와 시작 확인이다. */
async function running(
  flow: FlowShell,
): Promise<{ release: string | null; ready: boolean } | null> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "apps",
    method: "runtime",
    body: { app: APP },
  });
  const observation = got.observation as
    | { release: string | null; mode: string; ready: boolean }
    | null;
  if (observation === null || observation.mode !== "live") return null;
  return { release: observation.release, ready: observation.ready };
}

/** 조건이 참이 될 때까지 사람 token 읽기로 기다린다. */
async function untilTrue(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    last = await check();
    if (last === true) return;
    await delay(500);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

/** 사람이 결정 창을 열었을 때까지(Electron main의 창 목록으로) 기다린다. */
async function untilConfirmationWindow(flow: FlowShell): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const opened = await flow.shell.mainEvaluate(
      `electron.BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes("confirmation/index.html"))`,
    );
    if (opened === true) return;
    await delay(200);
  }
  throw new Error("결정 창이 열리지 않았다");
}

/** 사람이 연 결정 창을 닫는다(창 닫기는 결정이 아니다, confirmation-window#R4). */
async function closeConfirmationWindow(flow: FlowShell): Promise<void> {
  await flow.shell.mainEvaluate(
    `(() => {
      for (const w of electron.BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed() && w.webContents.getURL().includes("confirmation/index.html")) w.close();
      }
      return true;
    })()`,
  );
}

/** 사람이 결정 창을 닫았을 때까지 기다린다. */
async function untilNoConfirmationWindow(flow: FlowShell): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const opened = await flow.shell.mainEvaluate(
      `electron.BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes("confirmation/index.html"))`,
    );
    if (opened !== true) return;
    await delay(200);
  }
  throw new Error("결정 창이 닫히지 않았다");
}

type Page = Awaited<ReturnType<FlowShell["shell"]["connect"]>>;

async function untilPage(
  page: Page,
  expression: string,
  what: string,
  timeoutMs = 30_000,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      last = await page.evaluate(expression);
    } catch (error) {
      last = String(error);
    }
    if (last) return last;
    await delay(200);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

async function pageClick(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assertEquals(clicked, true, `누를 요소가 없다: ${selector}`);
}

const DETAIL = `[data-app-detail="${APP}"]`;

/** 사람이 app-detail의 Version 탭을 연다. */
async function openVersionTab(flow: FlowShell): Promise<void> {
  await flow.click('[data-app-bar="app-details"]');
  await flow.until(
    `document.querySelector(${JSON.stringify(DETAIL)}) !== null`,
    "app-detail이 서지 않았다",
  );
}

/** 창을 다시 읽는다(renderer의 고른 상태를 처음으로 되돌린다). app 공간부터 다시 연다. */
async function reloadAppSpace(flow: FlowShell): Promise<void> {
  await flow.evaluate(`(() => { location.reload(); return true; })()`);
  await delay(500);
  await flow.until(
    `document.querySelector('[data-space="app"]') !== null`,
    "앱 공간이 다시 서지 않았다",
  );
  await openVersionTab(flow);
}

Deno.test({
  name:
    "apps/releases#R8 R9 R16, apps/data#R12, platform/approvals#R5 R4 flow restore-app-release: 이전 Version을 골라 사람이 허락하면 그 release로 바뀌고, 거절·그만둠이면 바뀌지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-restore-app-" });
    await Deno.chmod(home, 0o700);
    // core 한 번을 띄워 DB를 만든 뒤 멈추고, 앱과 release 두 행을 심고 앱 공간부터 다시 연다.
    const first = await openFlowShell({ home });
    await first.close();
    const older = await prepareFixtureApp(home, { edit: false });
    const newer = await prepareFixtureApp(home, { edit: true });
    seedLedger(home, older, newer);
    await seedAppData(home, newer);
    const flow = await openFlowShell({ home, start: `app:${APP}` });
    let confirmation: Page | undefined;
    try {
      await openVersionTab(flow);

      await t.step(
        "flow 1: 지금 Version과 돌아갈 Version을 나눠 보이고, 지금 Version에는 [Use this version]을 주지 않는다",
        async () => {
          await flow.until(
            `document.querySelector(${
              JSON.stringify(`[data-version="${NEWER}"]`)
            })?.getAttribute("data-status") === "active"`,
            "지금 Version이 active로 보이지 않는다",
          );
          assertEquals(
            await flow.text(
              `[data-version="${NEWER}"] [data-fact="applied"]`,
            ),
            "In use",
          );
          assertEquals(
            await flow.count(`[data-version="${NEWER}"] [data-use-version]`),
            0,
          );
          // 돌아갈 Version을 펼치면 그때의 사실이 나오고 고를 수 있다.
          await flow.click(`[data-version="${OLDER}"] [data-version-expand]`);
          await flow.until(
            `document.querySelector(${
              JSON.stringify(`[data-version="${OLDER}"] [data-fact="applied"]`)
            }) !== null`,
            "돌아갈 Version의 사실이 보이지 않는다",
          );
          assertEquals(
            await flow.text(`[data-version="${OLDER}"] [data-fact="applied"]`),
            "It was in use before",
          );
          assertEquals(
            await flow.count(`[data-version="${OLDER}"] [data-use-version]`),
            1,
          );
          // 적용 결과와 실제 시작 확인은 다른 사실이다. 지금은 새 release가 돌고 있다.
          assertEquals(await activeRelease(flow), NEWER);
          await untilTrue(
            "새 release가 돌지 않는다",
            async () => (await running(flow))?.release === NEWER,
          );
        },
      );

      await t.step(
        "flow 3·4·5: 사람이 정확한 이전 Version의 적용을 허락하면 그 release로 바뀌어 돌고 지금 Version이 된다",
        async () => {
          await flow.click(`[data-version="${OLDER}"] [data-use-version]`);
          await untilConfirmationWindow(flow);
          confirmation = await flow.shell.connect(
            "lophn-shell://confirmation/index.html",
          );
          await untilPage(
            confirmation,
            `document.querySelector('[data-kind="release_activation"]') !== null`,
            "release 적용 결정 창이 서지 않았다",
          );
          await pageClick(
            confirmation,
            '[data-decision="grant_approval_request"]',
          );
          await untilTrue(
            "사람이 허락한 적용이 시작되지 않았다",
            async () => await releaseStatus(flow, OLDER) !== "superseded",
          );
          try {
            await untilTrue("이전 release로 시작하지 않았다", async () => {
              const seen = await running(flow);
              return seen?.release === OLDER && seen.ready === true;
            });
          } catch (error) {
            const dbg = async (resource: string, method: string, body: unknown) =>
              JSON.stringify(await flow.call({ kind: "read", resource, method, body })).slice(0, 1500);
            console.log("DBG rel", await dbg("releases", "get", { release: OLDER }));
            console.log("DBG rt", await dbg("apps", "runtime", { app: APP }));
            console.log("DBG app", await dbg("apps", "get", { app: APP }));
            throw error;
          }
          assertEquals(await releaseStatus(flow, OLDER), "active");
          assertEquals(await releaseStatus(flow, NEWER), "superseded");
          assertEquals(await activeRelease(flow), OLDER);
          // 화면도 같은 사실을 보인다.
          await flow.until(
            `document.querySelector(${
              JSON.stringify(`[data-version="${OLDER}"]`)
            })?.getAttribute("data-status") === "active"`,
            "app-detail이 적용된 Version을 지금 Version으로 보이지 않는다",
          );
          assertEquals(
            await flow.text(`[data-version="${OLDER}"] [data-fact="applied"]`),
            "In use",
          );
          await flow.until(
            `document.querySelector(${
              JSON.stringify(`[data-version="${OLDER}"] [data-fact="start"]`)
            })?.textContent === "Started and responding"`,
            "app-detail이 시작 확인을 보이지 않는다",
          );
          // 결정이 끝난 창은 사람이 닫는다.
          await untilPage(
            confirmation,
            `document.querySelector('[data-state="submitted"]') !== null`,
            "결정 창이 끝난 상태가 되지 않았다",
          );
          await pageClick(confirmation, '[data-action="cancel"]');
          await untilNoConfirmationWindow(flow);
        },
      );

      await t.step(
        "다른 갈래: 사람이 거절하면 그 release로 바뀌지 않고 지금 Version이 그대로 남는다",
        async () => {
          await flow.click(`[data-version="${NEWER}"] [data-use-version]`);
          await untilConfirmationWindow(flow);
          const second = await flow.shell.connect("confirmation/index.html");
          await untilPage(
            second,
            `document.querySelector('[data-decision="reject_approval_request"]') !== null`,
            "거절 버튼이 서지 않았다",
          );
          await pageClick(second, '[data-decision="reject_approval_request"]');
          await delay(3_000);
          assertEquals(await activeRelease(flow), OLDER);
          assertEquals(await releaseStatus(flow, NEWER), "superseded");
          assertEquals((await running(flow))?.release, OLDER);
          await closeConfirmationWindow(flow);
          await untilNoConfirmationWindow(flow);
        },
      );

      await t.step(
        "다른 갈래: 사람이 결정 창을 그만두면(닫기) 그 release로 바뀌지 않는다",
        async () => {
          await reloadAppSpace(flow);
          // 다시 연 화면은 돌아갈 Version을 접어 둔다. 사람이 펼쳐서 고른다.
          await flow.click(`[data-version="${NEWER}"] [data-version-expand]`);
          await flow.until(
            `document.querySelector(${
              JSON.stringify(`[data-version="${NEWER}"] [data-use-version]`)
            }) !== null`,
            "돌아갈 Version을 고를 수 없다",
          );
          await flow.click(`[data-version="${NEWER}"] [data-use-version]`);
          await untilConfirmationWindow(flow);
          await delay(1_000);
          await closeConfirmationWindow(flow);
          await untilNoConfirmationWindow(flow);
          await delay(3_000);
          assertEquals(await activeRelease(flow), OLDER);
          assertEquals(await releaseStatus(flow, NEWER), "superseded");
          assertEquals((await running(flow))?.release, OLDER);
        },
      );
    } finally {
      await flow.close();
      await removeTree(home);
    }
  },
});
