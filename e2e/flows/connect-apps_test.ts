// apps#T27 flow connect-apps E2E(docs/flows/connect-apps.md). 실제 headless shell과 실제 core·apps supervisor·앱
// 자식 둘로 돈다. 부르는 앱은 todo fixture, 부름을 받는 앱은 calendar fixture(todo의 app_connections 선언이
// 가리키는 앱 ID)고 둘 다 fixture source를 commit해 봉인한 bundle이다. ledger에는 등록 transaction이 남기는 모양으로
// 앱 행과 release 행을 심되 앱 쌍 grant는 심지 않는다. 사람이 하는 조작은 화면(app-detail Connections 탭과
// confirmation window)으로 하고, 사람이 확인하는 결과(지금 grant, invocation 기록, 대상 앱이 실제로 만든 일정)는
// 사람 token의 같은 core 읽기 통로(`window.lophnCore`)와 대상 앱의 DB 읽기로 본다. 앱끼리의 호출은 todo 앱 화면이 쓰는
// 같은 통로(`window.lophnApp.call`)로 add_to_calendar를 불러 일으킨다(todo가 SDK의 connectAppCommands로 calendar의
// add_event를 부른다). 사람 데이터 root(~/.lophn)는 열지 않는다. HOME·LOPHN_HOME은 임시 폴더이고 띄운
// Electron·core 트리는 정확한 pid로만 끝낸다.
//
// 이 테스트가 보는 것: flow 1(선언은 허락이 아니다), flow 2(사람이 방향과 범위만 허락한다, 거절·창 닫기는 열지 않는다),
// flow 3·4·6(허락한 쌍·command 범위 안에서만 대상 앱의 같은 handler로 가고 caller 근거가 남는다), flow 7(허락한 범위와
// 실제 호출 결과를 구별해 보인다), 마지막 갈래(거두면 새 호출이 막히고 이미 생긴 일정은 그대로다).
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

// 부르는 앱(todo)과 부름을 받는 앱(calendar)이다. calendar의 ID는 todo fixture의 src/places.ts CALENDAR_APP과 같다.
const CALLER = "app_01h455vb4pex5v6nkc6gd5fdw6";
const CALLER_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw6";
const TARGET = "app_01arz3ndektsv4rrffq69g5fav";
const TARGET_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw7";
const DATA_SCHEMA = 2;
const TODO_FIXTURE =
  new URL("../../fixtures/apps/todo/", import.meta.url).pathname;
const CALENDAR_FIXTURE =
  new URL("../../fixtures/apps/calendar/", import.meta.url).pathname;
const STARTS_AT = "2026-10-12T09:00:00.000Z";

type Bundle = {
  app: string;
  release: string;
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
async function prepareFixture(
  home: string,
  fixture: string,
  app: string,
  release: string,
  packages: string[],
): Promise<Bundle> {
  const installed = await installedHome(packages);
  const parent = await Deno.makeTempDir({ prefix: "lophn-e2e-connect-src-" });
  try {
    const dir = `${parent}/app`;
    const config = JSON.parse(
      await Deno.readTextFile(`${fixture}/deno.json.tmpl`),
    ) as { imports: Record<string, string> };
    const files = await readTemplateDirectory(fixture, { stripSuffix: true });
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
      app,
      sourceRoot: dir,
      commit,
      sdkRoot: installed.sdkRoot,
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    return {
      app,
      release,
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
  const dataArea = `${home}/apps/${bundle.app}/data`;
  await Deno.mkdir(`${dataArea}/backups`, { recursive: true });
  const migrated = await migrateAppDatabase({
    dataArea,
    databasePath: `${dataArea}/app.sqlite`,
    backupPath: `${dataArea}/backups/seed`,
    targetSchema: DATA_SCHEMA,
    scripts,
    appliedAt: "2026-10-02T00:00:00.000Z",
    result: { release: bundle.release, activation_seq: "1", invocation: null },
  });
  assert(migrated.ok, migrated.ok ? "" : JSON.stringify(migrated.error));
}

/** core를 멈춘 동안 두 앱 행과 active release 행을 심는다. grant는 심지 않는다. */
function seedLedger(
  home: string,
  apps: { bundle: Bundle; slug: string; name: string; verification: string }[],
): void {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    for (const { bundle, slug, name, verification } of apps) {
      const declarations = declarationsOfBlueprint(
        bundle.release,
        JSON.parse(bundle.blueprint),
      );
      assert(declarations !== undefined, "선언 사실을 만들지 못했다");
      db.prepare(
        `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, 1, '1', 'active')`,
      ).run(bundle.app, slug, name, `A ${slug} app`, bundle.release);
      db.prepare(
        `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
         VALUES (?, ?, 1, ?, ?, ?, ?, '[]', NULL, 'machine', ?, 'active', NULL, NULL, ?, ?)`,
      ).run(
        bundle.release,
        bundle.app,
        "e".repeat(40),
        bundle.bundleHash,
        bundle.blueprintHash,
        DATA_SCHEMA,
        "2026-10-02T00:00:00.000Z",
        bundle.blueprint,
        JSON.stringify(declarations),
      );
      db.prepare(
        "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
      ).run(bundle.release, verification);
    }
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

const APP_VIEW =
  `electron.webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().startsWith("lophn-app:"))`;

/**
 * 앱 화면이 command를 부르는 통로다. 운영 패널이 열려 있으면 사람이 닫아 앱 화면으로 돌아간다.
 * 앱을 다시 띄운 뒤에는 화면이 다시 열리므로 부를 때마다 화면을 찾는다.
 */
async function appCall(
  flow: FlowShell,
  command: string,
  input: Record<string, string | number> | null,
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

/** 열려 있는 확인 창들의 글. 결정 단추가 서지 않을 때 이유를 보인다. */
async function confirmationTexts(flow: FlowShell): Promise<string> {
  return JSON.stringify(
    await flow.shell.mainEvaluate(`(async () => {
      const out = [];
      for (const c of electron.webContents.getAllWebContents()) {
        if (c.isDestroyed() || !c.getURL().startsWith("lophn-shell://confirmation/")) continue;
        out.push(await c.executeJavaScript("document.body.innerText"));
      }
      return out;
    })()`),
  );
}

async function untilDecisionWindow(
  flow: FlowShell,
  decision: string,
): Promise<string> {
  let shown = "";
  try {
    await untilTrue("확인 창에 결정 단추가 없다", async () => {
      const text = await inDecisionWindow(
        flow,
        decision,
        `document.querySelector("[data-decision='${decision}']") ? document.body.innerText : ""`,
      );
      shown = typeof text === "string" ? text : "";
      return shown !== "";
    }, 30_000);
  } catch (error) {
    throw new Error(`${error} ${await confirmationTexts(flow)}`);
  }
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

type GrantRow = {
  id: string;
  app: string;
  kind: string;
  scope: Record<string, unknown>;
  status: string;
};

/** 사람 token의 grant 읽기. */
async function grantsOf(flow: FlowShell, app: string): Promise<GrantRow[]> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "grants",
    method: "list",
    body: { app, limit: 200 },
  });
  return got.grants as GrantRow[];
}

/** 사람 token의 앱 runtime 읽기. 앱 자식이 준비 상태가 될 때까지 기다리고 그 자식의 nonce를 돌려준다. */
async function untilReady(
  flow: FlowShell,
  app: string,
  release: string,
  what: string,
  not?: string,
): Promise<string> {
  let nonce = "";
  await untilTrue(what, async () => {
    const got = await mustCall(flow, {
      kind: "read",
      resource: "apps",
      method: "runtime",
      body: { app },
    });
    const observation = got.observation as {
      mode: string;
      ready: boolean;
      release: string | null;
      process_nonce: string;
    } | null;
    if (
      observation === null || observation.mode !== "live" ||
      !observation.ready || observation.release !== release ||
      observation.process_nonce === not ||
      (got.state as { termination_pending: boolean }).termination_pending
    ) return false;
    nonce = observation.process_nonce;
    return true;
  });
  return nonce;
}

type InvocationRow = {
  status: string;
  actor?: string;
  caller?: unknown;
  operation: { kind: string; command?: string };
};

async function invocationsOf(
  flow: FlowShell,
  app: string,
): Promise<InvocationRow[]> {
  return (await mustCall(flow, {
    kind: "read",
    resource: "invocations",
    method: "list",
    body: { app, limit: 100 },
  })).invocations as InvocationRow[];
}

/** 대상 앱 DB의 일정 제목들. 앱 자식이 쓰는 파일을 읽기 전용으로만 연다. */
function calendarTitles(home: string): string[] {
  const db = new DatabaseSync(`${home}/apps/${TARGET}/data/app.sqlite`, {
    readOnly: true,
  });
  try {
    return (db.prepare("select title from event order by id").all() as {
      title: string;
    }[]).map((row) => row.title);
  } finally {
    db.close();
  }
}

/** 사람이 app-detail의 `tab` 탭을 연다. */
async function openTab(
  flow: FlowShell,
  tab: string,
  body: string,
): Promise<void> {
  const detail = `[data-app-detail="${CALLER}"]`;
  if (await flow.count(detail) === 0) {
    await flow.click('[data-app-bar="app-details"]');
    await flow.until(
      `document.querySelector(${JSON.stringify(detail)}) !== null`,
      "app-detail이 서지 않았다",
    );
  }
  await flow.mouseClickText(`${detail} [role="tab"]`, tab);
  await flow.until(
    `document.querySelector('[data-tab-body="${body}"]') !== null`,
    `${tab} 탭이 서지 않았다`,
  );
}

const ROW = `[data-connection="${TARGET}"]`;

Deno.test({
  name:
    "apps/connections#R1 R2 R3 R5 apps/invocations#R16 platform/approvals#R4 shell/confirmation-window#R4 flow connect-apps: 선언만으로 앱 쌍이 열리지 않고 사람이 방향과 command 범위를 허락하면 그 범위 안에서만 대상 앱이 일하며 거두면 막힌다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-connect-" });
    await Deno.chmod(home, 0o700);
    const itemTitle = `Flow connect item ${crypto.randomUUID().slice(0, 8)}`;
    // core 한 번을 띄워 DB를 만든 뒤 멈추고, 두 앱과 release 행을 심고 부르는 앱의 공간부터 다시 연다.
    const first = await openFlowShell({ home });
    await first.close();
    const caller = await prepareFixture(
      home,
      TODO_FIXTURE,
      CALLER,
      CALLER_RELEASE,
      ["@lophn/cap-fs"],
    );
    const target = await prepareFixture(
      home,
      CALENDAR_FIXTURE,
      TARGET,
      TARGET_RELEASE,
      ["@lophn/cap-net", "@lophn/cap-secret"],
    );
    seedLedger(home, [
      {
        bundle: caller,
        slug: "todos",
        name: "Todo",
        verification: "vrf_01h455vb4pex5v6nkc6gd5fdw6",
      },
      {
        bundle: target,
        slug: "calendar",
        name: "Calendar",
        verification: "vrf_01h455vb4pex5v6nkc6gd5fdw7",
      },
    ]);
    await seedAppData(home, caller);
    await seedAppData(home, target);
    const flow = await openFlowShell({ home, start: `app:${CALLER}` });
    const addToCalendar = (id: number) =>
      appCall(flow, "add_to_calendar", { id, starts_at: STARTS_AT });
    let todoId = 0;
    try {
      let callerNonce = await untilReady(
        flow,
        CALLER,
        CALLER_RELEASE,
        "todo가 뜨지 않았다",
      );
      await untilReady(flow, TARGET, TARGET_RELEASE, "calendar가 뜨지 않았다");
      const added = await appCall(flow, "add_todo", { title: itemTitle });
      assert(added.startsWith("ok:"), `할 일을 만들지 못했다: ${added}`);
      const listed = await appCall(flow, "list_todos", null);
      assert(listed.startsWith("ok:"), listed);
      todoId = Number(
        new RegExp(`"id":(\\d+)[^{}]*"title":"${itemTitle}"`).exec(listed)
          ?.[1] ?? 0,
      );
      assert(todoId > 0, `만든 할 일을 찾지 못했다: ${listed}`);

      await t.step(
        "flow 1: 부르는 앱이 선언한 대상 앱과 command는 보이지만 선언만으로 앱 쌍이 열리지 않는다",
        async () => {
          await openTab(flow, "Connections", "connections");
          await flow.until(
            `document.querySelector('${ROW}') !== null`,
            "연결 선언 줄이 보이지 않는다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector('${ROW}').getAttribute("data-allowed")`,
            ),
            "none",
          );
          const shown = String(await flow.text(ROW));
          assert(shown.includes("Calendar"), `대상 앱 이름이 없다: ${shown}`);
          assertEquals(
            (await grantsOf(flow, CALLER)).filter((grant) =>
              grant.status === "active"
            ),
            [],
          );
          // 앱이 SDK로 부르려 해도 허락 없는 쌍은 없는 앱처럼 거절된다.
          const refused = await addToCalendar(todoId);
          assert(
            refused.startsWith("failed:") &&
              /forbidden|not connected/i.test(refused),
            `허락 없이 대상 앱을 불렀다: ${refused}`,
          );
          assertEquals(calendarTitles(home), []);
        },
      );

      const pairGrants = async (status: string) =>
        (await grantsOf(flow, CALLER)).filter((grant) =>
          grant.kind === "app.call" && grant.status === status
        );
      const press = async (button: string) => {
        // 결정이 끝난 줄의 단추는 탭을 다시 열기 전까지 "기다리는 중"으로 막혀 있다(제품 결함, 보고에 적음).
        await openTab(flow, "Access", "access");
        await openTab(flow, "Connections", "connections");
        await flow.until(
          `document.querySelector('${ROW} ${button}') !== null`,
          `${button} 단추가 없다`,
        );
        await flow.evaluate(
          `(() => { document.querySelector('${ROW} ${button}').click(); return true; })()`,
        );
      };

      await t.step(
        "flow 2와 다른 갈래: 사람이 거절하거나 확인 창을 닫으면 앱 쌍을 열지 않는다",
        async () => {
          await press("[data-review-connection]");
          const shown = await untilDecisionWindow(
            flow,
            "reject_approval_request",
          );
          assert(shown.includes("Todo"), `부르는 앱 이름이 없다: ${shown}`);
          assert(shown.includes("Calendar"), `대상 앱 이름이 없다: ${shown}`);
          assert(shown.includes("add_event"), `command 범위가 없다: ${shown}`);
          // 미리 보기만으로는 grant가 생기지 않는다.
          assertEquals(await pairGrants("active"), []);
          await decide(flow, "reject_approval_request");
          await delay(3_000);
          await closeConfirmationWindows(flow);
          await press("[data-review-connection]");
          await untilDecisionWindow(flow, "grant_approval_request");
          await closeConfirmationWindows(flow);
          await delay(3_000);
          assertEquals(await pairGrants("active"), []);
          const refused = await addToCalendar(todoId);
          assert(
            refused.startsWith("failed:") &&
              /forbidden|not connected/i.test(refused),
            `결정 없이 대상 앱을 불렀다: ${refused}`,
          );
          assertEquals(calendarTitles(home), []);
        },
      );

      // 거절하거나 확인 창을 닫으면 main이 확인을 연 창에 확정 없이 끝났다고 알려, 같은 Connections 탭의
      // [Review connection]이 탭을 다시 열지 않아도 다시 눌린다(shell/confirmation-window#R4).
      await t.step(
        "거절·창 닫기 뒤에도 같은 Connections 탭에서 [Review connection]을 다시 누를 수 있다",
        async () => {
          const reviewEnabled =
            `document.querySelector('${ROW} [data-review-connection]')?.disabled === false`;
          const click = () =>
            flow.evaluate(
              `(() => { document.querySelector('${ROW} [data-review-connection]').click(); return true; })()`,
            );
          const untilEnabled = async (what: string) => {
            try {
              await flow.until(reviewEnabled, what);
            } catch (error) {
              const row = await flow.evaluate(
                `document.querySelector('${ROW}')?.innerText ?? "(줄 없음) 탭: " + document.querySelector("[data-tab-body]")?.getAttribute("data-tab-body") + " 화면: " + document.body.innerText.slice(0, 400)`,
              );
              throw new Error(`${error} 줄: ${row}`);
            }
          };
          // 앞 step이 끝나면 패널이 닫혀 있을 수 있어 같은 탭을 연 채로 시작한다.
          await openTab(flow, "Connections", "connections");
          await untilEnabled("[Review connection]이 다시 활성이 아니다");
          // 거절한 뒤.
          await click();
          await untilDecisionWindow(flow, "reject_approval_request");
          assertEquals(
            await flow.count(ROW),
            1,
            "확인 창이 열린 동안 Connections 줄이 사라졌다",
          );
          await decide(flow, "reject_approval_request");
          await untilEnabled(
            "거절 뒤 같은 탭의 [Review connection]이 다시 활성이 되지 않았다",
          );
          await closeConfirmationWindows(flow);
          // 창을 닫은 뒤.
          await click();
          await untilDecisionWindow(flow, "grant_approval_request");
          await closeConfirmationWindows(flow);
          await untilEnabled(
            "창 닫기 뒤 같은 탭의 [Review connection]이 다시 활성이 되지 않았다",
          );
          assertEquals(await pairGrants("active"), []);
        },
      );

      await t.step(
        "flow 2·3·4·6: 사람이 방향과 command 범위를 허락하면 부르는 앱의 호출이 대상 앱의 handler로 가 일정을 만든다",
        async () => {
          await press("[data-review-connection]");
          await untilDecisionWindow(flow, "grant_approval_request");
          await decide(flow, "grant_approval_request");
          await untilTrue(
            "앱 쌍 grant가 생기지 않았다",
            async () => (await pairGrants("active")).length === 1,
          );
          // grant 집합이 달라지면 부르는 앱은 대상 앱 socket에 닿는 범위로 다시 뜬다.
          callerNonce = await untilReady(
            flow,
            CALLER,
            CALLER_RELEASE,
            "todo가 넓어진 범위로 다시 뜨지 않았다",
            callerNonce,
          );
          const [grant] = await pairGrants("active");
          assertEquals(grant.scope.app, TARGET);
          assertEquals(grant.scope.commands, ["add_event"]);
          const called = await addToCalendar(todoId);
          assert(
            called.startsWith("ok:"),
            `허락한 뒤에도 대상 앱을 부르지 못했다: ${called}`,
          );
          assertEquals(calendarTitles(home), [itemTitle]);
        },
      );

      await t.step(
        "flow 6·7: 대상 앱에 호출 기록이 남고 사람은 허락한 범위와 실제 결과를 구별해 본다",
        async () => {
          // 실제 결과와 caller 근거는 후행 기록이라 잠시 뒤 끝난 상태로 남는다.
          const added = () =>
            invocationsOf(flow, TARGET).then((rows) =>
              rows.filter((row) =>
                row.operation.kind === "command" &&
                row.operation.command === "add_event"
              )
            );
          await untilTrue(
            "대상 앱의 호출 기록이 끝나지 않았다",
            async () =>
              (await added()).some((row) => row.status === "succeeded"),
            60_000,
          );
          const rows = await added();
          assertEquals(rows.length, 1);
          // 입력 본문의 주장이 아니라 실제 caller 앱과 당시 release가 남는다.
          const caller = rows[0].caller as Record<string, unknown>;
          assertEquals(caller.kind, "app");
          assertEquals(caller.app, CALLER);
          assertEquals(caller.release, CALLER_RELEASE);
          assertEquals(rows[0].actor, `app:${CALLER}`);
          await openTab(flow, "Connections", "connections");
          await flow.until(
            `document.querySelector('${ROW}')?.getAttribute("data-allowed") === "all"`,
            "허락한 범위가 보이지 않는다",
          );
        },
      );

      await t.step(
        "다른 갈래: 사람이 연결을 거두면 새 호출이 막히고 이미 만든 일정은 그대로다",
        async () => {
          await press("[data-remove-connection]");
          await untilDecisionWindow(flow, "grant_approval_request");
          await decide(flow, "grant_approval_request");
          await untilTrue(
            "앱 쌍 grant가 거두어지지 않았다",
            async () => (await pairGrants("revoked")).length === 1,
          );
          callerNonce = await untilReady(
            flow,
            CALLER,
            CALLER_RELEASE,
            "todo가 줄어든 범위로 다시 뜨지 않았다",
            callerNonce,
          );
          await untilTrue(
            "거둔 뒤에도 새 호출이 간다",
            async () => (await addToCalendar(todoId)).startsWith("failed:"),
            30_000,
          );
          assertEquals(await pairGrants("active"), []);
          assertEquals(calendarTitles(home), [itemTitle]);
        },
      );
    } finally {
      await flow.close();
      await removeTree(home);
    }
  },
});
