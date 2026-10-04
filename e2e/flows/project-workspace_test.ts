// shell#T14: project-workspace 틀이 실제 창에서 치수를 지킨다.
// 개발 시드(LOPHN_DEV_SEED)로 프로젝트 공간을 열고 sidebar·상단 바·탭 줄·두 칸을
// 측정한다. 시드는 core를 부르지 않으므로 제품 데이터와 무관하다.
// 화면이 없으면(DISPLAY 없음) 건너뛴다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { launchShell, type RunningShell } from "../run.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const electronExecutable =
  `${repoRoot}/apps/shell/main/node_modules/electron/dist/electron`;
const shellApp = `${repoRoot}/apps/shell/main/dist/main.cjs`;

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
  shell: RunningShell,
  expression: string,
  expected: unknown,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    last = await shell.evaluate(expression);
    if (last === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`기대한 화면 상태가 오지 않았다: ${JSON.stringify(last)}`);
}

Deno.test({
  name:
    "shell/workspace#R1: 프로젝트 작업대는 sidebar·상단 바·탭 줄·두 칸을 정한 치수로 그린다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await runBuild(
      ["npm", "--prefix", `${repoRoot}/apps/shell/main`, "run", "build"],
      "shell main build 실패",
    );
    await runBuild(
      [
        "deno",
        "run",
        "--allow-all",
        `${repoRoot}/apps/shell/renderer/build.ts`,
      ],
      "shell renderer build 실패",
    );

    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-" });
    const shell = await launchShell({
      executable: electronExecutable,
      app: shellApp,
      home,
      port: freePort(),
      env: { LOPHN_DEV_SEED: "1" },
    });
    try {
      await waitFor(
        shell,
        "document.querySelector('[data-space]')?.getAttribute('data-space')",
        "project",
      );
      const measured = await shell.evaluate(`(() => {
        const q = (sel) => document.querySelector(sel);
        const cs = (el) => el ? getComputedStyle(el) : null;
        const sidebar = q('[data-sidebar]');
        const body = q('[data-pane-body]');
        return JSON.stringify({
          sidebar: sidebar && { mode: sidebar.getAttribute('data-sidebar'), width: cs(sidebar).width },
          bar: cs(q('header'))?.height,
          strip: cs(q('[data-tab-strip]'))?.height,
          row: cs(q('[data-document]'))?.height,
          padLeft: cs(body)?.paddingLeft,
          padTop: cs(body)?.paddingTop,
          panes: q('[data-panes]')?.getAttribute('data-panes'),
          launcherInHeader: !!document.querySelector('header [data-launcher-back]'),
          pageScrollX: document.documentElement.scrollWidth > innerWidth + 1,
          width: innerWidth,
        });
      })()`) as string;
      const frame = JSON.parse(measured) as {
        sidebar: { mode: string; width: string };
        bar: string;
        strip: string;
        row: string;
        padLeft: string;
        padTop: string;
        panes: string;
        launcherInHeader: boolean;
        pageScrollX: boolean;
        width: number;
      };
      // 기본 창 960px. sidebar는 접히고 런처 복귀는 상단 바에 있다(desktop#R26).
      assert(frame.width < 1024, `창이 1024px 이상이다: ${frame.width}`);
      assertEquals(frame.sidebar.mode, "collapsed");
      assertEquals(frame.sidebar.width, "56px");
      assertEquals(frame.launcherInHeader, true);
      assertEquals(frame.bar, "48px");
      assertEquals(frame.strip, "36px");
      assertEquals(frame.row, "32px");
      // 1024px 미만 본문 여백은 16px, 위는 24px(desktop#R22).
      assertEquals(frame.padLeft, "16px");
      assertEquals(frame.padTop, "24px");
      // 두 칸 최소 폭이 부족하면 한 칸 보기다(workspace#R4).
      assertEquals(frame.panes, "1");
      assertEquals(frame.pageScrollX, false);
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});
