// shell#T53 flow verify-app-repair 화면: Issues 상세의 [Fixed]·[Not fixed]가 보호 창(confirmation
// window)을 열고, 사람이 그 창에서 누른 결정이 실제 core ApplyProblemDecision으로 문제를 닫고 다시
// 연다. 실제 headless shell(offscreen 창)·실제 core·실제 깨진 앱 fixture로 돈다(LOPHN_E2E=1).
// - flow verify-app-repair 6·7: 사람이 보호 화면에서 “내가 확인함”으로 닫고 닫힌 이유를 보며,
//   아직 이상하다고 하면 같은 문제를 다시 연다(problems/closing#R6, R10, shell/confirmation-window#R9).
import { assert, assertEquals } from "@std/assert";

import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { delay } from "../flow-support.ts";
import { e2eEnabled } from "../harness.ts";
import {
  detailText,
  type IssuesShell,
  openIssuesShell,
  reportNewProblem,
} from "./issues-support.ts";

const CONFIRMATION =
  `electron.webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().startsWith("lophn-shell://confirmation/"))`;

/** 열린 보호 창 renderer에서 표현식을 평가한다(창이 없으면 null). */
function inConfirmation(shell: IssuesShell, expression: string) {
  return shell.flow.shell.mainEvaluate(`(() => {
    const c = ${CONFIRMATION};
    return c ? c.executeJavaScript(${JSON.stringify(expression)}) : null;
  })()`);
}

/** 보호 창이 이 결정으로 서면 사람처럼 결정 버튼을 누른다. */
async function confirmInWindow(
  shell: IssuesShell,
  choice: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const shown = await inConfirmation(
      shell,
      `document.querySelector('[data-decision="ApplyProblemDecision"]:not([disabled])')?.getAttribute("data-choice") ?? null`,
    );
    if (shown === choice) break;
    assert(Date.now() < deadline, `보호 창이 ${choice} 결정으로 서지 않았다`);
    await delay(250);
  }
  assertEquals(
    await inConfirmation(
      shell,
      `(() => { document.querySelector('[data-decision="ApplyProblemDecision"]').click(); return true; })()`,
    ),
    true,
  );
}

async function untilStatus(
  shell: IssuesShell,
  problem: string,
  status: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const read = await shell.problem(problem);
    if ((read.problem as { status: string }).status === status) return read;
    assert(Date.now() < deadline, `문제가 ${status}가 되지 않았다`);
    await delay(250);
  }
}

Deno.test({
  name:
    "shell#T53 flow verify-app-repair: Issues의 결정이 보호 창을 거쳐 실제 core에서 문제를 닫고 다시 연다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const shell = await openIssuesShell("lophn-e2e-issues-verify-", {
      installedHome,
      removeTree,
    });
    const { flow } = shell;
    try {
      const problem = await reportNewProblem(
        shell,
        "The Orders board shows an error instead of orders",
      );
      await shell.viewIssue();
      await flow.until(
        `document.querySelector('[data-issue-choice="fixed"]:not([disabled])') !== null`,
        "Issues 상세의 [Fixed]가 켜지지 않았다",
      );

      await t.step(
        "[Fixed]는 보호 창에서 확인해야 “내가 확인함”으로 닫힌다",
        async () => {
          await flow.click('[data-issue-choice="fixed"]');
          await flow.until(
            `document.querySelector("[data-issue-waiting]") !== null`,
            "결정 대기 안내가 없다",
          );
          // 창에서 답하기 전에는 닫히지 않는다.
          assertEquals(
            ((await shell.problem(problem)).problem as { status: string })
              .status,
            "open",
          );
          await confirmInWindow(shell, "fixed");
          const read = await untilStatus(shell, problem, "closed");
          const closure = (read.problem as {
            closure: { reason: string; verification: unknown };
          }).closure;
          assertEquals(closure.reason, "user_confirmed");
          // 사람의 확인은 테스트 통과를 만들지 않는다.
          assertEquals(closure.verification, null);
          await flow.until(
            `document.querySelector('[data-issue-closed="user_confirmed"]') !== null`,
            "Issues 상세가 닫힌 이유를 보이지 않는다",
          );
          assert(
            (await detailText(shell, "[data-issue-attention]")).length > 0,
            "지금 필요한 주의가 없다",
          );
          // 닫힌 문제에는 아직 이상함만 남는다.
          assertEquals(
            await flow.count("[data-issue-choice]"),
            1,
          );
          assertEquals(await flow.count('[data-issue-choice="not_fixed"]'), 1);
        },
      );

      await t.step(
        "[Not fixed]는 보호 창을 거쳐 같은 문제를 다시 연다",
        async () => {
          const before = [...(await shell.problems()).keys()].sort();
          await flow.click('[data-issue-choice="not_fixed"]');
          await confirmInWindow(shell, "not_fixed");
          const read = await untilStatus(shell, problem, "open");
          assertEquals((read.problem as { closure: unknown }).closure, null);
          await flow.until(
            `document.querySelector('[data-issue-detail="open"]') !== null && document.querySelector("[data-issue-closed]") === null`,
            "Issues 상세가 다시 열린 문제를 보이지 않는다",
          );
          // 같은 문제 ID로 다시 열렸다(새 문제를 만들지 않았다).
          assertEquals([...(await shell.problems()).keys()].sort(), before);
        },
      );
    } finally {
      await shell.close();
    }
  },
});
