// shell#T52: [Report a problem] 실제 Electron 확인. 화면 없이(show:false·offscreen) Electron을 띄워
// 실제 앱 view adapter·registry와 실제 overlay view(설치한 renderer·shell preload)에 feedback main
// 쪽을 붙인다(apps/shell/main/app-frame/testdata/report-problem-probe.ts). core 앱 통로와 problems
// 접수만 가짜이고 앱 화면은 이 테스트가 Unix socket에 띄운 가짜 앱 프로세스가 내준다.
// - shell/app-frame#R31, problems/feedback#R5: 버튼을 누르면 캡처를 먼저 요청하고 overlay에
//   dialog를 연다. 캡처하는 동안과 dialog가 열린 뒤에도 앱 view는 창에 붙어 보인다.
// - shell/app-frame#R32: 무한 loop로 멈춘 view와 crash한 view에서도 dialog가 열리고 글을 쓸 수
//   있다. crash한 view는 이미지 없이 이유만 남긴다. 캡처는 1,500ms 안에 끝난다.
// - problems/feedback#R6: 캡처한 PNG를 미리보기에 그대로 보이고 사람이 고른 때만 함께 보낸다.
// LOPHN_SHELL_SHOT_DIR이 있으면 dialog PNG를 그곳에 남긴다.
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
const shellMain = `${repoRoot}/apps/shell/main`;
const electronExecutable = `${shellMain}/node_modules/electron/dist/electron`;
const probeSource = `${shellMain}/app-frame/testdata/report-problem-probe.ts`;
const rendererBuild = `${repoRoot}/apps/shell/renderer/build.ts`;

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const RELEASE = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";

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

/** 가짜 앱 프로세스. 자기 key의 인증만 받고 화면 둘을 내준다. hang은 그린 뒤 멈춘다. */
function fakeApp(path: string) {
  const page = (color: string, script = "") =>
    new Response(
      `<!doctype html><html><body style="margin:0;background:${color};` +
        `font:32px sans-serif;color:#fff"><h1 style="margin:40px">Orders</h1>` +
        `<p style="margin:40px">Total: 1,204</p>${script}</body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  return Deno.serve({ path, onListen() {} }, (request) => {
    const url = new URL(request.url);
    if (request.headers.get("authorization") !== `probe ${APP}`) {
      return new Response("{}", { status: 401 });
    }
    if (url.pathname === "/screens/main/index.html") return page("#2f6f4f");
    // 앱 화면 CSP는 inline script를 막는다. 같은 화면의 script 파일로 멈춘다.
    if (url.pathname === "/screens/hang/index.html") {
      return page("#6f4f2f", '<script src="hang.js"></script>');
    }
    if (url.pathname === "/screens/hang/hang.js") {
      return new Response("setTimeout(() => { for (;;) {} }, 300);", {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
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

type Scenario = {
  dialogAtOpen: boolean;
  attachedAtOpen: boolean;
  attachedDuringCapture: boolean;
  attachedAfter: boolean;
  captureMs: number;
  block: string | null;
  hasImage: boolean;
  drawn: { text: boolean; image: string | null; reason: string | null };
};

Deno.test({
  name:
    "shell/app-frame#R31, R32, problems/feedback#R5, R6: 멈추거나 crash한 view에서도 dialog가 열리고 캡처하는 동안 앱 view가 보인다",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-report-" });
    await Deno.chmod(home, 0o700);
    const out = `${home}/dist`;
    const userData = `${home}/user-data`;
    await Deno.mkdir(userData, { mode: 0o700 });
    const socket = `${home}/app.sock`;
    const server = fakeApp(socket);
    let child: Deno.ChildProcess | undefined;
    try {
      await run("node", [
        "--input-type=module",
        "-e",
        "const { build } = await import(process.argv[2]); " +
        "await build(process.argv[3], [{ in: process.argv[4], out: 'probe' }]);",
        "report-problem-probe",
        `${shellMain}/build.ts`,
        out,
        probeSource,
      ], shellMain);
      await run("deno", [
        "eval",
        `const { build } = await import(${
          JSON.stringify(`file://${rendererBuild}`)
        }); await build(${JSON.stringify(`${out}/renderer`)});`,
      ], repoRoot);
      const config = {
        userData,
        result: `${home}/result.json`,
        preload: `${out}/preload-app.cjs`,
        shellPreload: `${out}/preload-shell.cjs`,
        rendererDist: `${out}/renderer`,
        shots: Deno.env.get("LOPHN_SHELL_SHOT_DIR") ?? `${home}/shots`,
        app: APP,
        release: RELEASE,
        socket,
      };
      child = new Deno.Command(electronExecutable, {
        args: [`${out}/probe.cjs`],
        env: {
          LOPHN_REPORT_PROBLEM: JSON.stringify(config),
          LOPHN_HOME: home,
          LOPHN_SHELL_HEADLESS: "1",
        },
        stdout: "null",
        stderr: "null",
      }).spawn();
      const status = await waitExit(child, 120_000);
      assert(status !== undefined, "probe가 시간 안에 끝나지 않았다");
      const report = JSON.parse(await Deno.readTextFile(config.result));
      assert(report.ok, report.error);
      const result = report.result as {
        healthy: Scenario;
        hung: Scenario;
        crashed: Scenario;
        submitted: { input: { selection: unknown }; png: boolean }[];
        drafts: number;
      };

      for (const [name, scenario] of Object.entries(result)) {
        if (!["healthy", "hung", "crashed"].includes(name)) continue;
        const item = scenario as Scenario;
        // 버튼을 누른 즉시 dialog가 열리고 앱 view는 떼지 않는다.
        assertEquals(item.dialogAtOpen, true, name);
        assertEquals(item.attachedAtOpen, true, name);
        assertEquals(item.attachedDuringCapture, true, name);
        assertEquals(item.attachedAfter, true, name);
        assert(item.captureMs <= 1_500 + 300, `${name}: ${item.captureMs}ms`);
        assertEquals(item.drawn.text, true, name);
      }
      // 건강한 view: 캡처한 PNG를 미리보기에 그대로 보인다.
      assertEquals(result.healthy.block, null);
      assertEquals(result.healthy.hasImage, true);
      assertEquals(result.healthy.drawn.image, "data:image/png;base64,");
      // crash한 view: 이미지 없이 이유만 남는다.
      assertEquals(result.crashed.block, "capture_failed");
      assertEquals(result.crashed.hasImage, false);
      assertEquals(result.crashed.drawn.reason, "capture_failed");
      // 사람이 screenshot을 고른 뒤 보낸 것 하나만 접수 통로로 갔다.
      assertEquals(result.submitted.length, 1);
      assertEquals(result.submitted[0]!.png, true);
      assertEquals(result.submitted[0]!.input.selection, {
        screen: true,
        screenshot: true,
      });
      // 취소·닫기 뒤 main 메모리에 초안이 남지 않는다.
      assertEquals(result.drafts, 0);
    } finally {
      if (child !== undefined) {
        const tree = await descendantPids(child.pid);
        signalPids(tree.filter(processAlive), "SIGKILL");
        await child.status.catch(() => {});
      }
      await server.shutdown();
      await Deno.remove(home, { recursive: true });
    }
  },
});
