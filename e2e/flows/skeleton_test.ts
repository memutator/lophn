// contracts#T10 skeleton smoke: shell 창이 뜨고 core 준비 상태가 화면에 보이고,
// 창을 닫고 종료하면 core가 정상 종료한다.
// 화면이 없으면(DISPLAY 없음) 건너뛴다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { launchShell, type RunningShell } from "../run.ts";

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

/** 원격 디버깅 빈 포트. */
function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

/** 표현식 결과가 기대값이 될 때까지 기다린다. */
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
    "skeleton: shell 창이 뜨고 core 준비 상태가 보이며 종료하면 core가 정상 종료한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // shell main과 renderer를 build한다. 결과가 없으면 창이 빈 문서를 연다.
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

    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-" });
    const port = freePort();
    const shell = await launchShell({
      executable: electronExecutable,
      app: shellApp,
      home,
      port,
    });
    try {
      // 창이 떴다: launcher 공간이 renderer DOM에 있다. 페이지 로드를 기다린다.
      await waitFor(
        shell,
        `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
        "launcher",
      );
      const space = await shell.evaluate(
        `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
      );
      assertEquals(space, "launcher");

      // core 준비 상태가 화면에 보인다. 준비 전에는 data-connection 표시가 있고,
      // 준비가 되면 그 표시가 사라진다.
      await waitFor(
        shell,
        `document.querySelector("[data-connection]")?.getAttribute("data-connection") ?? "ready"`,
        "ready",
      );
      const notice = await shell.evaluate(
        `document.querySelector("[data-connection]") === null`,
      );
      assertEquals(notice, true);
    } finally {
      const pid = shell.pid;
      await shell.close();
      // 창을 닫고 종료하면 core까지 정상 종료한다. 메인 pid가 사라졌는지 확인한다.
      let alive = true;
      try {
        Deno.kill(pid, "NONE" as Deno.Signal);
      } catch {
        alive = false;
      }
      assert(!alive, "shell이 종료 뒤에도 남아 있다");
      await Deno.remove(home, { recursive: true });
    }
  },
});
