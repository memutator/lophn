// flow start-coding-agent(docs/flows/start-coding-agent.md). 실제 headless shell·core를 임시 LOPHN_HOME으로
// 띄우고, 등록한 앱·등록 project 폴더·실행 준비가 끝난 ticket을 ledger에 심은 뒤 앱 운영 패널 Tasks 탭에서
// 사람이 하는 일을 한다. harness는 PATH fixture의 fake Codex뿐(또는 하나도 없음)이고 HOME은 temp dir이라
// 사람이 설치한 실제 coding agent 제품을 probe하지 않는다. 연결 행은 심지 않는다(성공을 꾸미지 않는다).
// - 1단계: 실행 준비가 끝난 ticket은 자기 터미널 문장이 열리고 시작 자리가 보인다. 연결이 없으면 [Start]를
//   내지 않고 연결부터 만들라고만 한다. 감지된 harness가 없으면 harness부터라고 한다. 둘 다 아무것도 시작하지
//   않고 process·session이 남지 않는다.
// - 3단계 refusal: 사람이 누른 값이 오래됐거나(읽을 수 없는 연결) 하면 shell main이 다시 검사해 시작하지 않고
//   한 문장 이유만 보인다. 다른 harness·연결·폴더로 바꿔 시작하지 않는다.
// 통로가 없어 볼 수 없는 것: [Start]를 실제로 누르는 것(활성 연결이 있어야 열린다), harness version·adapter
// 거절, 4~5단계 PTY가 열린 뒤 TUI 상태·MCP claim·완료 보고는 연결 성공(coding credential·OS keychain 보관)과
// 시험용 TUI가 필요하다. 시험은 실제 keychain을 열지 않고 제품 core에 시험 전용 길을 두지 않으며 연결 행을
// 심어 성공을 꾸미지도 않으므로 이 E2E 범위 밖이다(connect-coding-agent와 같은 이유).
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { e2eEnabled } from "../harness.ts";
import {
  type FlowShell,
  openFlowShell,
  registerProject,
  removeHome,
} from "../flow-support.ts";
import { type CodingFixture, codingFixture } from "./support.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw3";
const TICKET = "tkt_01h455vb4pex5v6nkc6gd5fdw3";

// core가 멈춘 동안 앱·ticket을 ledger에 직접 심는다.
function seed(home: string): void {
  const db = new DatabaseSync(join(home, "lophn.db"));
  try {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, '1', 'active')`,
    ).run(APP, "start-e2e", "Orders", "Track customer orders");
    db.prepare(
      `INSERT INTO tickets (id, app, kind, title, what, why, inspect, preserve, problems, state, readiness, needs, revision)
       VALUES (?, ?, 'implementation', 'Show order totals', 'Each order shows its total price', 'We check totals by hand today', '[]', '[]', '[]', 'open', 'ready', '[]', '1')`,
    ).run(TICKET, APP);
  } finally {
    db.close();
  }
}

async function openTask(flow: FlowShell): Promise<void> {
  const ready = await flow.call({
    kind: "read",
    resource: "tickets",
    method: "screen_list",
    body: { app: APP },
  });
  assert(ready.ok, `core가 준비되지 않았다 ${JSON.stringify(ready)}`);
  await flow.until(
    `document.querySelector('[data-app-bar="app-details"]') !== null`,
    "앱 막대",
  );
  await flow.click('[data-app-bar="app-details"]');
  await flow.until(
    `document.querySelector("[data-ops-panel]") !== null`,
    "운영 패널",
  );
  await flow.mouseClickText("[role=tab]", "Tasks");
  await flow.until(
    `document.querySelector('[data-tasks-list] [data-task="ready"]') !== null`,
    "실행 준비가 끝난 ticket",
  );
  await flow.click("[data-task-open]");
  await flow.until(
    `document.querySelector('[data-section="start"]') !== null`,
    "시작 자리",
  );
}

async function sessions(flow: FlowShell): Promise<string> {
  return String(
    await flow.evaluate(
      `window.lophnCoding.sessions().then((reply) => JSON.stringify(reply))`,
    ),
  );
}

async function dump(flow: FlowShell): Promise<string> {
  return String(
    await flow.evaluate(
      `document.querySelector('[data-ops-panel]')?.innerText ?? document.body.innerText`,
    ),
  );
}

// 앱 하나·등록 project 폴더 하나·실행 준비가 끝난 ticket 하나가 있는 shell을 연다.
async function openSeeded(
  fixture: CodingFixture,
  home: string,
  folder: string,
): Promise<{ flow: FlowShell; project: string }> {
  const first = await openFlowShell({ home, env: fixture.env });
  const { project } = await registerProject(first, { folder });
  await first.close();
  seed(home);
  const flow = await openFlowShell({
    home,
    start: `app:${APP}`,
    env: fixture.env,
  });
  return { flow, project };
}

async function withSeeded(
  options: { noHarness: boolean },
  run: (
    seeded: { flow: FlowShell; project: string; folder: string },
  ) => Promise<void>,
): Promise<void> {
  const fixture = await codingFixture(options);
  const home = await Deno.makeTempDir({ prefix: "lophn-e2e-start-" });
  await Deno.chmod(home, 0o700);
  const folder = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-e2e-start-src-" }),
  );
  let flow: FlowShell | undefined;
  try {
    const seeded = await openSeeded(fixture, home, folder);
    flow = seeded.flow;
    await run({ ...seeded, folder });
  } finally {
    await flow?.close();
    await removeHome(home);
    await Deno.remove(folder, { recursive: true });
    await fixture.remove();
  }
}

async function noSession(flow: FlowShell): Promise<void> {
  assertEquals(await flow.count('[data-section="tui"]'), 0);
  assertEquals(await sessions(flow), '{"ok":true,"value":[]}');
}

Deno.test({
  name:
    "coding-agent/sessions#R4 flow start-coding-agent: 실행 준비가 끝난 ticket도 연결이 없으면 [Start]를 내지 않고, 오래된 연결로 보낸 시작은 한 문장 이유로 거절된다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await withSeeded(
      { noHarness: false },
      async ({ flow, project }) => {
        await openTask(flow);

        await t.step(
          "1. 실행 준비가 끝난 ticket은 자기 터미널 문장이 열리고 연결이 없으면 [Start] 대신 연결부터라고만 한다",
          async () => {
            assertEquals(
              await flow.evaluate(
                `document.querySelector("[data-task-detail]").dataset.taskDetail`,
              ),
              "ready",
            );
            assertEquals(
              await flow.evaluate(
                `document.querySelector("[data-task-next]").dataset.taskNext`,
              ),
              "start",
            );
            assertEquals(
              await flow.evaluate(
                `document.querySelector("[data-start-missing]").dataset.startMissing`,
              ),
              "connection",
            );
            assertEquals(await flow.count('[data-action="start"]'), 0);
            assert(
              (await flow.text("[data-request-sentence]"))?.includes(TICKET),
              "자기 터미널 문장에 ticket이 없다",
            );
            await noSession(flow);
          },
        );

        await t.step(
          "3. 읽을 수 없는 연결로 온 시작 요청은 한 문장 이유로 거절되고 아무것도 열리지 않는다",
          async () => {
            const reply = JSON.parse(
              String(
                await flow.evaluate(
                  `window.lophnCoding.detect().then((detected) => {
                  const codex = detected.value.harnesses.find((item) => item.harness_id === "codex");
                  return window.lophnCoding.start({
                    ticket: ${JSON.stringify(TICKET)},
                    ticket_revision: "1",
                    connection: "cac_01h455vb4pex5v6nkc6gd5fdw9",
                    harness_id: "codex",
                    profile_id: codex.profile_id,
                    project: ${JSON.stringify(project)},
                    folder_ref: ${JSON.stringify(`${project}_0`)},
                  });
                }).then((reply) => JSON.stringify(reply))`,
                ),
              ),
            );
            assertEquals(reply.ok, true, JSON.stringify(reply));
            assertEquals(reply.value.ok, false, JSON.stringify(reply));
            assertEquals(
              reply.value.reason,
              "connection_unavailable",
              JSON.stringify(reply),
            );
            await noSession(flow);
          },
        );
      },
    );
  },
});

Deno.test({
  name:
    "coding-agent/sessions#R1 flow start-coding-agent: 감지된 harness가 없으면 실행 준비가 끝난 ticket도 harness부터라고만 하고 시작을 내지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withSeeded({ noHarness: true }, async ({ flow }) => {
      await openTask(flow);
      assertEquals(
        await flow.evaluate(
          `document.querySelector("[data-start-missing]").dataset.startMissing`,
        ),
        "harness",
      );
      assertEquals(await flow.count('[data-action="start"]'), 0);
      assertEquals(await flow.count("[data-start-choice]"), 0);
      await noSession(flow);
    });
  },
});
