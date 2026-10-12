// shell#T25: flow project-workspace의 터미널 단계. 실제 Electron shell·terminal host와
// 실제 core를 임시 LOPHN_HOME으로 띄운다. 개발 시드 작업대의 프로젝트에 임시 폴더 둘을
// 등록 폴더로 주고(LOPHN_DEV_SEED_FOLDERS), 복원된 터미널 탭에서 사람이 시작·입력·
// 종료·다시 시작·다시 붙기·닫기 확인을 한다. 사람이 core에 프로젝트를 만들고 shell이
// 그 등록 폴더를 read로 읽는 길은 documents·platform 쪽이 열면 이 시드를 대신한다.
// - shell/workspace#R7: 복원한 터미널 탭은 PTY 없이 종료 자리표시다.
// - shell/terminal#R1, R6: 여러 등록 폴더는 고르기 전에 시작하지 않고, 첫 열기 안내는
//   OS 사용자 권한과 시작 위치를 다른 문장으로 보인다. 고른 폴더가 실제 시작 위치다.
// - shell/terminal#R3: focus 칸의 터미널만 입력을 받는다.
// - shell/terminal#R8: renderer를 다시 읽어도 살아 있는 host buffer가 다시 보인다.
// - shell/terminal#R9: 확인된 exit code를 출력 옆에 두고 다시 시작은 누를 때만이다.
// - shell/terminal#R10, R11: 닫기는 overlay dialog로 묻고 취소하면 유지한다. OSC 8
//   링크 출력은 링크가 되지 않는다.
// 화면이 없거나 LOPHN_E2E가 없으면 건너뛴다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { launchShell, type PageSession, type RunningShell } from "../run.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const electronExecutable =
  `${repoRoot}/packages/shell/main/node_modules/electron/dist/electron`;
const shellApp = `${repoRoot}/packages/shell/main/dist/main.cjs`;

async function runBuild(args: string[], failure: string): Promise<void> {
  const build = new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: "inherit",
    stderr: "inherit",
  });
  assertEquals((await build.output()).code, 0, failure);
}

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function waitFor(
  evaluate: (expression: string) => Promise<unknown>,
  expression: string,
  expected: unknown,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(expression);
    } catch (error) {
      last = String(error);
    }
    if (last === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `기대한 상태가 오지 않았다: ${expression} → ${JSON.stringify(last)}`,
  );
}

/** 사람처럼 요소 가운데를 누른다. pointerdown이 칸 focus를 옮긴다. */
async function clickAt(
  shell: RunningShell,
  page: PageSession,
  selector: string,
): Promise<void> {
  const rect = await shell.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`) as { x: number; y: number } | null;
  assert(rect, `누를 요소가 없다: ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.command("Input.dispatchMouseEvent", {
      type,
      x: rect.x,
      y: rect.y,
      button: "left",
      clickCount: 1,
    });
  }
}

async function typeLine(page: PageSession, text: string): Promise<void> {
  await page.command("Input.insertText", { text });
  for (const type of ["keyDown", "keyUp"]) {
    await page.command("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      ...(type === "keyDown" ? { text: "\r" } : {}),
    });
  }
}

const screenText = `(() => document.querySelector(
  '[data-terminal-tab="term_1"] .xterm-rows')?.textContent ?? "")()`;

Deno.test({
  name:
    "e2e shell/terminal#R1 + shell/workspace#R7: 복원한 터미널 탭에서 사람이 폴더를 골라 시작하고 입력·종료·다시 시작·다시 붙기·닫기 확인을 한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await runBuild(
      ["npm", "--prefix", `${repoRoot}/packages/shell/main`, "run", "build"],
      "shell main build 실패",
    );
    await runBuild(
      [
        "deno",
        "run",
        "--allow-all",
        `${repoRoot}/packages/shell/renderer/build.ts`,
      ],
      "shell renderer build 실패",
    );

    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-terminal-" });
    const site = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-site-" }),
    );
    const api = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-api-" }),
    );
    const port = freePort();
    const shell = await launchShell({
      executable: electronExecutable,
      app: shellApp,
      home,
      port,
      env: {
        LOPHN_DEV_SEED: "1",
        LOPHN_DEV_SEED_FOLDERS: JSON.stringify([site, api]),
      },
    });
    try {
      const page = await shell.connect("lophn-shell://desktop/index.html");
      await shell.mainEvaluate(
        `electron.BrowserWindow.getAllWindows()[0].setSize(1600, 960)`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector('[data-space]')?.getAttribute('data-space')`,
        "project",
      );
      // shell/workspace#R7: 복원한 터미널 탭은 시작하지 않은 자리표시다.
      await waitFor(
        shell.evaluate,
        `document.querySelector('[data-terminal-tab="term_1"]')?.getAttribute('data-phase')`,
        "idle",
      );
      await clickAt(shell, page, '[data-terminal-tab="term_1"] [data-restart]');

      // shell/terminal#R1, R6: 둘 중 고르기 전에는 시작하지 않는다.
      await waitFor(
        shell.evaluate,
        `document.querySelector('[data-terminal-tab="term_1"]')?.getAttribute('data-phase')`,
        "choose",
      );
      const notice = await shell.evaluate(`JSON.stringify({
        account: document.querySelector('[data-notice="account"]')?.textContent ?? "",
        folder: document.querySelector('[data-notice="folder"]')?.textContent ?? "",
      })`) as string;
      const lines = JSON.parse(notice) as { account: string; folder: string };
      assert(lines.account.includes("isn't an app sandbox"), lines.account);
      assert(lines.folder.includes("starts in the project folder"));
      assert(!lines.folder.includes("sandbox"));
      await clickAt(
        shell,
        page,
        '[data-terminal-tab="term_1"] [data-folder-choice] li:nth-child(2) button',
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector('[data-terminal-tab="term_1"]')?.getAttribute('data-phase')`,
        "live",
      );

      // 고른 폴더가 실제 시작 위치다. OSC 8 링크 출력은 링크가 되지 않는다.
      await clickAt(shell, page, '[data-terminal-tab="term_1"] .xterm');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await typeLine(page, "pwd");
      await typeLine(
        page,
        "printf '\\033]8;;https://example.com\\033\\\\linked\\033]8;;\\033\\\\\\n'",
      );
      await waitFor(
        shell.evaluate,
        `${screenText}.includes(${JSON.stringify(api)})`,
        true,
      );
      await waitFor(shell.evaluate, `${screenText}.includes("linked")`, true);
      const anchors = await shell.evaluate(
        `document.querySelectorAll('[data-terminal-tab="term_1"] a').length`,
      );
      assertEquals(anchors, 0, "OSC 8 출력이 링크가 됐다");

      // shell/terminal#R8: renderer를 다시 읽어도 같은 runtime의 출력이 다시 보인다.
      await shell.evaluate(`location.reload()`);
      await waitFor(
        shell.evaluate,
        `document.querySelector('[data-terminal-tab="term_1"]')?.getAttribute('data-phase')`,
        "live",
      );
      await waitFor(
        shell.evaluate,
        `${screenText}.includes(${JSON.stringify(api)})`,
        true,
      );

      // shell/terminal#R9: 확인된 exit code를 출력 옆에 두고 다시 시작은 누를 때만이다.
      await clickAt(shell, page, '[data-terminal-tab="term_1"] .xterm');
      await new Promise((resolve) => setTimeout(resolve, 500));
      await typeLine(page, "exit 3");
      await waitFor(
        shell.evaluate,
        `document.querySelector('[data-terminal-tab="term_1"] [data-exit-banner]')?.textContent ?? ""`,
        "The shell ended with exit code 3.",
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assertEquals(
        await shell.evaluate(
          `document.querySelector('[data-terminal-tab="term_1"]')?.getAttribute('data-phase')`,
        ),
        "ended",
      );
      await clickAt(shell, page, '[data-terminal-tab="term_1"] [data-restart]');
      await waitFor(
        shell.evaluate,
        `document.querySelector('[data-terminal-tab="term_1"]')?.getAttribute('data-phase')`,
        "live",
      );
      // 새 shell은 빈 화면에서 시작한다. 옛 출력·입력을 다시 쓰지 않는다.
      await waitFor(
        shell.evaluate,
        `${screenText}.includes("exit 3")`,
        false,
      );

      // shell/terminal#R10: 살아 있는 터미널 닫기는 overlay dialog로 묻는다.
      const overlay = await shell.connect("lophn-shell://overlay/index.html");
      await clickAt(shell, page, '[data-tab="term_1"] [data-close]');
      await waitFor(
        overlay.evaluate,
        `document.querySelector('[data-kind="dialog"]')?.textContent?.includes("Close this terminal?") ?? false`,
        true,
      );
      await overlay.evaluate(
        `[...document.querySelectorAll('[data-kind="dialog"] button')]
        .find((button) => button.textContent === "Keep open")?.click()`,
      );
      await waitFor(
        overlay.evaluate,
        `document.querySelector('[data-kind="dialog"]') === null`,
        true,
      );
      assertEquals(
        await shell.evaluate(
          `document.querySelector('[data-terminal-tab="term_1"]')?.getAttribute('data-phase')`,
        ),
        "live",
      );
      await clickAt(shell, page, '[data-tab="term_1"] [data-close]');
      await waitFor(
        overlay.evaluate,
        `document.querySelector('[data-kind="dialog"]') !== null`,
        true,
      );
      await overlay.evaluate(
        `[...document.querySelectorAll('[data-kind="dialog"] button')]
        .find((button) => button.textContent === "Close terminal")?.click()`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector('[data-tab="term_1"]') === null ||
          document.querySelector('[data-terminal-tab="term_1"] [data-exit-banner]') !== null`,
        true,
      );
      const left = await shell.evaluate(
        `document.querySelector('[data-terminal-tab="term_1"] [data-exit-banner]')?.textContent ?? null`,
      );
      assertEquals(left, null, `닫기 뒤 탭이 남았다: ${left}`);
      assertEquals(
        await shell.evaluate(`document.querySelector('[data-tab="term_1"]')`),
        null,
      );
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(site, { recursive: true });
      await Deno.remove(api, { recursive: true });
    }
  },
});
