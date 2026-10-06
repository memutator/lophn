// problems#T11: 실제 앱 화면 검사 host(shell#T46)로 화면 있는 fixture 앱의 app test 화면 검사를
// 돌린다. 화면은 고정 fixture(`fixtures/app-screens`)이고 앱 command는 runner가 연 test 앱 socket이
// 연결 증명 없이 받는다. host는 offscreen이고 사람 데이터 root는 열지 않는다(HOME·LOPHN_HOME은
// 임시 폴더). Electron은 이 테스트가 띄운 process 그룹만 정리한다.
import { assert, assertEquals } from "@std/assert";
import { runScreenHost } from "../../packages/problems/tests/adapters/screen-host.ts";
import { serveTestAppSocket } from "../../packages/problems/tests/adapters/test-app-socket.ts";
import {
  fakeCollector,
  judgeWithScreens,
} from "../../packages/problems/tests/testing/view-checks.ts";
import { e2eEnabled } from "../harness.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const shellMain = `${repoRoot}/apps/shell/main`;
const electron = `${shellMain}/node_modules/electron/dist/electron`;
const bundleScreens = `${repoRoot}/fixtures/app-screens`;

async function buildShell(out: string): Promise<void> {
  const output = await new Deno.Command("node", {
    args: [
      "--input-type=module",
      "-e",
      "const { build } = await import(process.argv[2]); await build(process.argv[3]);",
      "app-screen-check",
      `${shellMain}/build.ts`,
      out,
    ],
    cwd: shellMain,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(`build 실패: ${new TextDecoder().decode(output.stderr)}`);
  }
}

Deno.test({
  name:
    "problems/tests#R7, problem-codes#R8, reporting#R5: 실제 host로 돌린 화면 있는 fixture 앱의 app test는 pass이고 view 예외 수집을 뺀 fixture는 fail이다",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "lophn-e2e-screen-check-" });
    await Deno.chmod(root, 0o700);
    const calls: unknown[] = [];
    const socket = serveTestAppSocket({
      path: `${root}/app.sock`,
      invoke(command, input) {
        calls.push({ command, input });
        return Promise.resolve({ ok: true as const, value: { pong: true } });
      },
    });
    try {
      await buildShell(`${root}/dist`);
      const host = () =>
        runScreenHost({
          command: electron,
          args: [`${root}/dist/main.cjs`],
          work_dir: root,
          input: {
            bundle_screens_dir: bundleScreens,
            screens: [
              { key: "hang", path: "hang/index.html" },
              { key: "main", path: "main/index.html" },
            ],
            app_socket_path: socket.path,
            deadline_ms: 15_000,
          },
        });

      const collector = fakeCollector();
      const passed = await judgeWithScreens({ host, collector });
      assertEquals(passed.judgment.result, "pass");
      const kinds = collector.received.map((item) => item.kind);
      assertEquals(kinds.filter((kind) => kind === "exception").length, 3);
      assertEquals(kinds.filter((kind) => kind === "feedback").length, 2);
      for (const item of collector.received) {
        assertEquals(item.target.mode, "test");
      }
      // 화면의 `lophnApp.call`이 test 앱 socket에 연결 증명 없이 닿았다.
      assert(calls.length >= 1);

      const collectorWithoutViewErrors = fakeCollector({
        reject: ["exception"],
      });
      const failed = await judgeWithScreens({
        host,
        collector: collectorWithoutViewErrors,
      });
      assertEquals(failed.judgment.result, "fail");
      assertEquals(
        failed.judgment.observations.checks.find((check) =>
          check.name === "view_exception"
        )?.status,
        "fail",
      );

      // 사람 데이터 root를 만들지 않는다. HOME은 임시 폴더이고 lophn 폴더는 없다.
      const names: string[] = [];
      for await (const entry of Deno.readDir(`${root}/screen-lophn-home`)) {
        names.push(entry.name);
      }
      assertEquals(names, []);
      for (const path of [".lophn", ".config/lophn"]) {
        await Deno.lstat(`${root}/screen-home/${path}`).then(
          () => assert(false, `${path}가 생겼다`),
          () => {},
        );
      }
    } finally {
      await socket.shutdown();
      await Deno.remove(root, { recursive: true });
    }
  },
});
