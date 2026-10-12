// problems#T11: 실제 앱 화면 검사 host(shell#T46)로 화면 있는 fixture 앱의 app test 화면 검사를
// 돌린다. 화면은 고정 fixture(`fixtures/app-screens`)이고 앱 command는 runner가 연 test 앱 socket이
// 연결 증명 없이 받는다. host는 offscreen이고 사람 데이터 root는 열지 않는다(HOME·LOPHN_HOME은
// 임시 폴더). Electron은 이 테스트가 띄운 process 그룹만 정리한다.
import { assert, assertEquals } from "@std/assert";
import {
  runScreenHost,
  screenErrorBoundaries,
} from "../../packages/core/problems/tests/adapters/screen-host.ts";
import { serveTestAppSocket } from "../../packages/core/problems/tests/adapters/test-app-socket.ts";
import {
  fakeCollector,
  judgeWithScreens,
} from "../../packages/core/problems/tests/testing/view-checks.ts";
import type { ScreenHostResult } from "../../packages/core/problems/tests/app-test/mod.ts";
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
    "problems/tests#R7, problem-codes#R8, reporting#R5: 실제 host로 돌린 화면 있는 fixture 앱은 깨진 화면 없이 probe로 pass이고 접수·오류 경계를 뺀 fixture는 fail이다",
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
      const entries = {
        clean: { key: "clean", path: "clean/index.html" },
        plain: { key: "plain", path: "plain/index.html" },
        main: { key: "main", path: "main/index.html" },
        hang: { key: "hang", path: "hang/index.html" },
      };
      // 같은 화면 묶음은 host를 한 번만 돌린다.
      const runs = new Map<string, Promise<ScreenHostResult>>();
      const hostFor =
        (...keys: (keyof typeof entries)[]) => (nonce: string) => {
          const name = keys.join(",");
          let run = runs.get(name);
          if (run === undefined) {
            run = runScreenHost({
              command: electron,
              args: [`${root}/dist/main.cjs`],
              work_dir: root,
              input: {
                bundle_screens_dir: bundleScreens,
                screens: keys.map((key) => entries[key]),
                app_socket_path: socket.path,
                deadline_ms: 20_000,
                probe_nonce: nonce,
              },
            });
            runs.set(name, run);
          }
          return run;
        };
      const boundaries = await screenErrorBoundaries({
        bundle_screens_dir: bundleScreens,
        screens: Object.values(entries),
      });
      assertEquals([...boundaries].sort(), ["clean", "main"]);
      const has_boundary = (screen: string) => boundaries.has(screen);

      // 깨진 화면을 따로 두지 않은 앱은 runner의 probe 셋과 일부러 멈춘 화면으로 pass한다.
      const collector = fakeCollector();
      const passed = await judgeWithScreens({
        host: hostFor("clean"),
        has_boundary,
        collector,
      });
      assertEquals(passed.judgment.result, "pass");
      const kinds = collector.received.map((item) => item.kind);
      assertEquals(kinds.filter((kind) => kind === "exception").length, 3);
      assertEquals(kinds.filter((kind) => kind === "feedback").length, 1);
      for (const item of collector.received) {
        assertEquals(item.target.mode, "test");
      }

      // 접수 경로를 뺀 fixture는 fail이다.
      const lost = await judgeWithScreens({
        host: hostFor("clean"),
        has_boundary,
        collector: fakeCollector({ reject: ["exception"] }),
      });
      assertEquals(lost.judgment.result, "fail");
      assertEquals(
        lost.judgment.observations.checks.find((check) =>
          check.name === "view_exception"
        )?.status,
        "fail",
      );

      // 루트 오류 경계가 없는 화면은 render_error를 믿을 수 없어 fail이다.
      const bare = await judgeWithScreens({
        host: hostFor("clean", "plain"),
        has_boundary,
        collector: fakeCollector(),
      });
      assertEquals(bare.judgment.result, "fail");

      // 화면 자신의 실제 오류와 멈춘 화면도 그대로 접수되어 센다.
      const own = fakeCollector();
      const ownResult = await judgeWithScreens({
        host: hostFor("clean", "main", "hang"),
        has_boundary,
        collector: own,
      });
      assertEquals(ownResult.judgment.result, "pass");
      assertEquals(
        own.received.filter((item) => item.kind === "exception").length,
        9,
      );
      // 화면의 `lophnApp.call`이 test 앱 socket에 연결 증명 없이 닿았다.
      assert(calls.length >= 1);

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
