// flow manage-tickets(docs/flows/manage-tickets.md). 실제 headless shell·core를 임시 LOPHN_HOME으로 띄우고
// 코드·source·release 없이 등록된 앱 하나(new-app 4단계가 남기는 모양)를 ledger에 심은 뒤 앱 공간의
// 운영 패널 Tasks 탭에서 사람이 하는 일만 실제로 한다. HOME·PATH는 coding fixture(temp HOME, fake Codex만
// 있는 PATH)로 격리해 사람이 설치한 coding agent 제품을 probe하지 않는다.
// - 사람이 제목·원하는 결과·이유만 적어 ticket을 만들면 준비 중(needs_confirmation)으로 남고 [Start]도
//   자기 터미널 문장도 열리지 않는다. 필요한 것은 needs로 보인다.
// - 한 줄 사유로 취소하면 cancelled로 바뀌고 더는 취소·시작할 수 없다. 목록과 core 읽기가 같은 상태다.
// 통로가 없어 볼 수 없는 것: claim·진행 보고·확인 결과·연결 회수는 coding credential(MCP)로만 들어온다.
// credential은 OS keychain 저장이 필요해 이 E2E 범위 밖이다(connect-coding-agent와 같은 이유). 그 순서는
// packages/coding-agent/tickets 시험이 fake ledger로 본다. [Start]는 start-coding-agent flow 몫이다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { e2eEnabled } from "../harness.ts";
import { type FlowShell, openFlowShell, removeHome } from "../flow-support.ts";
import { codingFixture } from "./support.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw2";

// core가 멈춘 동안 앱 하나를 ledger에 직접 심는다. 코드·source·release가 없는 계획 단계 앱이다.
function seedApp(home: string): void {
  const db = new DatabaseSync(join(home, "lophn.db"));
  try {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, '1', 'active')`,
    ).run(APP, "tickets-e2e", "Orders", "Track customer orders");
  } finally {
    db.close();
  }
}

async function tasksTab(flow: FlowShell): Promise<void> {
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
    `document.querySelector('[data-tab-body="tasks"] [data-tasks-empty], [data-tab-body="tasks"] [data-tasks-list]') !== null`,
    "Tasks 목록",
  );
}

async function coreTickets(
  flow: FlowShell,
): Promise<{ id: string; screen_state: string; next_action: string | null }[]> {
  const reply = await flow.call({
    kind: "read",
    resource: "tickets",
    method: "screen_list",
    body: { app: APP },
  });
  assert(reply.ok, JSON.stringify(reply));
  return (reply.value as {
    tickets: { id: string; screen_state: string; next_action: string | null }[];
  }).tickets;
}

async function dump(flow: FlowShell): Promise<string> {
  return String(
    await flow.evaluate(
      `document.querySelector('[data-ops-panel]')?.innerText ?? document.body.innerText`,
    ),
  );
}

Deno.test({
  name:
    "coding-agent/tickets#R1 flow manage-tickets: 사람이 Tasks 탭에서 만든 ticket은 준비 중으로 남아 시작되지 않고 한 줄 사유로 취소된다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const fixture = await codingFixture();
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-tickets-" });
    await Deno.chmod(home, 0o700);
    const first = await openFlowShell({ home, env: fixture.env });
    await first.close();
    seedApp(home);
    const flow = await openFlowShell({
      home,
      start: `app:${APP}`,
      env: fixture.env,
    });
    try {
      await tasksTab(flow);
      assertEquals(await flow.count("[data-tasks-empty]"), 1);

      await t.step(
        "사람은 제목·원하는 결과·이유만 적고 ticket은 준비 중으로 만들어진다",
        async () => {
          await flow.click('[data-action="new-task"]');
          await flow.until(
            `document.querySelector("[data-create-form]") !== null`,
            "만들기 form",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector('[data-action="create-task"]').disabled`,
            ),
            true,
          );
          await flow.type("[data-create-title]", "Show order totals");
          await flow.type(
            "[data-create-what]",
            "Each order shows its total price",
          );
          await flow.type("[data-create-why]", "We check totals by hand today");
          await flow.click('[data-action="create-task"]');
          try {
            await flow.until(
              `document.querySelector("[data-task-detail]") !== null`,
              "만든 ticket 상세",
            );
          } catch (error) {
            throw new Error(`${error}\n${await dump(flow)}`);
          }
          assertEquals(
            await flow.text("[data-task-title]"),
            "Show order totals",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-task-detail]").dataset.taskDetail`,
            ),
            "needs_confirmation",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-task-next]")?.dataset.taskNext ?? null`,
            ),
            "needs_confirmation",
          );
          assertEquals(await flow.count('[data-section="needs"] li'), 1);
          // 준비 중에는 [Start]·자기 터미널 문장·claim 결과가 없다.
          assertEquals(await flow.count('[data-section="own-terminal"]'), 0);
          assertEquals(await flow.count("[data-request-sentence]"), 0);
          assertEquals(await flow.count('[data-action="start"]'), 0);
          const rows = await coreTickets(flow);
          assertEquals(rows.length, 1);
          assertEquals(rows[0].screen_state, "needs_confirmation");
        },
      );

      await t.step(
        "한 줄 사유로 취소하면 cancelled로 바뀌고 다시 취소할 수 없다",
        async () => {
          await flow.click('[data-action="ask-cancel"]');
          await flow.until(
            `document.querySelector("[data-cancel-form]") !== null`,
            "취소 사유 form",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector('[data-action="cancel-task"]').disabled`,
            ),
            true,
          );
          await flow.type(
            "[data-cancel-reason]",
            "Totals moved to the billing app",
          );
          await flow.click('[data-action="cancel-task"]');
          try {
            await flow.until(
              `document.querySelector("[data-task-detail]")?.dataset.taskDetail === "cancelled"`,
              "취소된 ticket",
            );
          } catch (error) {
            throw new Error(`${error}\n${await dump(flow)}`);
          }
          assertEquals(await flow.count('[data-section="cancel"]'), 0);
          assertEquals(await flow.count("[data-cancel-result]"), 0);
          const rows = await coreTickets(flow);
          assertEquals(rows.map((row) => row.screen_state), ["cancelled"]);
          await flow.click("[data-task-back]");
          await flow.until(
            `document.querySelector('[data-tasks-list] [data-task="cancelled"]') !== null`,
            "목록의 취소된 ticket",
          );
          assertEquals(await flow.count("[data-tasks-list] [data-task]"), 1);
        },
      );
    } finally {
      await flow.close();
      await removeHome(home);
      await fixture.remove();
    }
  },
});
