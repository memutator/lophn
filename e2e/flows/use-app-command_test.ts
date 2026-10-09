// apps#T27 flow use-app-command E2E(docs/flows/use-app-command.md). 이미 허락된 fixture 앱(calendar)의
// command를 대화 agent가 fake-provider로 부른다. 실제 model·coding agent·keychain은 쓰지 않는다.
// 사람 데이터 root(~/.lophn)는 열지 않는다. HOME은 임시 폴더이고 Electron은 LOPHN_SHELL_HEADLESS=1이다.
//
// 이 시험이 보는 것: 허락된 command만 tool이 된다(화면을 연 앱·다른 command는 실행 허락이 아니다),
// 읽기 command는 approval 없이 실제 결과가 대화에 남는다, confirm command는 확인 창의 앱·command를
// 사람이 허락한 뒤 서명 proof로 실행되고 그 결과가 대화에 남는다, 거절하면 실행하지 않고 같은
// 요청이 같은 동작을 다시 묻지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";

import { declarationsOfBlueprint } from "../../packages/apps/releases/mod.ts";
import { prepareFromSource } from "../../packages/apps/releases/prepare/from-source.ts";
import { migrateAppDatabase } from "../../packages/apps/data/worker/migrate.ts";
import { fingerprint, sha256Hex } from "../../packages/base/mod.ts";
import {
  devImportMap,
  readTemplateDirectory,
} from "../../packages/apps/sdk/mod.ts";
import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { startFakeProvider } from "../../tools/fake-provider/mod.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
} from "../flow-support.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw3";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw3";
const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw3";
const GRANT_APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fdw3";
const DATA_SCHEMA = 2;
const FIXTURE = new URL("../../fixtures/apps/calendar/", import.meta.url)
  .pathname;
const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";
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

/** appToolName과 같다. harness가 이름을 export하지 않아 시험이 같은 지문을 만든다. */
async function appToolName(app: string, command: string): Promise<string> {
  const appHash = (await fingerprint(app)).slice(0, 8);
  const commandHash = (await fingerprint(command)).slice(0, 6);
  const readable = command.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
  return `app_${appHash}_${readable}_${commandHash}`;
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

async function prepareCalendar(home: string): Promise<Bundle> {
  const installed = await installedHome([
    "@lophn/cap-net",
    "@lophn/cap-secret",
  ]);
  const parent = await Deno.makeTempDir({ prefix: "lophn-e2e-calendar-src-" });
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
}

/** core를 멈춘 동안 앱·release·agent.commands grant를 심는다. */
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
       VALUES (?, 'calendar', 'Calendar', 'A calendar app', NULL, NULL, ?, 1, '1', 'active')`,
    ).run(APP, RELEASE);
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       VALUES (?, ?, 1, ?, ?, ?, ?, '[]', NULL, 'machine', ?, 'active', NULL, NULL, ?, ?)`,
    ).run(
      RELEASE,
      APP,
      "c".repeat(40),
      bundle.bundleHash,
      bundle.blueprintHash,
      DATA_SCHEMA,
      "2026-10-02T00:00:00.000Z",
      bundle.blueprint,
      JSON.stringify(declarations),
    );
    db.prepare(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
    ).run(RELEASE, "vrf_01h455vb4pex5v6nkc6gd5fdw3");
    db.prepare(
      `INSERT INTO grants (id, app, kind, scope, approval, status, created_by, created_at, revoked_by, revoked_at)
       VALUES (?, ?, 'agent.commands', ?, ?, 'active', 'user', ?, NULL, NULL)`,
    ).run(
      GRANT,
      APP,
      JSON.stringify({
        kind: "agent.commands",
        commands: ["list_events", "delete_all_events"],
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

type ApprovalRow = {
  id: string;
  status: string;
  action?: { command?: string };
};

Deno.test({
  name:
    "apps/blueprint#R20 apps/permissions#R27 lophn-agent/harness/tools#R16 apps/invocations#R7 platform/approvals#R8 flow use-app-command: 허락된 command만 실행되고 confirm은 사람 허락의 proof로 끝나며 거절은 실행하지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const listTool = await appToolName(APP, "list_events");
    const deleteTool = await appToolName(APP, "delete_all_events");
    const addTool = await appToolName(APP, "add_event");
    const externalTool = await appToolName(APP, "create_external_event");
    const provider = startFakeProvider({
      script: {
        steps: [
          reply("list", "", [{ id: "list1", name: listTool, arguments: "{}" }]),
          reply("list-done", "일정이 없습니다."),
          reply("delete", "", [{
            id: "del1",
            name: deleteTool,
            arguments: "{}",
          }]),
          reply("delete-done", "일정을 모두 지웠습니다."),
          reply("reject", "", [{
            id: "del2",
            name: deleteTool,
            arguments: "{}",
          }]),
          reply("reject-again", "", [{
            id: "del3",
            name: deleteTool,
            arguments: "{}",
          }]),
          reply("reject-done", "지우지 않았습니다."),
        ],
      },
      nowMs: () => Date.now(),
      instant: true,
    });
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-use-app-" });
    await Deno.chmod(home, 0o700);
    let opened: FlowShell | undefined;
    try {
      const first = await openFlowShell({ home });
      await first.close();
      const bundle = await prepareCalendar(home);
      seedLedger(home, bundle);
      await seedAppData(home, bundle);
      const flow = await openFlowShell({ home, start: "lophn" });
      opened = flow;
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
          endpoint: provider.url,
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

      const assignments = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: { role: "lophn" },
      });
      const agent = (assignments.assignments as { id: string }[])[0];
      assert(agent !== undefined, "lophn assignment가 없다");
      const runs = async () =>
        (await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        })).runs as {
          id: string;
          state: string;
          outcome: { kind: string } | null;
        }[];
      const approvals = async () =>
        (await mustCall(flow, {
          kind: "read",
          resource: "approvals",
          method: "list",
          body: {},
        })).requests as ApprovalRow[];
      const confirmApprovals = async () =>
        (await approvals()).filter((row) =>
          row.action?.command === "invocation.accept_confirm"
        );
      const invocations = async () =>
        (await mustCall(flow, {
          kind: "read",
          resource: "invocations",
          method: "list",
          body: { app: APP, limit: 50 },
        })).invocations as {
          status: string;
          operation: { kind: string; command?: string };
        }[];
      const succeededDeletes = async () =>
        (await invocations()).filter((row) =>
          row.operation.kind === "command" &&
          row.operation.command === "delete_all_events" &&
          row.status === "succeeded"
        ).length;
      const agentText = async () =>
        String(
          await flow.evaluate(
            `[...document.querySelectorAll("[data-actor='agent'] [data-body='ready']")].map((el) => el.innerText).join("\\n")`,
          ),
        );
      const bodies = () =>
        provider.requests().map((request) => JSON.stringify(request.body));
      const facts = async () =>
        JSON.stringify({
          steps: provider.requests().map((request) => request.matchedStep),
          runs: (await runs()).map((row) => ({
            state: row.state,
            outcome: row.outcome?.kind ?? null,
          })),
          approvals: (await approvals()).map((row) => ({
            id: row.id,
            status: row.status,
            command: row.action?.command,
          })),
          invocations: (await invocations()).map((row) => ({
            status: row.status,
            command: row.operation.command,
          })),
          agent: (await agentText()).slice(0, 300),
          // tool 결과는 다음 판단 본문에 문자열로 들어간다. 실패 문구가 있으면 그 근처만 남긴다.
          tool: (() => {
            const joined = bodies().join("\n");
            const keys = [
              "not reachable",
              "unavailable",
              "forbidden",
              "rows",
              "deleted",
            ];
            return keys.flatMap((key) => {
              const at = joined.indexOf(key);
              return at < 0
                ? []
                : [joined.slice(Math.max(0, at - 30), at + 70)];
            });
          })(),
        });

      await untilTrue("calendar가 쓰기 준비가 되지 않았다", async () => {
        const got = await mustCall(flow, {
          kind: "read",
          resource: "apps",
          method: "runtime",
          body: { app: APP },
        });
        const observation = got.observation as {
          mode: string;
          ready: boolean;
          accepting: boolean;
          release: string | null;
        } | null;
        return observation !== null && observation.mode === "live" &&
          observation.release === RELEASE && observation.ready === true &&
          observation.accepting === true;
      });

      await flow.until(
        `document.querySelector("[data-dock-toggle]") !== null`,
        "도크 토글이 없다",
      );
      await flow.click("[data-dock-toggle]");
      await flow.until(
        `document.querySelector("[data-dock]") !== null`,
        "대화 도크가 열리지 않았다",
      );
      await flow.until(
        `document.querySelector("[data-new-session]") !== null`,
        "새 세션 단추가 서지 않았다",
      );
      await flow.click("[data-new-session]");
      await flow.until(
        `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
        "입력칸이 서지 않았다",
      );

      const explain = async (run: () => Promise<unknown>) => {
        try {
          await run();
        } catch (error) {
          throw new Error(`${(error as Error).message} | ${await facts()}`);
        }
      };
      const send = async (text: string) => {
        // 진행 중이면 입력이 잠기고, 글이 없으면 보내기 단추가 잠긴다. 잠긴 클릭은 요청을 만들지 않는다.
        await explain(() =>
          flow.until(
            `document.querySelector("[data-composer]:not([data-locked])") !== null`,
            "입력이 잠겨 있다",
            60_000,
          )
        );
        await flow.type(INPUT, text);
        await explain(() =>
          flow.until(
            `document.querySelector("[data-send]:not([disabled])") !== null`,
            "보내기 단추가 열리지 않았다",
            30_000,
          )
        );
        await flow.click(SEND);
      };
      const untilCalls = async (count: number) => {
        await explain(() =>
          untilTrue(
            `판단이 ${count}번째 call에 이르지 않았다`,
            () => Promise.resolve(provider.requests().length >= count),
            120_000,
          )
        );
      };
      const untilPending = async (what: string) => {
        await explain(() =>
          untilTrue(what, async () => {
            if (
              (await confirmApprovals()).some((row) => row.status === "pending")
            ) {
              return true;
            }
            // 사람이 기다리기 전에 run이 끝나면 approval은 더 생기지 않는다.
            const latest = (await runs()).at(-1);
            if (latest?.state === "finished") {
              throw new Error(`${what}: run이 끝났다`);
            }
            return false;
          })
        );
      };
      const untilAgent = async (phrase: string) => {
        await untilTrue(
          `대화에 ${phrase}가 없다`,
          async () => (await agentText()).includes(phrase),
        );
      };

      // connect는 url마다 첫 확인 창만 기억한다. 이미 결정한 창에는 단추가 없으므로,
      // 그 결정 단추가 아직 있는 창을 매번 다시 찾는다.
      const inDecisionWindow = (decision: string, expression: string) =>
        flow.shell.mainEvaluate(`(async () => {
          const contents = electron.webContents.getAllWebContents().filter((c) =>
            !c.isDestroyed() && c.getURL().startsWith("lophn-shell://confirmation/")
          );
          for (const contentsItem of contents) {
            const open = await contentsItem.executeJavaScript(${
          JSON.stringify(
            `document.querySelector("[data-decision='${decision}']") !== null`,
          )
        });
            if (open) {
              return await contentsItem.executeJavaScript(${
          JSON.stringify(expression)
        });
            }
          }
          return null;
        })()`);

      /** things-to-confirm에서 확인 창을 열고 `decision`을 누른다. 미리보기만으로는 결정이 아니다. */
      const decide = async (decision: string) => {
        await flow.click('[data-screen="things-to-confirm"]');
        await flow.until(
          `document.querySelector("[data-next='approval']:not([disabled])") !== null`,
          "기다리는 결정이 없다",
          60_000,
        );
        await flow.click("[data-next='approval']");
        await flow.until(
          `document.querySelector("[data-detail] [data-review]") !== null`,
          "결정 상세에 확인 단추가 없다",
        );
        assert(
          (await confirmApprovals()).some((row) => row.status === "pending"),
          "미리보기만으로 결정이 바뀌었다",
        );
        await flow.click("[data-detail] [data-review]");
        await untilTrue("확인 창에 결정 단추가 없다", async () => {
          try {
            return await inDecisionWindow(
              decision,
              `document.querySelector("[data-decision='${decision}']") !== null`,
            ) === true;
          } catch {
            return false;
          }
        }, 30_000);
        const shown = String(
          await inDecisionWindow(
            decision,
            `document.querySelector("[data-layout='confirmation']")?.innerText ?? ""`,
          ),
        );
        assert(
          shown.includes("Calendar"),
          `확인 창에 앱 이름이 없다: ${shown.slice(0, 400)}`,
        );
        assert(
          shown.includes("Delete all events"),
          `확인 창에 command가 없다: ${shown.slice(0, 400)}`,
        );
        assertEquals(
          await inDecisionWindow(
            decision,
            `document.querySelector("[data-kind='confirm_command']") !== null`,
          ),
          true,
        );
        await inDecisionWindow(
          decision,
          `document.querySelector("[data-decision='${decision}']").click()`,
        );
      };

      await t.step(
        "flow 1·2: 돌아가는 앱에서도 허락된 command만 tool이 되고 읽기는 approval 없이 실제 결과를 보인다",
        async () => {
          await send("오늘 일정이 뭐야?");
          await untilCalls(1);
          const first = bodies()[0] ?? "";
          assert(first.includes(listTool), "list_events tool이 없다");
          assert(first.includes(deleteTool), "delete_all_events tool이 없다");
          assert(
            !first.includes(addTool),
            "허락하지 않은 add_event가 tool이다",
          );
          assert(
            !first.includes(externalTool),
            "허락하지 않은 create_external_event가 tool이다",
          );
          await untilAgent("일정이 없습니다.");
          assertEquals(await confirmApprovals(), []);
          const listed = (await invocations()).filter((row) =>
            row.operation.kind === "command" &&
            row.operation.command === "list_events" &&
            row.status === "succeeded"
          );
          assertEquals(
            listed.length,
            1,
            `list가 실행되지 않았다: ${await facts()}`,
          );
          // tool 결과는 판단 본문 안의 문자열이라 JSON을 다시 감싸면 quote가 이스케이프된다.
          assert(
            bodies().slice(1).some((body) => body.includes("rows")),
            `list 결과가 다음 판단에 없다: ${await facts()}`,
          );
          assert(
            !(await agentText()).includes(listTool),
            "대화가 tool 이름을 그대로 보인다",
          );
        },
      );

      await t.step(
        "flow 4·5·6: 확인 창의 앱·command를 허락하면 그 command가 실행되고 실제 결과가 대화에 남는다",
        async () => {
          const before = provider.requests().length;
          await send("일정을 모두 지워 줘.");
          await untilCalls(before + 1);
          await untilPending("confirm approval이 없다");
          await decide("grant_approval_request");
          await untilAgent("일정을 모두 지웠습니다.");
          assertEquals(
            await succeededDeletes(),
            1,
            `delete가 실행되지 않았다: ${await facts()}`,
          );
          assert(
            bodies().some((body) => body.includes("deleted")),
            `delete 결과가 다음 판단에 없다: ${await facts()}`,
          );
          assert(
            (await confirmApprovals()).some((row) => row.status === "granted"),
            "허락이 기록되지 않았다",
          );
          assert(
            !(await agentText()).includes(deleteTool),
            "대화가 tool 이름을 그대로 보인다",
          );
        },
      );

      await t.step(
        "갈래 거절: 사람이 거절하면 command는 실행되지 않고 같은 요청이 같은 동작을 다시 묻지 않는다",
        async () => {
          const before = provider.requests().length;
          await send("다시 모두 지워 줘.");
          await untilCalls(before + 1);
          await untilPending("거절할 approval이 없다");
          const pending = (await confirmApprovals()).find((row) =>
            row.status === "pending"
          );
          assert(pending !== undefined);
          await decide("reject_approval_request");
          await untilTrue(
            "거절이 기록되지 않았다",
            async () =>
              (await confirmApprovals()).some((row) =>
                row.id === pending.id && row.status === "rejected"
              ),
          );
          await untilTrue("거절 뒤 결과가 대화에 없다", async () => {
            const extra = (await confirmApprovals()).filter((row) =>
              row.id !== pending.id
            );
            if (extra.length > 0) {
              throw new Error(
                `같은 요청이 다시 물었다: ${JSON.stringify(extra)}`,
              );
            }
            return (await agentText()).includes("지우지 않았습니다.");
          });
          assertEquals(await succeededDeletes(), 1);
          assert(
            (await confirmApprovals()).every((row) => row.id === pending.id),
            "거절 뒤 새 approval이 있다",
          );
        },
      );
    } finally {
      await provider.close();
      await opened?.close();
      await removeTree(home);
    }
  },
});
