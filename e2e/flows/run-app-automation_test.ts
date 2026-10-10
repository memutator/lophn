// apps#T27 flow run-app-automation E2E(docs/flows/run-app-automation.md). 실제 headless shell과 실제
// core·apps supervisor·앱 자식으로 돈다. 앱은 fixture source(todo)에 automation 셋을 더해 commit한
// 봉인 bundle이고, ledger에는 등록 transaction이 남기는 모양으로 앱 행과 release 행 하나를 심되
// grant는 심지 않는다. automation의 계기는 앱 자식 안의 시계가 정한다. 제품은 시험이 시계를 바꿀
// 통로를 자식 환경에 주지 않으므로(주입은 runtime entrypoint의 단위 시험뿐), 시작 계기는 앱 시작으로,
// 간격 계기는 제품이 받는 최소 간격 60000ms를 실제로 한 번 기다려 본다.
// 사람이 하는 조작은 화면(app-detail Automations·Access 탭과 confirmation window)으로 하고, 사람이
// 확인하는 결과(invocation 기록, 도는 자식)는 사람 token의 같은 core 읽기 통로(`window.lophnCore`)로
// 읽는다. 앱 데이터는 앱 화면이 쓰는 같은 통로(`window.lophnApp.call`)로 읽는다. 사람 데이터
// root(~/.lophn)는 열지 않는다. HOME·LOPHN_HOME은 임시 폴더이고 띄운 Electron·core 트리는 정확한
// pid로만 끝낸다.
//
// 이 테스트가 보는 것: flow 1·2(앱이 열리면 허락한 일이 직접 호출과 같은 명령으로 돌고 external 일은
// 사람이 켜기 전에는 돌지 않는다), 4·6(결과가 앱 데이터에 남고 비동기 invocation 기록의 trigger가
// automation이다), 7(app-detail이 선언·지금 시작 가능 여부·실제 활동을 따로 보인다), 다른 갈래(external
// 일은 사람이 한 번 켠 범위에서만 돈다).
//
// 아직 돌지 못하는 것(남은 단계): flow 3의 secret 값(OS keychain이 이 환경에 없다), 5의 놓친 회차·
// 진행 중 건너뜀·retry 없음(시계 주입이 없어 단위 시험이 맡는다), 4~6 실패의 문제 보고, timeout·결과 모름.
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
  commandBody,
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
const EXPORT_DIR = "/tmp/lophn-todo/export";
// 앱이 시작될 때와 정해진 간격마다 스스로 부르는 일. 고정 입력은 blueprint에 들어 있다.
const START_TITLE = "Automated start item";
const EVERY_TITLE = "Automated minute item";
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
async function prepareTodo(
  home: string,
  exportFile: string,
): Promise<Bundle> {
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
    // fixture 앱에 automation 셋을 더한다: 시작할 때 쓰는 일, 시작할 때 파일을 내보내는 external 일
    // (사람이 켜야 돈다), 최소 간격 60000ms의 쓰는 일.
    const blueprintPath = `${dir}/blueprint.ts`;
    const blueprintSource = await Deno.readTextFile(blueprintPath);
    assert(blueprintSource.includes("automatic_tasks: [],"));
    await Deno.writeTextFile(
      blueprintPath,
      blueprintSource.replace(
        "automatic_tasks: [],",
        `automatic_tasks: [
      { key: "add_on_start", label: "Add a start-up item", when: { kind: "on_start" }, command: "add_todo", input: { title: ${
          JSON.stringify(START_TITLE)
        } } },
      { key: "export_on_start", label: "Export items at start", when: { kind: "on_start" }, command: "export_markdown", input: { file: ${
          JSON.stringify(exportFile)
        } } },
      { key: "add_every_minute", label: "Add an item every minute", when: { kind: "interval", interval_ms: 60000 }, command: "add_todo", input: { title: ${
          JSON.stringify(EVERY_TITLE)
        } } },
    ],`,
      ),
    );
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

const AUTOMATIONS = `[data-tab-body="automations"]`;

/** 사람이 app-detail의 Automations 탭을 연다. */
async function openAutomationsTab(flow: FlowShell): Promise<void> {
  if (await flow.count(DETAIL) === 0) {
    await flow.click('[data-app-bar="app-details"]');
    await flow.until(
      `document.querySelector(${JSON.stringify(DETAIL)}) !== null`,
      "app-detail이 서지 않았다",
    );
  }
  await flow.mouseClickText(`${DETAIL} [role="tab"]`, "Automations");
  await flow.until(
    `document.querySelector(${JSON.stringify(AUTOMATIONS)}) !== null`,
    "Automations 탭이 서지 않았다",
  );
}

type InvocationRow = {
  status: string;
  operation: { kind: string; command?: string };
  trigger: { kind: string; key?: string };
};

/** 사람 token의 invocation 읽기. */
async function invocationsOf(flow: FlowShell): Promise<InvocationRow[]> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "invocations",
    method: "list",
    body: { app: APP, limit: 100 },
  });
  return got.invocations as InvocationRow[];
}

function ranBy(rows: InvocationRow[], key: string): InvocationRow[] {
  return rows.filter((row) =>
    row.trigger.kind === "automation" && row.trigger.key === key
  );
}

/** 실패 설명에 붙이는 지금까지의 automation 기록. */
async function recorded(flow: FlowShell): Promise<string> {
  return JSON.stringify(
    (await invocationsOf(flow)).map((row) =>
      `${row.trigger.key ?? row.trigger.kind}:${row.status}`
    ),
  );
}

/** 앱 실행 허용 끄기·켜기는 사람 command다(shell 화면에는 이 단추가 없다). */
async function setExecution(flow: FlowShell, on: boolean): Promise<void> {
  const app = (await mustCall(flow, {
    kind: "read",
    resource: "apps",
    method: "get",
    body: { app: APP },
  })).app as { revision: string };
  const reply = await flow.call({
    kind: "command",
    resource: "apps",
    method: on ? "enable_execution" : "disable_execution",
    body: commandBody({ app: APP }, { base_revision: app.revision }),
  });
  assert(reply.ok, JSON.stringify(reply));
}

Deno.test({
  name:
    "apps/automations#R1 R2 R4 R10 R13 apps/invocations#R2 apps/permissions#R2 flow run-app-automation: 앱이 열리면 허락한 일이 직접 호출과 같은 명령으로 돌고 external 일은 사람이 켠 뒤에만 돈다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-auto-" });
    await Deno.chmod(home, 0o700);
    const exportFile = `flow-auto-${crypto.randomUUID().slice(0, 8)}.md`;
    const exportPath = `${EXPORT_DIR}/${exportFile}`;
    await Deno.mkdir(EXPORT_DIR, { recursive: true });
    // core 한 번을 띄워 DB를 만든 뒤 멈추고, 앱과 release 행을 심고 앱 공간부터 다시 연다.
    const first = await openFlowShell({ home });
    await first.close();
    const bundle = await prepareTodo(home, exportFile);
    seedLedger(home, bundle);
    await seedAppData(home, bundle);
    const flow = await openFlowShell({ home, start: `app:${APP}` });
    const listed = async () => {
      const reply = await appCall(flow, "list_todos", null);
      assert(reply.startsWith("ok:"), `list_todos가 실패했다: ${reply}`);
      return reply;
    };
    const countOf = (text: string, title: string) =>
      text.split(title).length - 1;
    try {
      await untilReady(flow, "앱이 처음 뜨지 않았다");

      await t.step(
        "flow 1·2·4·6: 앱이 열리면 시작 계기의 일이 한 번 돌아 앱 데이터에 남고 invocation 기록의 trigger는 automation이다",
        async () => {
          await untilTrue(
            "시작 계기의 일이 기록되지 않았다",
            async () =>
              ranBy(await invocationsOf(flow), "add_on_start").some((row) =>
                row.status === "succeeded"
              ),
          );
          const rows = ranBy(await invocationsOf(flow), "add_on_start");
          assertEquals(rows.length, 1);
          assertEquals(rows[0].operation, {
            kind: "command",
            command: "add_todo",
          });
          // 직접 호출과 같은 add_todo 구현이 같은 앱 DB에 썼다.
          assertEquals(countOf(await listed(), START_TITLE), 1);
        },
      );

      await t.step(
        "다른 갈래: external 일은 사람이 켜기 전에는 시작하지 않고 파일도 만들지 않는다",
        async () => {
          assertEquals(
            ranBy(await invocationsOf(flow), "export_on_start"),
            [],
          );
          await Deno.stat(exportPath).then(
            () => assert(false, "켜기 전에 파일이 생겼다"),
            () => undefined,
          );
        },
      );

      await t.step(
        "flow 7: app-detail이 선언된 일, 지금 시작 가능 여부, 실제 활동을 따로 보인다",
        async () => {
          await openAutomationsTab(flow);
          await flow.until(
            `document.querySelectorAll('${AUTOMATIONS} [data-automation]').length === 3`,
            "선언한 일 셋이 보이지 않는다",
          );
          const card = (key: string) =>
            `${AUTOMATIONS} [data-automation="${key}"]`;
          await flow.until(
            `document.querySelector('${
              card("add_on_start")
            } [data-fact="seen"]')?.textContent === "Yes"`,
            "실제로 확인된 활동이 보이지 않는다",
          );
          assertEquals(
            await flow.text(`${card("add_on_start")} [data-fact="action"]`),
            "Add todo",
          );
          assertEquals(
            await flow.text(`${card("add_on_start")} [data-fact="can-start"]`),
            "Yes",
          );
          assert(
            String(
              await flow.text(`${card("add_on_start")} [data-last-activity]`),
            )
              .includes("Done"),
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector('${card("add_on_start")}').dataset.on`,
            ),
            "on",
          );
          // external 일은 켜기 전이라 꺼져 있고 활동이 없다.
          assertEquals(
            await flow.evaluate(
              `document.querySelector('${card("export_on_start")}').dataset.on`,
            ),
            "off",
          );
          assertEquals(
            await flow.count(`${card("export_on_start")} [data-turn-on]`),
            1,
          );
          assertEquals(
            await flow.text(`${card("export_on_start")} [data-fact="seen"]`),
            "Not yet",
          );
        },
      );

      await t.step(
        "다른 갈래: 사람이 external 일을 한 번 켜면 그 범위에서만 돌고 앱 시작 계기마다 다시 한 번 돈다",
        async () => {
          const nonce = await untilReady(flow, "앱이 돌지 않는다");
          await openAutomationsTab(flow);
          await flow.click(
            `${AUTOMATIONS} [data-automation="export_on_start"] [data-turn-on]`,
          );
          const shown = await untilDecisionWindow(
            flow,
            "grant_approval_request",
          );
          assert(shown.includes("export_on_start"), `일 이름이 없다: ${shown}`);
          assert(shown.includes("export_markdown"), `명령이 없다: ${shown}`);
          // 미리 보기만으로는 grant가 생기지 않는다.
          assertEquals(
            (await grantsOf(flow)).filter((grant) =>
              grant.kind === "automation.run" && grant.status === "active"
            ),
            [],
          );
          await decide(flow, "grant_approval_request");
          await untilTrue(
            "automation 켜기 grant가 생기지 않았다",
            async () =>
              (await grantsOf(flow)).some((grant) =>
                grant.kind === "automation.run" && grant.status === "active"
              ),
          );
          // 켜기는 앱을 다시 띄우지 않고 이미 지난 시작 계기를 되살리지 않는다.
          await delay(2_000);
          assertEquals((await running(flow))?.nonce, nonce);
          assertEquals(
            ranBy(await invocationsOf(flow), "export_on_start"),
            [],
          );
          await openAutomationsTab(flow);
          await flow.until(
            `document.querySelector('${AUTOMATIONS} [data-automation="export_on_start"]')?.dataset.on === "on"`,
            "켠 일이 켜짐으로 보이지 않는다",
          );

          // 켠 일이라도 파일 쓰기 접근이 없으면 시작 때 그 명령이 직접 호출처럼 거절된다. 호출을
          // 시작했다는 사실과 업무 성공은 다르게 남고 자동 재호출은 없다.
          await setExecution(flow, false);
          await untilTrue(
            "앱이 멈추지 않았다",
            async () => await running(flow) === null,
          );
          await setExecution(flow, true);
          await untilReady(flow, "다시 허용한 앱이 뜨지 않았다");
          await untilTrue(
            "접근 없이 시작한 일이 기록되지 않았다",
            async () =>
              ranBy(await invocationsOf(flow), "export_on_start").length === 1,
          );
          const refused = ranBy(await invocationsOf(flow), "export_on_start");
          assert(
            refused[0].status !== "succeeded",
            `접근 없이 내보내기가 성공했다: ${await recorded(flow)}`,
          );
          await Deno.stat(exportPath).then(
            () => assert(false, "접근 없이 파일이 생겼다"),
            () => undefined,
          );
          await delay(3_000);
          assertEquals(
            ranBy(await invocationsOf(flow), "export_on_start").length,
            1,
          );
          // 탭을 벗어났다 돌아와 현재 기록을 다시 읽는다.
          await openAccessTab(flow);
          await openAutomationsTab(flow);
          await flow.until(
            `(document.querySelector('${AUTOMATIONS} [data-automation="export_on_start"] [data-last-activity]')?.textContent ?? "").length > 0 && !document.querySelector('${AUTOMATIONS} [data-automation="export_on_start"] [data-last-activity]').textContent.includes("No activity")`,
            "실패한 활동이 보이지 않는다",
          );
          assert(
            !String(
              await flow.text(
                `${AUTOMATIONS} [data-automation="export_on_start"] [data-last-activity]`,
              ),
            ).includes("Done"),
            "거절된 호출이 완료로 보인다",
          );
          const nonceAfterRefusal = await untilReady(
            flow,
            "앱이 돌지 않는다",
          );

          // 파일 쓰기 접근은 별도 허락이다. 허락하면 앱이 다시 뜨고 시작 계기의 일이 다시 돈다.
          await openAccessTab(flow);
          await reviewAccess(flow, EXPORT_DIR);
          await untilDecisionWindow(flow, "grant_approval_request");
          await decide(flow, "grant_approval_request");
          await untilTrue("앱이 다시 뜨지 않았다", async () => {
            const seen = await running(flow);
            return seen !== null && seen.ready && seen.release === RELEASE &&
              seen.nonce !== nonceAfterRefusal && !seen.terminationPending;
          });
          await untilTrue(
            "켠 일이 돌지 않았다",
            async () =>
              ranBy(await invocationsOf(flow), "export_on_start").some((row) =>
                row.status === "succeeded"
              ),
          );
          assertEquals(
            ranBy(await invocationsOf(flow), "export_on_start").length,
            2,
            await recorded(flow),
          );
          const exported = await Deno.readTextFile(exportPath);
          assert(
            exported.includes(START_TITLE),
            `내보낸 파일에 앱 데이터가 없다: ${exported}`,
          );
          // 앱이 시작될 때마다 시작 계기의 일이 한 번씩 돈다.
          await untilTrue(
            "두 번째 시작의 일이 기록되지 않았다",
            async () =>
              ranBy(await invocationsOf(flow), "add_on_start").length === 3,
          );
        },
      );

      await t.step(
        "flow 1·5: 간격 계기의 일은 최소 간격 60000ms가 지난 뒤 도래해 같은 명령으로 돈다",
        async () => {
          // 제품에는 자식 안 시계를 시험이 바꿀 통로가 없다. 받는 최소 간격을 실제로 한 번 기다린다.
          const before = ranBy(await invocationsOf(flow), "add_every_minute");
          assertEquals(before.length, 0);
          const facts = async () =>
            JSON.stringify({
              rows: (await invocationsOf(flow)).map((row) =>
                `${row.trigger.key ?? row.trigger.kind}:${row.status}`
              ),
              running: await running(flow),
            });
          await untilTrue(
            "간격 계기의 일이 돌지 않았다",
            async () =>
              ranBy(await invocationsOf(flow), "add_every_minute").some((
                row,
              ) => row.status === "succeeded"),
            200_000,
          ).catch(async (error) => {
            throw new Error(`${error.message} ${await facts()}`);
          });
          const rows = ranBy(await invocationsOf(flow), "add_every_minute");
          assertEquals(rows[0].operation.command, "add_todo");
          assert(countOf(await listed(), EVERY_TITLE) >= 1);
        },
      );

      await t.step(
        "다른 갈래: 사람이 켠 일을 끄면 확인 창 없이 grant가 거두어지고 앱 실행 허용을 끄면 시작하지 않으며 다시 허용하기 전에는 자동 재시작하지 않는다",
        async () => {
          await openAutomationsTab(flow);
          await flow.until(
            `document.querySelector('${AUTOMATIONS} [data-automation="export_on_start"] [data-turn-off]') !== null`,
            "켠 일의 끄기 단추가 보이지 않는다",
          );
          await flow.click(
            `${AUTOMATIONS} [data-automation="export_on_start"] [data-turn-off]`,
          );
          await untilTrue(
            "automation grant가 거두어지지 않았다",
            async () =>
              (await grantsOf(flow)).some((grant) =>
                grant.kind === "automation.run" && grant.status === "revoked"
              ),
          );
          await flow.until(
            `document.querySelector('${AUTOMATIONS} [data-automation="export_on_start"]')?.dataset.on === "off"`,
            "끈 일이 꺼짐으로 보이지 않는다",
          );

          await setExecution(flow, false);
          await untilTrue(
            "앱이 멈추지 않았다",
            async () => await running(flow) === null,
          );
          const startRuns = ranBy(await invocationsOf(flow), "add_on_start")
            .length;
          await delay(4_000);
          assertEquals(await running(flow), null);
          assertEquals(
            ranBy(await invocationsOf(flow), "add_on_start").length,
            startRuns,
          );
          const seen = await mustCall(flow, {
            kind: "read",
            resource: "apps",
            method: "automations",
            body: { app: APP },
          });
          const view = (seen.automations as {
            key: string;
            runnable: boolean;
            observed: boolean;
            reason?: { code: string };
          }[]).find((entry) => entry.key === "add_on_start");
          assertEquals(view?.runnable, false);
          assertEquals(view?.reason?.code, "execution_disabled");
          // 지난 활동은 지워지지 않고 지금 시작 가능 여부만 다르다.
          assertEquals(view?.observed, true);

          await setExecution(flow, true);
          await untilReady(flow, "다시 허용한 앱이 뜨지 않았다");
          await untilTrue(
            "다시 허용한 뒤 시작 계기의 일이 돌지 않았다",
            async () =>
              ranBy(await invocationsOf(flow), "add_on_start").length ===
                startRuns + 1,
          );
          // 꺼 둔 external 일은 다시 열려도 돌지 않았다.
          assertEquals(
            ranBy(await invocationsOf(flow), "export_on_start").length,
            2,
          );
        },
      );
    } finally {
      await flow.close();
      await removeTree(home);
      await Deno.remove(exportPath).catch(() => undefined);
    }
  },
});
