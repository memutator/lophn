// apps#T27 flow manage-app-permissions E2E(docs/flows/manage-app-permissions.md). 실제 headless shell과
// 실제 core·apps supervisor·앱 자식으로 돈다. 앱은 fixture source(todo)를 commit해 봉인한 bundle이고,
// ledger에는 등록 transaction이 남기는 모양으로 앱 행과 release 행 하나를 심되 grant는 심지 않는다.
// 사람이 하는 조작은 화면(app-detail Access 탭과 confirmation window)으로 하고, 사람이 확인하는 결과
// (지금 grant, 실제로 도는 자식)는 사람 token의 같은 core 읽기 통로(`window.lophnCore`)로 읽는다.
// 앱이 파일에 닿는지는 앱 화면이 쓰는 같은 통로(`window.lophnApp.call`)로 import_markdown을 불러
// 본다(앱의 파일 접근은 grant에서 나온 Deno flag만 허락한다). 사람 데이터 root(~/.lophn)는 열지
// 않는다. HOME·LOPHN_HOME은 임시 폴더이고 띄운 Electron·core 트리는 정확한 pid로만 끝낸다.
//
// 이 테스트가 보는 것: flow 1(선언만으로 접근이 열리지 않고, 사람이 정확한 경로를 확인해 필요한 것만
// 허락한다), flow 5(허락 뒤 다음 자식은 넓어진 범위로 뜨고, 회수하면 새 자식이 줄어든 범위로 뜨며
// 이미 생긴 데이터는 그대로다), 다른 갈래(거절·창 닫기는 범위를 열지 않는다).
//
// 아직 돌지 못하는 것(남은 단계): flow 2·3·6의 secret 값(OS keychain이 이 환경에 없고 supervisor의
// SecretDelivery가 platform 전송 부착에 닿지 않는다: apps#T19 이어보냄 (2)), flow 4의 command 허락,
// 보호 범위·조합 경고 갈래.
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

const APP = "app_01h455vb4pex5v6nkc6gd5fdw4";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw4";
const DATA_SCHEMA = 2;
const FIXTURE = new URL("../../fixtures/apps/todo/", import.meta.url).pathname;
// fixtures/apps/todo/src/places.ts의 선언 경로다.
const IMPORT_DIR = "/tmp/lophn-todo/import";
const EXPORT_DIR = "/tmp/lophn-todo/export";
const DETAIL = `[data-app-detail="${APP}"]`;

type Bundle = {
  bundleHash: string;
  blueprintHash: string;
  blueprint: string;
  copyPath: string;
};

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

/** fixture source를 commit하고 봉인 bundle로 준비해 `home` 아래에 둔다. */
async function prepareTodo(home: string): Promise<Bundle> {
  const installed = await installedHome(["@lophn/cap-fs"]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-e2e-perms-src-" });
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

/** 지금 release의 activation이 남겼을 앱 DB를 만든다. */
async function seedAppData(home: string, bundle: Bundle): Promise<void> {
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
  const dataArea = `${home}/apps/${APP}/data`;
  await Deno.mkdir(`${dataArea}/backups`, { recursive: true });
  const migrated = await migrateAppDatabase({
    dataArea,
    databasePath: `${dataArea}/app.sqlite`,
    backupPath: `${dataArea}/backups/seed`,
    targetSchema: DATA_SCHEMA,
    scripts,
    appliedAt: "2026-10-02T00:00:00.000Z",
    result: { release: RELEASE, activation_seq: "1", invocation: null },
  });
  assert(migrated.ok, migrated.ok ? "" : JSON.stringify(migrated.error));
}

/** core를 멈춘 동안 앱 행과 active release 행을 심는다. grant는 심지 않는다. */
function seedLedger(home: string, bundle: Bundle): void {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    const declarations = declarationsOfBlueprint(
      RELEASE,
      JSON.parse(bundle.blueprint),
    );
    assert(declarations !== undefined, "선언 사실을 만들지 못했다");
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, 'todos', 'Todo', 'A todo app', NULL, NULL, ?, 1, '1', 'active')`,
    ).run(APP, RELEASE);
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, 1, ?, ?, ?, ?, '[]', NULL, 'machine', ?, 'active', NULL, NULL, ?, ?)`,
    ).run(
      RELEASE,
      APP,
      "d".repeat(40),
      bundle.bundleHash,
      bundle.blueprintHash,
      DATA_SCHEMA,
      "2026-10-02T00:00:00.000Z",
      bundle.blueprint,
      JSON.stringify(declarations),
    );
    db.prepare(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
    ).run(RELEASE, "vrf_01h455vb4pex5v6nkc6gd5fdw4");
  } finally {
    db.close();
  }
}

async function untilTrue(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      last = await check();
    } catch (error) {
      last = String(error);
    }
    if (last === true) return;
    await delay(400);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

type GrantRow = {
  id: string;
  app: string;
  kind: string;
  scope: Record<string, unknown>;
  status: string;
};

/** 사람 token의 grant 읽기. */
async function grantsOf(flow: FlowShell): Promise<GrantRow[]> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "grants",
    method: "list",
    body: { app: APP, limit: 200 },
  });
  return got.grants as GrantRow[];
}

/** 사람 token의 앱 runtime 읽기. 실제로 도는 자식의 nonce와 종료 확인 대기다. */
async function running(flow: FlowShell): Promise<
  {
    nonce: string;
    ready: boolean;
    release: string | null;
    terminationPending: boolean;
  } | null
> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "apps",
    method: "runtime",
    body: { app: APP },
  });
  const observation = got.observation as {
    mode: string;
    ready: boolean;
    release: string | null;
    process_nonce: string;
  } | null;
  if (observation === null || observation.mode !== "live") return null;
  return {
    nonce: observation.process_nonce,
    ready: observation.ready,
    release: observation.release,
    terminationPending:
      (got.state as { termination_pending: boolean }).termination_pending,
  };
}

/** 닫혀 있던 자식이 준비 상태가 된 뒤의 nonce를 돌려준다. */
async function untilReady(flow: FlowShell, what: string): Promise<string> {
  let nonce = "";
  await untilTrue(what, async () => {
    const seen = await running(flow);
    if (seen === null || !seen.ready || seen.release !== RELEASE) return false;
    nonce = seen.nonce;
    return true;
  });
  return nonce;
}

const APP_VIEW =
  `electron.webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().startsWith("lophn-app:"))`;

/**
 * 앱 화면이 command를 부르는 통로다. 운영 패널이 열려 있으면 사람이 닫아 앱 화면으로 돌아간다.
 * 앱을 다시 띄운 뒤에는 화면이 다시 열리므로 부를 때마다 화면을 찾는다.
 */
async function appCall(
  flow: FlowShell,
  command: string,
  input: Record<string, string> | null,
): Promise<string> {
  if (await flow.count("[data-ops-panel]") > 0) {
    await flow.click("[data-ops-panel-close]");
    await flow.until(
      `document.querySelector("[data-ops-panel]") === null`,
      "운영 패널이 닫히지 않았다",
    );
  }
  const call =
    `typeof window.lophnApp?.call !== "function" ? "no-bridge" : window.lophnApp.call(${
      JSON.stringify(command)
    }, ${
      JSON.stringify(input)
    }).then((body) => "ok:" + JSON.stringify(body), (error) => "failed:" + String(error && error.message || error))`;
  const deadline = Date.now() + 25_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const reply = await flow.shell.mainEvaluate(
        `(async () => { const view = ${APP_VIEW}; return view ? await view.executeJavaScript(${
          JSON.stringify(call)
        }) : "no-view"; })()`,
      );
      last = String(reply);
      if (last.includes("the app view changed")) {
        // 앱이 다시 뜨기 전에 열린 화면은 옛 자식에 묶여 있다. 사람이 앱 공간을 다시 연다.
        await flow.evaluate(`(() => { location.reload(); return true; })()`);
        await delay(500);
        await flow.until(
          `document.querySelector('[data-space="app"]') !== null`,
          "앱 공간이 다시 서지 않았다",
        );
      } else if (last !== "no-bridge" && last !== "no-view") return last;
    } catch (error) {
      last = String(error);
    }
    // 앱이 뜨기 전에 열려 한 번 실패한 화면은 사람이 [Reload]로 다시 연다.
    if (await flow.count('[data-phase="failed"] button') > 0) {
      await flow.click('[data-phase="failed"] button');
    }
    await delay(300);
  }
  throw new Error(
    `앱 화면이 command에 답하지 않았다: ${last} ${
      JSON.stringify(
        await flow.evaluate(
          `JSON.stringify({ phase: [...document.querySelectorAll("[data-phase]")].map((el) => el.getAttribute("data-phase")), text: document.body.innerText.slice(0, 300) })`,
        ),
      )
    }`,
  );
}

/** 사람이 app-detail의 Access 탭을 연다. */
async function openAccessTab(flow: FlowShell): Promise<void> {
  if (
    await flow.count(DETAIL) === 0
  ) {
    await flow.click('[data-app-bar="app-details"]');
    await flow.until(
      `document.querySelector(${JSON.stringify(DETAIL)}) !== null`,
      "app-detail이 서지 않았다",
    );
  }
  await flow.mouseClickText(`${DETAIL} [role="tab"]`, "Access");
  await flow.until(
    `document.querySelector('[data-tab-body="access"]') !== null`,
    "Access 탭이 서지 않았다",
  );
}

/** connect는 url마다 첫 창만 기억한다. 결정 단추가 아직 있는 확인 창을 매번 다시 찾는다. */
function inDecisionWindow(
  flow: FlowShell,
  decision: string,
  expression: string,
): Promise<unknown> {
  return flow.shell.mainEvaluate(`(async () => {
    const contents = electron.webContents.getAllWebContents().filter((c) =>
      !c.isDestroyed() && c.getURL().startsWith("lophn-shell://confirmation/")
    );
    for (const item of contents) {
      const open = await item.executeJavaScript(${
    JSON.stringify(
      `document.querySelector("[data-decision='${decision}']") !== null`,
    )
  });
      if (open) return await item.executeJavaScript(${
    JSON.stringify(expression)
  });
    }
    return null;
  })()`);
}

async function untilDecisionWindow(
  flow: FlowShell,
  decision: string,
): Promise<string> {
  let shown = "";
  await untilTrue("확인 창에 결정 단추가 없다", async () => {
    const text = await inDecisionWindow(
      flow,
      decision,
      `document.querySelector("[data-decision='${decision}']") ? document.body.innerText : ""`,
    );
    shown = typeof text === "string" ? text : "";
    return shown !== "";
  }, 30_000);
  return shown;
}

/** 사람이 확인 창에서 `decision`을 누른다. */
async function decide(flow: FlowShell, decision: string): Promise<void> {
  await inDecisionWindow(
    flow,
    decision,
    `document.querySelector("[data-decision='${decision}']").click()`,
  );
}

/** 사람이 연 확인 창을 닫는다(창 닫기는 결정이 아니다, confirmation-window#R4). */
async function closeConfirmationWindows(flow: FlowShell): Promise<void> {
  await flow.shell.mainEvaluate(
    `(() => {
      for (const w of electron.BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed() && w.webContents.getURL().includes("confirmation/index.html")) w.close();
      }
      return true;
    })()`,
  );
  await untilTrue(
    "확인 창이 닫히지 않았다",
    async () =>
      await flow.shell.mainEvaluate(
        `!electron.BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes("confirmation/index.html"))`,
      ) === true,
    15_000,
  );
}

/** Access 탭에서 `exact` 요구의 [Review access]를 누른다. */
async function reviewAccess(flow: FlowShell, exact: string): Promise<void> {
  await flow.until(
    `[...document.querySelectorAll('[data-access-asks] li')].some((li) => li.querySelector('[data-change-access]') && li.innerText.includes(${
      JSON.stringify(exact)
    }))`,
    `요청 목록에 ${exact}가 없다`,
  );
  await flow.evaluate(`(() => {
    const li = [...document.querySelectorAll('[data-access-asks] li')].find((item) => item.innerText.includes(${
    JSON.stringify(exact)
  }));
    li.querySelector('[data-change-access]').click();
    return true;
  })()`);
}

/** Access 탭에서 `exact` 접근의 [Remove access]를 누른다. */
async function removeAccess(flow: FlowShell, exact: string): Promise<void> {
  await flow.until(
    `[...document.querySelectorAll('[data-grant]')].some((li) => li.querySelector('[data-exact]')?.textContent === ${
      JSON.stringify(exact)
    })`,
    `허락한 접근에 ${exact}가 없다`,
  );
  await flow.evaluate(`(() => {
    const li = [...document.querySelectorAll('[data-grant]')].find((item) => item.querySelector('[data-exact]')?.textContent === ${
    JSON.stringify(exact)
  });
    li.querySelector('[data-remove-access]').click();
    return true;
  })()`);
}

Deno.test({
  name:
    "apps/permissions#R1 R5 R8 R20 R21 R22 apps/blueprint#R1 platform/approvals#R4 shell/confirmation-window#R4 flow manage-app-permissions: 선언만으로 접근이 열리지 않고 사람이 정확한 경로를 허락하면 그 범위로 앱이 다시 뜨며 회수하면 줄어든 범위로 다시 뜬다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-perms-" });
    await Deno.chmod(home, 0o700);
    const importFile = `flow-perms-${crypto.randomUUID().slice(0, 8)}.md`;
    const importTitle = `Flow permission item ${importFile}`;
    await Deno.mkdir(IMPORT_DIR, { recursive: true });
    await Deno.writeTextFile(
      `${IMPORT_DIR}/${importFile}`,
      `- [ ] ${importTitle}\n`,
    );
    // core 한 번을 띄워 DB를 만든 뒤 멈추고, 앱과 release 행을 심고 앱 공간부터 다시 연다.
    const first = await openFlowShell({ home });
    await first.close();
    const bundle = await prepareTodo(home);
    seedLedger(home, bundle);
    await seedAppData(home, bundle);
    const flow = await openFlowShell({ home, start: `app:${APP}` });
    let beforeGrant = "";
    try {
      await untilReady(flow, "앱이 처음 뜨지 않았다");

      await t.step(
        "flow 1: 앱이 요청하는 접근은 이유와 정확한 경로로 보이고 선언만으로는 접근이 열리지 않는다",
        async () => {
          await openAccessTab(flow);
          await flow.until(
            `document.querySelector('[data-access-asks]') !== null`,
            "요청 목록이 보이지 않는다",
          );
          const asks = String(
            await flow.text("[data-access-asks]"),
          );
          assert(asks.includes(IMPORT_DIR), `읽기 요청 경로가 없다: ${asks}`);
          assert(asks.includes(EXPORT_DIR), `쓰기 요청 경로가 없다: ${asks}`);
          assertEquals(await flow.count("[data-grant]"), 0);
          assertEquals(
            (await grantsOf(flow)).filter((grant) => grant.status === "active"),
            [],
          );
          // 앱은 선언한 폴더에도 아직 닿지 못한다.
          const imported = await appCall(flow, "import_markdown", {
            file: importFile,
          });
          assert(
            imported.startsWith("failed:") && /forbidden/i.test(imported),
            `허락 전에 파일을 읽었다: ${imported}`,
          );
          const exported = await appCall(flow, "export_markdown", {
            file: importFile,
          });
          assert(
            exported.startsWith("failed:") && /forbidden/i.test(exported),
            `허락 전에 파일을 썼다: ${exported}`,
          );
          beforeGrant = await untilReady(flow, "앱이 계속 돌지 않는다");
        },
      );

      await t.step(
        "flow 1·5: 사람이 읽기만 허락하면 그 경로만 열리고 앱은 넓어진 범위로 다시 뜬다",
        async () => {
          await openAccessTab(flow);
          await reviewAccess(flow, IMPORT_DIR);
          const shown = await untilDecisionWindow(
            flow,
            "grant_approval_request",
          );
          assert(shown.includes("Todo"), `앱 이름이 없다: ${shown}`);
          assert(shown.includes(IMPORT_DIR), `경로가 없다: ${shown}`);
          assertEquals(
            await inDecisionWindow(
              flow,
              "grant_approval_request",
              `document.querySelector("[data-kind='grant']") !== null`,
            ),
            true,
          );
          // 미리 보기만으로는 grant가 생기지 않는다.
          assertEquals(
            (await grantsOf(flow)).filter((grant) => grant.status === "active"),
            [],
          );
          await decide(flow, "grant_approval_request");
          await untilTrue(
            "읽기 grant가 생기지 않았다",
            async () =>
              (await grantsOf(flow)).some((grant) =>
                grant.kind === "fs.read" && grant.status === "active" &&
                grant.scope.path === IMPORT_DIR
              ),
          );
          const active = (await grantsOf(flow)).filter((grant) =>
            grant.status === "active"
          );
          assertEquals(active.map((grant) => grant.kind), ["fs.read"]);
          await untilTrue("앱이 넓어진 범위로 다시 뜨지 않았다", async () => {
            const seen = await running(flow);
            return seen !== null && seen.ready && seen.release === RELEASE &&
              seen.nonce !== beforeGrant && !seen.terminationPending;
          });
          const imported = await appCall(flow, "import_markdown", {
            file: importFile,
          });
          assert(
            imported.startsWith("ok:") && imported.includes('"added":1'),
            `허락한 뒤에도 파일을 읽지 못했다: ${imported}`,
          );
          // 읽기 허락은 쓰기를 열지 않는다.
          const exported = await appCall(flow, "export_markdown", {
            file: importFile,
          });
          assert(
            exported.startsWith("failed:") && /forbidden/i.test(exported),
            `읽기 허락이 쓰기를 열었다: ${exported}`,
          );
        },
      );

      await t.step(
        "다른 갈래: 사람이 거절하거나 확인 창을 닫으면 쓰기 범위를 열지 않는다",
        async () => {
          const nonce = await untilReady(flow, "앱이 돌지 않는다");
          await openAccessTab(flow);
          await reviewAccess(flow, EXPORT_DIR);
          await untilDecisionWindow(flow, "reject_approval_request");
          await decide(flow, "reject_approval_request");
          await delay(3_000);
          await closeConfirmationWindows(flow);
          await reviewAccess(flow, EXPORT_DIR);
          await untilDecisionWindow(flow, "grant_approval_request");
          await closeConfirmationWindows(flow);
          await delay(3_000);
          assertEquals(
            (await grantsOf(flow)).filter((grant) => grant.status === "active")
              .map((grant) => grant.kind),
            ["fs.read"],
          );
          // 결정이 없으므로 앱은 그대로 돌고 쓰기는 여전히 막혀 있다.
          assertEquals((await running(flow))?.nonce, nonce);
          const exported = await appCall(flow, "export_markdown", {
            file: importFile,
          });
          assert(
            exported.startsWith("failed:") && /forbidden/i.test(exported),
            `결정 없이 쓰기가 열렸다: ${exported}`,
          );
          await openAccessTab(flow);
          await flow.until(
            `document.querySelectorAll('[data-grant]').length === 1`,
            "허락한 접근이 하나가 아니다",
          );
        },
      );

      await t.step(
        "flow 5: 사람이 읽기를 거두면 새 호출이 막히고 줄어든 범위로 다시 뜨며 이미 가져온 데이터는 그대로다",
        async () => {
          const nonce = await untilReady(flow, "앱이 돌지 않는다");
          await openAccessTab(flow);
          await removeAccess(flow, IMPORT_DIR);
          await untilDecisionWindow(flow, "grant_approval_request");
          await decide(flow, "grant_approval_request");
          await untilTrue(
            "grant가 거두어지지 않았다",
            async () =>
              (await grantsOf(flow)).some((grant) =>
                grant.kind === "fs.read" && grant.status === "revoked"
              ),
          );
          await untilTrue("앱이 줄어든 범위로 다시 뜨지 않았다", async () => {
            const seen = await running(flow);
            return seen !== null && seen.ready && seen.release === RELEASE &&
              seen.nonce !== nonce && !seen.terminationPending;
          });
          const imported = await appCall(flow, "import_markdown", {
            file: importFile,
          });
          assert(
            imported.startsWith("failed:") && /forbidden/i.test(imported),
            `거둔 뒤에도 파일을 읽었다: ${imported}`,
          );
          // 회수는 이미 생긴 데이터를 되돌리지 않는다.
          const listed = await appCall(flow, "list_todos", null);
          assert(
            listed.startsWith("ok:") && listed.includes(importTitle),
            `이미 가져온 데이터가 사라졌다: ${listed}`,
          );
          await openAccessTab(flow);
          await flow.until(
            `document.querySelector('[data-access-removed]') !== null && document.querySelectorAll('[data-grant]').length === 0`,
            "Access 탭이 거둔 접근을 보이지 않는다",
          );
        },
      );
    } finally {
      await flow.close();
      await removeTree(home);
      await Deno.remove(`${IMPORT_DIR}/${importFile}`).catch(() => undefined);
    }
  },
});
