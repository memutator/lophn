// shell#T53 flow app-broken 화면: 깨진 앱 화면에서 알린 문제가 앱 공간 Issues 목록·상세에 core read
// 그대로 보이고, 상세의 [Tried it myself, didn't work]는 같은 문제에 보고를 더한다. 실제 headless
// shell(offscreen 창)·실제 core·실제 깨진 앱 fixture로 돈다(LOPHN_E2E=1).
// - flow app-broken: [View issue]로 그 문제의 상세에 닿고, 증상·본 횟수·지금 상태가 보인다.
// - problems/feedback#R13: Issues에서 다시 연 보고는 그 문제에 더해짐을 미리 보이고 그대로 묶인다.
import { assert, assertEquals } from "@std/assert";

import {
  installedHome,
  removeTree,
} from "../../packages/apps/sdk/testing/mod.ts";
import { APP } from "../broken-app.ts";
import { mustCall } from "../flow-support.ts";
import { e2eEnabled } from "../harness.ts";
import {
  detailText,
  openIssuesShell,
  reportNewProblem,
} from "./issues-support.ts";

Deno.test({
  name:
    "shell#T53 flow app-broken: 알린 문제가 Issues 목록·상세에 보이고 다시 보고는 같은 문제에 더해진다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const shell = await openIssuesShell("lophn-e2e-issues-broken-", {
      installedHome,
      removeTree,
    });
    const { flow } = shell;
    try {
      let problem = "";
      let ourSymptom = "";
      await t.step(
        "[View issue]로 방금 알린 문제의 상세가 열린다",
        async () => {
          problem = await reportNewProblem(
            shell,
            "The Orders board shows an error instead of orders",
          );
          await shell.viewIssue();
          await shell.untilDetail(
            `document.querySelector("[data-issue-detail]") !== null`,
            "Issues 상세가 열리지 않았다",
          );
          const read = await shell.problem(problem);
          const core = read.problem as { status: string };
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-issue-detail]").getAttribute("data-issue-detail")`,
            ),
            core.status,
          );
          assertEquals(
            await detailText(shell, "[data-issue-impact]"),
            read.text,
          );
          assert(
            (await detailText(shell, "[data-issue-seen]")).startsWith(
              "Seen once",
            ),
            await detailText(shell, "[data-issue-seen]"),
          );
          assert(
            (await flow.count("[data-issue-now]")) === 1,
            "지금 상태(누가·수리 진행)가 없다",
          );
          // 현재 release를 아니 [Fixed]는 고를 수 있다.
          assertEquals(
            await flow.evaluate(
              `document.querySelector('[data-issue-choice="fixed"]').disabled`,
            ),
            false,
          );
        },
      );

      await t.step("목록은 core problems/list 그대로다", async () => {
        await flow.click("[data-issue-back]");
        await flow.until(
          `document.querySelector("[data-issues-list] [data-issue-open]") !== null`,
          "Issues 목록이 보이지 않는다",
        );
        const rows = JSON.parse(
          String(
            await flow.evaluate(`JSON.stringify([...document.querySelectorAll(
              "[data-issues-list] [data-issue]",
            )].map((row) => [row.getAttribute("data-issue"), row.querySelector("[data-issue-open]").textContent]))`),
          ),
        ) as [string, string][];
        // 앱이 스스로 남기는 문제가 화면을 읽은 뒤 생길 수 있어 화면 줄은 core 목록의 부분이다.
        const listed = await mustCall(flow, {
          kind: "read",
          resource: "problems",
          method: "list",
          body: { app: APP },
        });
        const coreRows = (listed.problems as {
          id: string;
          status: string;
          symptom: string;
        }[]).map((row) => `${row.status}\n${row.symptom}`);
        assert(rows.length >= 1 && rows.length <= coreRows.length);
        for (const [status, impact] of rows) {
          assert(
            coreRows.includes(`${status}\n${impact}`),
            `core에 없는 줄이다: ${status} ${impact}`,
          );
        }
        const ours = (listed.problems as {
          id: string;
          status: string;
          symptom: string;
        }[]).find((row) => row.id === problem);
        assert(ours !== undefined, "core 목록에 알린 문제가 없다");
        assert(
          rows.some(([status, impact]) =>
            status === ours.status && impact === ours.symptom
          ),
          `목록에 문제가 없다: ${JSON.stringify(rows)}`,
        );
        ourSymptom = ours.symptom;
      });

      await t.step(
        "[Tried it myself, didn't work]는 이 문제에 더하는 보고를 연다",
        async () => {
          // 목록에서 알린 문제의 줄(증상 글)을 눌러 연다.
          await flow.evaluate(`(() => {
            const open = [...document.querySelectorAll("[data-issues-list] [data-issue-open]")]
              .find((el) => el.textContent === ${JSON.stringify(ourSymptom)});
            open.click();
            return true;
          })()`);
          await flow.until(
            `document.querySelector("[data-issue-tried]") !== null`,
            "Issues 상세가 다시 열리지 않았다",
          );
          const before = await shell.problems();
          await flow.click("[data-issue-tried]");
          await shell.untilOverlay();
          assertEquals(
            await shell.existingIssueNotice(),
            "This report is added to the issue you were looking at.",
          );
          await shell.send("Still broken after I reloaded the board");
          const after = await shell.problems();
          assertEquals([...after.keys()].sort(), [...before.keys()].sort());
          assertEquals(after.get(problem), before.get(problem)! + 1);
          await shell.viewIssue();
          await flow.until(
            `document.querySelector("[data-issue-seen]")?.textContent.startsWith("Seen 2 times") === true`,
            "본 횟수가 2로 바뀌지 않았다",
          );
        },
      );
    } finally {
      await shell.close();
    }
  },
});
