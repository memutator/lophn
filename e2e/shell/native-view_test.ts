// shell#T39: native view 배치. 실제 Electron(Chromium)을 화면 없이(show:false·offscreen) 띄워
// shell main과 같은 app-frame 조립(scheme 등록, electron adapter, registry, visibility)으로 앱
// view를 실제 창 contentView에 붙인다. core 앱 통로만 probe의 가짜 connector이고 앱 화면은 이
// 테스트가 Unix socket에 띄운 가짜 앱 프로세스가 내준다. 붙이기·떼기마다 창의 실제 child
// view와 bounds를 적는다.
// - shell/app-frame#R27, R28: 프로젝트 두 칸에 두 앱 view를 동시에 붙이고 겹치지 않는다.
// - shell/app-frame#R29, R35: 칸 경계 drag 중 view가 떨어지지 않고 bounds 적용은 16ms마다
//   한 번이다. overlay는 늘 맨 위다. 탭 전환은 옛 view를 먼저 떼고 새 view는 준비 뒤 붙인다.
// - shell/app-frame#R26, R36: 1,024px 미만 창에서 덮인 만큼 줄이고 숨기지 않으며 닫으면
//   원래 bounds다. 창 본문 밖으로 나가지 않는다.
import { assert, assertEquals } from "@std/assert";

import {
  descendantPids,
  e2eEnabled,
  processAlive,
  signalPids,
} from "../harness.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const shellMain = `${repoRoot}/packages/shell/main`;
const electronExecutable = `${shellMain}/node_modules/electron/dist/electron`;
const probeSource = `${shellMain}/app-frame/testdata/native-view-probe.ts`;

const APPS = [
  "app_01j9zzzzzzzzzzzzzzzzzzzzzz",
  "app_01j9yyyyyyyyyyyyyyyyyyyyyy",
  "app_01j9xxxxxxxxxxxxxxxxxxxxxx",
];
const RELEASE = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
// probe와 같은 창 본문(상단 바 48px 아래).
const TOP = 48;

async function buildProbe(out: string): Promise<void> {
  const output = await new Deno.Command("node", {
    args: [
      "--input-type=module",
      "-e",
      "const { build } = await import(process.argv[2]); " +
      "await build(process.argv[3], [{ in: process.argv[4], out: 'probe' }]);",
      "native-view-probe",
      `${shellMain}/build.ts`,
      out,
      probeSource,
    ],
    cwd: shellMain,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `probe build 실패: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
}

/** 가짜 앱 프로세스 하나. 자기 key의 인증만 받고 자기 페이지 머리부터 그리는 화면을 내준다. */
function fakeApp(path: string, key: string, color: string) {
  return Deno.serve({ path, onListen() {} }, (request) => {
    const url = new URL(request.url);
    if (request.headers.get("authorization") !== `probe ${key}`) {
      return new Response("{}", { status: 401 });
    }
    if (url.pathname === "/screens/main/index.html") {
      return new Response(
        `<!doctype html><html><body style="margin:0;background:${color}">` +
          "<h1>app</h1></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    return new Response("{}", { status: 404 });
  });
}

async function waitExit(
  child: Deno.ChildProcess,
  ms: number,
): Promise<Deno.CommandStatus | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([child.status, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type Bounds = { x: number; y: number; width: number; height: number };

Deno.test({
  name:
    "shell/app-frame#R26, R27, R28, R29, R35, R36: 두 view 동시 표시, drag 중 view가 보임, 전환 중 겹친 frame 없음, 1,024px 미만 bounds 축소",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-native-view-" });
    await Deno.chmod(home, 0o700);
    const out = `${home}/dist`;
    const userData = `${home}/user-data`;
    await Deno.mkdir(userData, { mode: 0o700 });
    const sockets: Record<string, string> = {};
    const servers = APPS.map((appId, index) => {
      sockets[appId] = `${home}/app-${index}.sock`;
      return fakeApp(sockets[appId]!, appId, ["#d33", "#3a3", "#33d"][index]!);
    });
    let child: Deno.ChildProcess | undefined;
    try {
      await buildProbe(out);
      const config = {
        userData,
        result: `${home}/result.json`,
        preload: `${out}/preload-app.cjs`,
        release: RELEASE,
        sockets,
      };
      child = new Deno.Command(electronExecutable, {
        args: [`${out}/probe.cjs`],
        env: {
          LOPHN_NATIVE_VIEW: JSON.stringify(config),
          LOPHN_HOME: home,
          LOPHN_SHELL_HEADLESS: "1",
        },
        stdout: "null",
        stderr: "null",
      }).spawn();
      const status = await waitExit(child, 90_000);
      assert(status !== undefined, "probe가 시간 안에 끝나지 않았다");
      const report = JSON.parse(await Deno.readTextFile(config.result));
      assert(report.ok, report.error);
      const result = report.result as {
        twoViews: {
          contentSize: number[];
          beforeBounds: number;
          shown: number;
          a: Bounds;
          b: Bounds;
          loaded: boolean[];
        };
        drag: {
          updates: number;
          ms: number;
          nativeMoves: number;
          detached: boolean;
          alwaysBoth: boolean;
          a: Bounds;
          b: Bounds;
        };
        tabSwitch: { steps: string[]; c: Bounds };
        narrow: {
          full: Bounds;
          covered: Bounds;
          coveredShown: boolean;
          restored: Bounds;
          clamped: Bounds;
        };
        overlaps: string[];
        overlayAlwaysOnTop: boolean;
        attachedBeforeReady: number;
      };

      // 두 칸에 두 view를 동시에 붙인다. bounds가 오기 전에는 붙이지 않는다.
      assertEquals(result.twoViews.contentSize, [1000, 760]);
      assertEquals(result.twoViews.beforeBounds, 0);
      assertEquals(result.twoViews.shown, 2);
      const pane = { y: TOP, height: 712 };
      assertEquals(result.twoViews.a, { x: 0, width: 500, ...pane });
      assertEquals(result.twoViews.b, { x: 500, width: 500, ...pane });
      assertEquals(result.twoViews.loaded, [true, true]);

      // drag 중 view는 떨어지지 않고 bounds 적용은 16ms frame마다 한 번이다.
      assertEquals(result.drag.detached, false);
      assertEquals(result.drag.alwaysBoth, true);
      const frames = Math.ceil(result.drag.ms / 16) + 2;
      assert(
        result.drag.nativeMoves <= frames * 2,
        `${
          result.drag.updates * 2
        }번의 요청을 ${result.drag.nativeMoves}번 적용했다 (${result.drag.ms}ms)`,
      );
      assert(result.drag.nativeMoves < result.drag.updates * 2);
      assertEquals(result.drag.a, { x: 0, width: 300, ...pane });
      assertEquals(result.drag.b, { x: 300, width: 700, ...pane });

      // 탭 전환: 옛 view를 먼저 떼고, 새 view는 첫 load 뒤 붙인다.
      assertEquals(result.tabSwitch.steps.length, 2);
      assert(result.tabSwitch.steps[0]!.startsWith("detach "));
      assert(result.tabSwitch.steps[1]!.startsWith("attach "));
      assertEquals(result.tabSwitch.c, { x: 0, width: 300, ...pane });
      assertEquals(result.attachedBeforeReady, 0);

      // 어느 순간에도 두 view가 겹친 frame이 없고 overlay는 맨 위다.
      assertEquals(result.overlaps, []);
      assertEquals(result.overlayAlwaysOnTop, true);

      // 좁은 창: 덮인 만큼 줄이고 숨기지 않으며, 닫으면 원래 bounds다.
      const full = { x: 0, y: TOP, width: 900, height: 652 };
      assertEquals(result.narrow.full, full);
      assertEquals(result.narrow.covered, { ...full, width: 540 });
      assertEquals(result.narrow.coveredShown, true);
      assertEquals(result.narrow.restored, full);
      assertEquals(result.narrow.clamped, full);
    } finally {
      if (child !== undefined) {
        const tree = await descendantPids(child.pid);
        signalPids(tree.filter(processAlive), "SIGKILL");
        await child.status.catch(() => {});
      }
      for (const server of servers) await server.shutdown();
      await Deno.remove(home, { recursive: true });
    }
  },
});
