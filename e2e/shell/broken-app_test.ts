// shell#T48: 깨진 앱 격리 확인. 화면 없이(show:false·offscreen) Electron을 띄워 실제 앱 view
// adapter·registry로 앱 view 셋을 연다(packages/shell/main/app-frame/testdata/broken-app-probe.ts):
// 깨질 view, 같은 앱의 숨긴 다른 탭, 옆 칸의 다른 앱. core 앱 통로만 가짜이고 앱 화면은 이
// 테스트가 Unix socket에 띄운 가짜 앱이 내준다. 화면 첫 렌더 오류는 apps#T26 깨진 fixture 앱
// (fixtures/apps/broken)의 view root 오류와 같은 모양이고, 그 앱 전체 흐름은
// e2e/flows/report-app-problem_test.ts가 본다.
// - shell/app-frame#R21: 무한 loop·큰 렌더링·crash·첫 렌더 오류 동안 shell 크롬 누르기, 다른
//   탭으로 바꾸기, 다른 앱 누르기의 첫 반응이 platform/responsiveness shell_first_response
//   (p95 100ms) 안이다. 같은 앱의 다른 탭이 같은 renderer process를 쓰는지 적기만 하고 자원
//   격리를 WebContents 분리로 약속하지 않는다.
// - shell/app-frame#R21(architecture/shell 실패 표): 멈춤·crash를 연결 상태와 함께 알리고
//   스스로 다시 load하거나 연결을 다시 얻지 않는다. 새 view 열기는 지금 연결로 새 contents를 연다.
// - shell/app-frame#R32: 문제 알리기 dialog 자체는 e2e/shell/report-problem_test.ts가 본다. 여기서는
//   그 버튼이 놓인 shell 크롬이 깨진 view 옆에서 반응하는지 잰다.
import { assert, assertEquals } from "@std/assert";

import {
  judge,
  type RequestSample,
  summarize,
} from "../../packages/core/supervision/responsiveness/mod.ts";
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
const probeSource = `${shellMain}/app-frame/testdata/broken-app-probe.ts`;

const BROKEN = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const OTHER = "app_01j9yyyyyyyyyyyyyyyyyyyyyy";
const RELEASE = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const SAMPLES = 20;

async function run(command: string, args: string[], cwd: string) {
  const output = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `${command} 실패: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
}

const SCRIPT = { "content-type": "text/javascript; charset=utf-8" };
// 첫 요청에만 깨진다. 새 view는 같은 화면을 다시 받아 정상으로 그린다.
const NO_STORE = { ...SCRIPT, "cache-control": "no-store" };
const SCRIPTS: Record<string, string> = {
  loop: "setTimeout(() => { for (;;) {} }, 300);",
  large:
    "let n = 0; const step = () => { const f = document.createDocumentFragment(); " +
    "for (let i = 0; i < 20000; i += 1) { const d = document.createElement('div'); " +
    "d.textContent = 'row ' + n; d.style.width = (n % 400) + 'px'; f.appendChild(d); n += 1; } " +
    "document.body.appendChild(f); if (n < 600000) setTimeout(step, 0); }; step();",
  "render-error":
    "throw new TypeError('view render failed in the broken fixture');",
};

/** 가짜 앱 둘. 자기 key의 인증만 받는다. 화면 요청 수를 센다. */
function fakeApps(path: string) {
  const requests = new Map<string, number>();
  const served = new Set<string>();
  const page = (color: string, script = "") =>
    new Response(
      `<!doctype html><html><body style="margin:0;background:${color};` +
        `font:32px sans-serif;color:#fff"><h1 style="margin:40px">Orders</h1>` +
        `${script}</body></html>`,
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  const server = Deno.serve({ path, onListen() {} }, (request) => {
    const url = new URL(request.url);
    const auth = request.headers.get("authorization");
    if (auth !== `probe ${BROKEN}` && auth !== `probe ${OTHER}`) {
      return new Response("{}", { status: 401 });
    }
    const match = /^\/screens\/([a-z-]+)\/(index\.html|load\.js)$/.exec(
      url.pathname,
    );
    if (match === null) return new Response("{}", { status: 404 });
    const [, screen, file] = match;
    if (file === "index.html") {
      requests.set(screen, (requests.get(screen) ?? 0) + 1);
      if (screen === "main") return page("#2f6f4f");
      if (!(screen in SCRIPTS)) return new Response("{}", { status: 404 });
      // 앱 화면 CSP는 inline script를 막는다. 같은 화면의 script 파일로 깨진다.
      return page("#6f4f2f", '<script src="load.js"></script>');
    }
    const first = !served.has(screen);
    served.add(screen);
    return new Response(first ? SCRIPTS[screen] ?? "" : "", {
      headers: NO_STORE,
    });
  });
  return { server, requests };
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

type Scenario = {
  load: "loop" | "large" | "crash" | "render-error";
  shellChrome: number[];
  otherTab: number[];
  otherApp: number[];
  pushed: string[];
  before: {
    health: string;
    connection: string;
    connects: number;
    sameContents: boolean;
  };
  after: {
    ok: boolean;
    health?: string;
    connects?: number;
    newContents?: boolean;
    oldDestroyed?: boolean;
    answers?: number;
  };
  tabSharesProcess: boolean;
  otherAppSharesProcess: boolean;
  healthyAfter: string;
};

const samples = (values: number[]): RequestSample[] =>
  values.map((ms) => ({ outcome: "ended", ms }));

Deno.test({
  name:
    "shell/app-frame#R21, R32: 무한 loop·큰 렌더링·crash에도 shell 크롬·다른 탭·다른 앱이 p95 100ms 안에 반응하고 깨진 view는 상태를 보이며 누를 때만 지금 연결로 새로 열린다",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-broken-" });
    await Deno.chmod(home, 0o700);
    const out = `${home}/dist`;
    const userData = `${home}/user-data`;
    await Deno.mkdir(userData, { mode: 0o700 });
    const socket = `${home}/app.sock`;
    const apps = fakeApps(socket);
    let child: Deno.ChildProcess | undefined;
    try {
      await run("node", [
        "--input-type=module",
        "-e",
        "const { build } = await import(process.argv[2]); " +
        "await build(process.argv[3], [{ in: process.argv[4], out: 'probe' }]);",
        "broken-app-probe",
        `${shellMain}/build.ts`,
        out,
        probeSource,
      ], shellMain);
      const config = {
        userData,
        result: `${home}/result.json`,
        preload: `${out}/preload-app.cjs`,
        apps: { broken: BROKEN, other: OTHER },
        release: RELEASE,
        socket,
        samples: SAMPLES,
      };
      child = new Deno.Command(electronExecutable, {
        args: [`${out}/probe.cjs`],
        env: {
          LOPHN_BROKEN_APP: JSON.stringify(config),
          LOPHN_HOME: home,
          LOPHN_SHELL_HEADLESS: "1",
        },
        stdout: "null",
        stderr: "null",
      }).spawn();
      const status = await waitExit(child, 240_000);
      assert(status !== undefined, "probe가 시간 안에 끝나지 않았다");
      const report = JSON.parse(await Deno.readTextFile(config.result));
      assert(report.ok, report.error);
      const { results, otherAppHealth } = report.result as {
        results: Scenario[];
        otherAppHealth: string;
      };
      assertEquals(
        results.map((item) => item.load),
        ["render-error", "large", "crash", "loop"],
      );

      for (const item of results) {
        // 부하 동안 조작마다 첫 반응 p95가 100ms 안이다.
        for (
          const [name, values] of [
            ["shell chrome", item.shellChrome],
            ["other tab", item.otherTab],
            ["other app", item.otherApp],
          ] as const
        ) {
          assertEquals(values.length, SAMPLES, `${item.load} ${name}`);
          const summary = summarize(samples(values));
          const verdict = judge("shell_first_response", summary)!;
          assert(
            verdict.p95Met,
            `${item.load} ${name}: p95 ${summary.p95Ms.toFixed(1)}ms`,
          );
        }
        // 다른 앱은 다른 process이고 계속 건강하다.
        assertEquals(item.otherAppSharesProcess, false, item.load);
        assertEquals(item.healthyAfter, "ok", item.load);
        // 깨져도 연결은 그대로 보이고 스스로 연결을 다시 얻지 않는다.
        assertEquals(item.before.connection, "running", item.load);
        assertEquals(item.before.connects, 0, item.load);
        // 같은 앱 다른 탭의 process 공유는 적기만 한다(격리를 약속하지 않는다).
        assertEquals(typeof item.tabSharesProcess, "boolean");
      }

      const by = (load: Scenario["load"]) =>
        results.find((item) => item.load === load)!;
      // 화면 오류·큰 렌더링은 process가 살아 있어 깨진 view가 아니다. 새 view 열기도 없다.
      for (const load of ["render-error", "large"] as const) {
        assertEquals(by(load).before.health, "ok", load);
        assertEquals(by(load).after.ok, false, load);
      }
      // crash·멈춤은 상태를 크롬에 알리고, 그 contents를 스스로 다시 load하지 않는다.
      assertEquals(by("crash").pushed, ["crashed"]);
      assertEquals(by("crash").before.health, "crashed");
      assertEquals(by("loop").pushed[0], "unresponsive");
      assertEquals(by("loop").before.health, "unresponsive");
      // 화면 요청 수: 깨진 화면은 처음 한 번, 새 view 열기로 한 번 더뿐이다.
      assertEquals(apps.requests.get("loop"), 2);
      for (const load of ["crash", "loop"] as const) {
        const after = by(load).after;
        assertEquals(after.ok, true, load);
        assertEquals(after.health, "ok", load);
        assertEquals(after.connects, 0, load);
        assertEquals(after.newContents, true, load);
        assertEquals(after.oldDestroyed, true, load);
        assert((after.answers ?? Infinity) < 2_000, load);
      }
      assertEquals(otherAppHealth, "ok");
      console.log(
        results.map((item) =>
          `${item.load}: shell p95 ${
            summarize(samples(item.shellChrome)).p95Ms.toFixed(1)
          }ms, tab p95 ${
            summarize(samples(item.otherTab)).p95Ms.toFixed(1)
          }ms, other app p95 ${
            summarize(samples(item.otherApp)).p95Ms.toFixed(1)
          }ms, tab shares process ${item.tabSharesProcess}`
        ).join("\n"),
      );
    } finally {
      if (child !== undefined) {
        const tree = await descendantPids(child.pid);
        signalPids(tree.filter(processAlive), "SIGKILL");
        await child.status.catch(() => {});
      }
      await apps.server.shutdown();
      await Deno.remove(home, { recursive: true });
    }
  },
});
