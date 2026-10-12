// Issues 화면 E2E 공용 조립. 실제 headless shell·core에 깨진 앱 fixture를 띄우고,
// 사람이 [Report a problem]으로 실제 문제를 만든 뒤 [View issue]로 앱 공간 Issues 상세에 닿는다.
// 문제·보고는 core command(problems SubmitFeedback)가 만든 것이고 화면은 core read를 그대로 보인다.
import { assert, assertEquals } from "@std/assert";

import {
  APP,
  type BrokenAppTools,
  type Page,
  pageClick,
  pageType,
  prepareBrokenApp,
  seedLedger,
  untilPage,
} from "../broken-app.ts";
import {
  delay,
  type FlowShell,
  mustCall,
  openFlowShell,
} from "../flow-support.ts";

export interface IssuesShell {
  readonly flow: FlowShell;
  /** 이 앱의 문제 ID → 보고 수(사람 token의 problems 읽기). */
  problems(): Promise<Map<string, number>>;
  /** core problems/get 그대로. */
  problem(id: string): Promise<Record<string, unknown>>;
  /** 열린 feedback dialog에 글을 쓰고 보내 접수까지 기다린다. */
  send(text: string): Promise<void>;
  /** [Report a problem]으로 dialog를 연다. */
  pressReport(): Promise<void>;
  /** 다른 길(Issues 상세)로 연 dialog가 설 때까지. */
  untilOverlay(): Promise<void>;
  /** 열린 dialog의 기존 문제 안내. */
  existingIssueNotice(): Promise<string>;
  /** 접수 뒤 [View issue]를 눌러 dialog를 닫는다. */
  viewIssue(): Promise<void>;
  /** desktop 창의 Issues 상세가 이 조건을 만족할 때까지. */
  untilDetail(condition: string, message: string): Promise<void>;
  close(): Promise<void>;
}

/** core 한 번으로 DB를 만들고 앱을 심은 뒤 앱 공간부터 띄워 [Report a problem]이 켜질 때까지. */
export async function openIssuesShell(
  prefix: string,
  tools: BrokenAppTools,
): Promise<IssuesShell> {
  const home = await Deno.makeTempDir({ prefix });
  await Deno.chmod(home, 0o700);
  const first = await openFlowShell({ home });
  await first.close();
  const bundle = await prepareBrokenApp(home, tools);
  seedLedger(home, bundle);
  const flow = await openFlowShell({ home, start: `app:${APP}` });
  let overlay: Page | undefined;
  const shell: IssuesShell = {
    flow,
    async problems() {
      const listed = await mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "list",
        body: { app: APP },
      });
      const out = new Map<string, number>();
      for (const row of listed.problems as { id: string }[]) {
        const got = await shell.problem(row.id);
        out.set(row.id, Number(got.report_count));
      }
      return out;
    },
    problem(id) {
      return mustCall(flow, {
        kind: "read",
        resource: "problems",
        method: "get",
        body: { problem: id },
      });
    },
    async pressReport() {
      await flow.until(
        `document.querySelector('[data-report-problem]:not([disabled])') !== null`,
        "[Report a problem]이 켜지지 않았다",
      );
      await flow.click("[data-report-problem]");
      await shell.untilOverlay();
    },
    async untilOverlay() {
      overlay ??= await flow.shell.connect("lophn-shell://overlay/index.html");
      await untilPage(
        overlay,
        `document.querySelector('[data-feedback="text"]') !== null && document.querySelector('[data-feedback-phase="received"]') === null`,
        "dialog가 열리지 않았다",
      );
    },
    async existingIssueNotice() {
      return String(
        await overlay!.evaluate(
          `document.querySelector('[data-feedback="existing-issue"]').textContent`,
        ),
      );
    },
    async send(text) {
      await pageType(overlay!, '[data-feedback="text"]', text);
      await untilPage(
        overlay!,
        `!document.querySelector('[data-feedback="send"]').disabled`,
        "[Send report]가 켜지지 않았다",
      );
      await pageClick(overlay!, '[data-feedback="send"]');
      await untilPage(
        overlay!,
        `document.querySelector('[data-feedback-phase="received"]') !== null`,
        "접수 완료가 보이지 않는다",
      );
    },
    async viewIssue() {
      await pageClick(overlay!, '[data-feedback="view-issue"]');
      await untilPage(
        overlay!,
        `document.querySelector("[data-feedback-phase]") === null`,
        "dialog가 닫히지 않았다",
      );
    },
    async untilDetail(condition, message) {
      await flow.until(condition, message);
    },
    async close() {
      try {
        await flow.close();
      } finally {
        await tools.removeTree(home);
      }
    },
  };
  try {
    await flow.until(
      `document.querySelector("[data-space]")?.getAttribute("data-space") === "app"`,
      "앱 공간이 서지 않았다",
    );
    // 앱이 뜨기 전에 열려 한 번 실패한 화면은 사람이 [Reload]로 다시 연다.
    const deadline = Date.now() + 60_000;
    for (;;) {
      const runtime = await mustCall(flow, {
        kind: "read",
        resource: "apps",
        method: "runtime",
        body: { app: APP },
      });
      if ((runtime.state as { state: string }).state === "running") break;
      assert(Date.now() < deadline, "앱이 뜨지 않았다");
      await delay(500);
    }
    await flow.until(
      `document.querySelector('[data-phase="failed"] button') !== null || document.querySelector('[data-report-problem]:not([disabled])') !== null`,
      "화면 상태가 오지 않았다",
    );
    if ((await flow.count('[data-phase="failed"] button')) > 0) {
      await flow.click('[data-phase="failed"] button');
    }
    await flow.until(
      `document.querySelector('[data-report-problem]:not([disabled])') !== null`,
      "[Report a problem]이 켜지지 않았다",
    );
    await delay(1_000);
  } catch (error) {
    await shell.close();
    throw error;
  }
  return shell;
}

/** 깨진 화면에서 처음 알린 문제 하나를 만들고 그 ID를 돌려준다. */
export async function reportNewProblem(
  shell: IssuesShell,
  text: string,
): Promise<string> {
  const before = await shell.problems();
  await shell.pressReport();
  await shell.send(text);
  const after = await shell.problems();
  const added = [...after.keys()].filter((id) => !before.has(id));
  assertEquals(added.length, 1, "새 문제가 하나 생기지 않았다");
  return added[0]!;
}

/** desktop 창 Issues 상세의 한 요소 글. */
export async function detailText(
  shell: IssuesShell,
  selector: string,
): Promise<string> {
  return String(
    await shell.flow.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
    ),
  );
}
