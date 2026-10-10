// apps#T27 flow ask-app-hint E2E(docs/flows/ask-app-hint.md). 허락된 fixture 앱(todo)을 project 작업대의 앱 패널
// 탭으로 열어 둔 채 사람이 대화 도크에서 힌트를 요청한다. 실제 model·coding agent·keychain은 쓰지 않고 model은
// tools/fake-provider다. 사람 데이터 root(~/.lophn)는 열지 않는다. HOME은 임시 폴더이고 Electron은
// LOPHN_SHELL_HEADLESS=1이다.
//
// 이 파일이 지금 보는 것: flow 1(요청한 창의 탭·선택·관측 시각이 turn context로 model 입력에 실린다), flow 2(선언된
// 화면의 read command와 주석 자리 write command만 agent의 tool이 된다), 사람이 앱 패널 열기로 패널 탭을 연다.
// flow 3~6(현재 화면 조회, redaction, 주석 쓰기, revision 충돌, 탭을 닫은 뒤 unavailable)은 제품 결함 하나가 막는다.
// - 결함 (2): agent도 앱 화면도 자기 view_session을 알 길이 없다. turn context의 탭 줄에는 view_session이 없고
//   (`tabLine`은 앱·화면만 쓴다), 앱 화면 URL의 query는 앱 socket 요청에만 붙어 fixture 화면의
//   `?view_session=` 읽기(`editTodo`)는 늘 비어 있다. 그래서 앱은 어느 할 일을 고치는 중인지 알지 못한다.
// flow 1은 저장된 layout(`<home>/shell/layout.json`)의 app_panel 탭을 작업대가 복원한 패널로 시작한다.
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
import {
  type FakeProvider,
  startFakeProvider,
} from "../../tools/fake-provider/mod.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
  PROJECT,
  registerProject,
} from "../flow-support.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw5";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw5";
const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw5";
const GRANT_APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fdw5";
const VERIFICATION = "vrf_01h455vb4pex5v6nkc6gd5fdw5";
const DATA_SCHEMA = 2;
const FIXTURE = new URL("../../fixtures/apps/todo/", import.meta.url).pathname;
const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";
const TODO_TITLE = "Write the report";
const PRIVATE_NOTE = "private-note-7c1d4e";
const INPUT = "[data-composer-input]";
const SEND = "[data-send]";

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

function reply(
  id: string,
  text: string,
  toolCalls?: { id: string; name: string; arguments: string }[],
) {
  return {
    id,
    protocol: "messages" as const,
    reply: {
      ...(text === "" ? {} : { text }),
      ...(toolCalls === undefined ? {} : { toolCalls }),
      usage: { input: 20, output: 8 },
      stop: toolCalls === undefined ? "end" as const : "tool_calls" as const,
    },
  };
}

async function prepareTodo(home: string): Promise<Bundle> {
  const installed = await installedHome(["@lophn/cap-fs"]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-e2e-todo-src-" });
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
  // 사람이 고치는 중인 할 일 하나. private_note는 앱이 민감하다고 선언한 칸이다.
  const db = new DatabaseSync(`${dataArea}/app.sqlite`);
  try {
    db.prepare(
      `INSERT INTO todo (id, title, done, created_at, private_note, version, due)
       VALUES (1, ?, 0, '2026-10-02T00:00:00.000Z', ?, 0, NULL)`,
    ).run(TODO_TITLE, PRIVATE_NOTE);
  } finally {
    db.close();
  }
}

/** core를 멈춘 동안 앱·release·agent.commands grant를 심는다. 이미 있는 fixture 앱 release로 시작한다. */
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
       VALUES (?, 'todo', 'Todo', 'A todo app', NULL, NULL, ?, 1, '1', 'active')`,
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
    ).run(RELEASE, VERIFICATION);
    db.prepare(
      `INSERT INTO grants (id, app, kind, scope, approval, status, created_by, created_at, revoked_by, revoked_at)
       VALUES (?, ?, 'agent.commands', ?, ?, 'active', 'user', ?, NULL, NULL)`,
    ).run(
      GRANT,
      APP,
      JSON.stringify({
        kind: "agent.commands",
        commands: ["todo_context", "hint_todo"],
      }),
      GRANT_APPROVAL,
      "2026-10-02T00:00:00.000Z",
    );
  } finally {
    db.close();
  }
}

async function untilTrue(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    last = await check();
    if (last === true) return;
    await delay(400);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

Deno.test({
  name:
    "shell/workspace#R9 shell/workspace#R11 lophn-agent/harness/prompt-assemble#R25 lophn-agent/harness/prompt-assemble#R26 apps/agent-context#R1 flow ask-app-hint: 앱 패널을 연 채 힌트를 청하면 요청한 창의 탭·선택·관측 시각이 turn context로 model 입력에 실린다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    let provider: FakeProvider | undefined;
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-ask-hint-" });
    const folder = await Deno.makeTempDir({ prefix: "lophn-e2e-ask-hint-ws-" });
    await Deno.chmod(home, 0o700);
    let opened: FlowShell | undefined;
    try {
      const first = await openFlowShell({ home });
      await registerProject(first, { folder, name: "hint", title: "Hint" });
      await first.close();
      // 앱 패널 탭을 저장된 layout으로 심는다. 복원한 선택 탭이 초점 탭이 된다.
      await Deno.mkdir(`${home}/shell`, { recursive: true, mode: 0o700 });
      await Deno.writeTextFile(
        `${home}/shell/layout.json`,
        JSON.stringify({
          schema_version: 1,
          layout: {
            schema_version: 1,
            project: PROJECT,
            window_bounds: { x: 0, y: 0, width: 1440, height: 900 },
            last_space: `project:${PROJECT}`,
            panes: [{
              tabs: [{
                kind: "app_panel",
                key: "app-panel-todo",
                app: APP,
                surface: "todos",
              }],
              selected_tab: "app-panel-todo",
            }],
            split_ratio: 0.5,
            focused_pane: 0,
            information_panel: { open: false, tab: "info" },
          },
        }),
        { mode: 0o600 },
      );
      const bundle = await prepareTodo(home);
      seedLedger(home, bundle);
      await seedAppData(home, bundle);
      const flow = await openFlowShell({ home, start: `project:${PROJECT}` });
      opened = flow;
      await untilTrue("todo가 쓰기 준비가 되지 않았다", async () => {
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
        } | null;
        return observation !== null && observation.mode === "live" &&
          observation.release === RELEASE && observation.ready === true;
      });

      // 앱 패널 view가 서면 page URL의 query가 그 view의 session이다. model 응답의 tool 입력이 이 값을 쓴다.
      const APP_VIEW =
        `electron.webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().startsWith("lophn-app:"))`;
      const viewUrl = async () =>
        String(
          await flow.shell.mainEvaluate(
            `(${APP_VIEW})?.getURL() ?? ""`,
          ),
        );
      await flow.until(
        `document.querySelector("[data-app-panel='${APP}']") !== null`,
        "앱 패널이 서지 않았다",
        60_000,
      );
      let lastUrl = "";
      await untilTrue(
        "앱 패널 view의 session이 page URL에 없다",
        async () => {
          lastUrl = await viewUrl();
          return lastUrl.includes("?view_session=");
        },
        30_000,
      ).catch((error) => {
        throw new Error(
          `${(error as Error).message} url=${lastUrl} ${await flow.shell
            .mainEvaluate(
              `JSON.stringify(electron.webContents.getAllWebContents().map((c) => c.isDestroyed() ? "x" : c.getURL()))`,
            )} ${await flow.evaluate(
              `document.querySelector("[data-app-panel]")?.innerText ?? "nopanel"`,
            )}`,
        );
      });
      const SESSION = new URL(await viewUrl()).searchParams.get(
        "view_session",
      )!;
      const readArgs = {
        app: APP,
        screen: "todos",
        view_session: SESSION,
        detail: true,
      };
      provider = startFakeProvider({
        script: {
          steps: [
            reply("hint-1", "지금 보는 할 일을 확인하겠습니다."),
            reply("hint-2", "화면을 다시 확인하겠습니다."),
            reply("read", "", [{
              id: "read1",
              name: "app.screen_context",
              arguments: JSON.stringify(readArgs),
            }]),
            reply("read-done", "읽었습니다."),
          ],
        },
        nowMs: () => Date.now(),
        instant: true,
      });
      const fake = provider;
      await mustCall(flow, {
        kind: "command",
        resource: "providers",
        method: "register",
        body: commandBody({
          id: PROVIDER,
          name: "fixture",
          definition: {
            key: "anthropic",
            display_name: "Anthropic",
            protocols: ["anthropic-messages"],
            auth_kinds: ["none"],
            models_endpoint: null,
            oauth: null,
            revision: "2026-01-01",
          },
          endpoint: fake.url,
          protocol: "anthropic-messages",
        }),
      });
      const defaults = await mustCall(flow, {
        kind: "read",
        resource: "agent-model-defaults",
        method: "read",
        body: {},
      });
      const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
      await mustCall(flow, {
        kind: "command",
        resource: "agent-model-defaults",
        method: "change",
        body: commandBody(
          {
            judgment: {
              provider: PROVIDER,
              credentials: [],
              model_name: MODEL,
              reasoning_level: "provider_default",
              options: {},
            },
            organizing: null,
            settings_seq: seq,
          },
          { settings_seq: seq },
        ),
      });
      const agentText = async () =>
        String(
          await flow.evaluate(
            `[...document.querySelectorAll("[data-actor='agent'] [data-body='ready']")].map((el) => el.innerText).join("\\n")`,
          ),
        );
      const send = async (text: string) => {
        await flow.until(
          `document.querySelector("[data-composer]:not([data-locked])") !== null`,
          "입력이 잠겨 있다",
          60_000,
        );
        await flow.type(INPUT, text);
        await flow.until(
          `document.querySelector("[data-send]:not([disabled])") !== null`,
          "보내기 단추가 열리지 않았다",
          30_000,
        );
        await flow.click(SEND);
      };
      const untilCalls = (count: number) =>
        untilTrue(
          `판단이 ${count}번째 call에 이르지 않았다`,
          () => Promise.resolve(fake.requests().length >= count),
          120_000,
        );
      const bodyOf = (index: number) =>
        JSON.stringify(fake.requests()[index]?.body ?? null);

      await t.step(
        "flow 1: 앱 패널을 연 채 힌트를 청하면 그 창의 탭·선택·관측 시각이 현재 보기로 model 입력에 실린다",
        async () => {
          // 복원한 앱 패널의 앱 view가 실제로 선다.
          await flow.until(
            `document.querySelector("[data-app-panel='${APP}']") !== null`,
            "앱 패널이 서지 않았다",
          );
          await flow.until(
            `document.querySelector("[data-dock-toggle]") !== null`,
            "도크 토글이 없다",
          );
          await flow.click("[data-dock-toggle]");
          await flow.until(
            `document.querySelector("[data-new-session]") !== null || document.querySelector(${
              JSON.stringify(INPUT)
            }) !== null`,
            "새 세션 단추가 서지 않았다",
          );
          if (
            await flow.evaluate(
              `document.querySelector(${JSON.stringify(INPUT)}) === null`,
            ) === true
          ) {
            await flow.click("[data-new-session]");
          }
          await flow.until(
            `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
            "입력칸이 서지 않았다",
          );
          // 창의 보기 generation이 publish될 시간을 준다.
          await delay(1_500);
          await send("지금 보고 있는 할 일에 힌트를 줘.");
          await untilCalls(1);
          const first = bodyOf(0);
          for (const word of ["[turn context]", "화면 관측:"]) {
            assert(first.includes(word), `turn context에 ${word}가 없다`);
          }
          assert(!first.includes("화면: 없음"), "현재 보기가 없는 것으로 왔다");
          // 선택한 앱 패널이 초점 탭으로 앞서고 앱과 화면 key를 짧은 참조로만 담는다.
          const turn = (first.split("[turn context]").at(-1) ?? "").replaceAll(
            "\\n",
            "\n",
          );
          assert(
            new RegExp(
              `- \\* app_panel \\S+ ${APP} todos view_session=${SESSION}`,
            ).test(turn),
            `선택한 app_panel 탭 줄이 없다: ${turn.slice(0, 600)}`,
          );
          // DOM·screenshot을 자동으로 모으지 않는다. 화면 글자와 앱 내부 값은 이 입력에 없다.
          for (const leaked of ["data:image", "<html", "private_note"]) {
            assert(!first.includes(leaked), `${leaked}가 입력에 있다`);
          }
          await untilTrue(
            "대화에 답이 없다",
            async () => (await agentText()).includes("확인하겠습니다"),
          );
        },
      );

      await t.step({
        name:
          "apps/agent-context#R1 apps/agent-context#R2 lophn-agent/harness/tools#R18 flow ask-app-hint 2: 선언된 화면의 read command와 주석 자리 write command만 agent의 tool이 된다",
        fn: async () => {
          const before = fake.requests().length;
          await send("한 번 더 보고 힌트를 줘.");
          await untilCalls(before + 1);
          const offered = bodyOf(before);
          assert(offered.includes("app.screen_context"), "조회 tool이 없다");
          assert(offered.includes("app.annotate"), "주석 tool이 없다");
          assertEquals(
            offered.includes("add_todo"),
            false,
            "허락하지 않은 command가 tool이다",
          );
        },
      });
      const inApp = (expression: string) =>
        flow.shell.mainEvaluate(
          `(${APP_VIEW}).executeJavaScript(${JSON.stringify(expression)})`,
        );
      const toolResults = (from: number) =>
        fake.requests().slice(from).map((request) =>
          JSON.stringify(request.body)
        );

      await t.step(
        "apps/agent-context#R2 apps/agent-context#R4 lophn-agent/harness/tools#R18 flow ask-app-hint 3: 사람이 앱에서 고치는 중인 할 일이 선언한 read command로 조회되고 민감한 칸은 상세에 없다",
        async () => {
          // 사람이 앱 화면에서 할 일 하나의 편집을 시작한다. 화면은 자기 view_session을 page URL에서 읽어 앱에 알린다.
          await untilTrue("편집 단추가 없다", async () =>
            await inApp(
              `[...document.querySelectorAll("button")].some((el) => el.textContent.trim() === "Edit")`,
            ) === true);
          await inApp(
            `[...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Edit").click()`,
          );
          await untilTrue("편집이 시작되지 않았다", async () =>
            await inApp(
              `[...document.querySelectorAll("button")].some((el) => el.textContent.trim() === "Editing")`,
            ) === true);
          await delay(1_500);
          const before = fake.requests().length;
          await send("지금 고치는 할 일을 자세히 읽어 줘.");
          await untilCalls(before + 2);
          const [result] = toolResults(before + 1);
          // 앱이 이 view의 상태를 돌려줬다: 요약·상세·revision.
          for (
            const word of [
              `Editing todo #1`,
              TODO_TITLE,
              `"availability`,
              "created_at",
              "1.0",
            ]
          ) {
            assert(
              result?.includes(word),
              `조회 결과에 ${word}가 없다: ${result}`,
            );
          }
          // 민감하다고 선언한 칸의 값은 요약·상세·어느 model 입력에도 없다.
          for (const body of toolResults(0)) {
            assert(
              !body.includes(PRIVATE_NOTE),
              "민감한 칸 값이 model 입력에 있다",
            );
          }
          await untilTrue(
            "대화에 답이 없다",
            async () => (await agentText()).includes("읽었습니다."),
          );
        },
      );

      // 이 step은 새 앱 패널 탭을 더해 초점 탭을 바꾸므로 맨 뒤에 둔다.
      await t.step(
        "shell/workspace#R1 shell/workspace#R5 flow ask-app-hint: 사람이 프로젝트 탭의 앱 패널 열기로 앱의 패널 화면을 고르면 새 앱 패널 탭이 선다",
        async () => {
          const panels = () =>
            flow.evaluate(
              `document.querySelectorAll("[data-app-panel='${APP}']").length`,
            );
          assertEquals(await panels(), 1);
          await flow.until(
            `document.querySelector("[data-open-app-panel]") !== null`,
            "앱 패널 열기 단추가 서지 않았다",
          );
          await flow.click("[data-open-app-panel]");
          await flow.until(
            `document.querySelector("[data-app-panel-picker] li button") !== null`,
            "앱 패널 고르기에 화면이 없다",
          );
          await flow.click("[data-app-panel-picker] li button");
          await flow.until(
            `document.querySelectorAll("[data-app-panel='${APP}']").length === 2`,
            "고른 앱 패널 탭이 서지 않았다",
          );
        },
      );
    } finally {
      await provider?.close();
      await opened?.close();
      await removeTree(home);
      await removeTree(folder);
    }
  },
});
