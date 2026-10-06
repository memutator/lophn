// shell#T44: 세션 앱 카드의 scroll bounds. 실제 Electron(Chromium)을 화면 없이(show:false·offscreen)
// 띄워 창 본문에 카드 목록 page를 싣는다. page는 renderer의 실제 bounds relay
// (`apps/shell/renderer/app-frame/bounds.ts`)로 카드 자리를 목록 scroll 경계로 자른 사각형만
// 알리고, shell main과 같은 app-frame 조립이 card 크기 앱 view를 그 사각형에 붙인다. core 앱
// 통로만 probe의 가짜 connector이고 앱 화면은 이 테스트가 Unix socket에 띄운 가짜 앱이 내준다.
// - shell/app-frame#R35: 일부만 보이면 보이는 만큼, 다 보이면 전체, 목록 밖이면 떼고, 돌아오면
//   다시 붙인다. 연속 scroll 중에도 붙인 view가 목록 경계 밖에 보인 frame이 없다.
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
const probeSource = `${shellMain}/app-frame/testdata/app-card-probe.ts`;
const boundsSource = `${repoRoot}/apps/shell/renderer/app-frame/bounds.ts`;

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const RELEASE = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const MESSAGE = "msg_01j9zzzzzzzzzzzzzzzzzzzzzz";

// 상단 바 48px 아래 폭 600px·높이 400px 목록. 카드는 목록 안 300px 아래, 왼쪽 20px, 400×240px다.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; }
  #list { position: absolute; top: 48px; left: 0; width: 600px; height: 400px; overflow-y: auto; }
  #card { margin-left: 20px; width: 400px; height: 240px; }
</style></head><body>
<div id="list"><div style="height:300px"></div><div id="card"></div><div style="height:1200px"></div></div>
<script src="bounds.js"></script>
<script>
  const list = document.getElementById("list");
  const card = document.getElementById("card");
  function listRect() {
    const box = list.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  }
  function scrollList(top) { list.scrollTop = top; }
  function startCard() {
    lophnBounds.startBoundsRelay({
      element: card,
      covers: () => [],
      onCoversChange: () => () => {},
      send: (rect) => console.log("bounds " + JSON.stringify(rect)),
      hide: () => console.log("hide"),
      frame: {
        request: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle),
      },
      observe(elements, callback) {
        const observer = new ResizeObserver(callback);
        for (const element of elements) observer.observe(element);
        return () => observer.disconnect();
      },
    });
  }
</script></body></html>`;

async function node(script: string, args: string[]): Promise<void> {
  const output = await new Deno.Command("node", {
    args: ["--input-type=module", "-e", script, "app-card", ...args],
    cwd: shellMain,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(`build 실패: ${new TextDecoder().decode(output.stderr)}`);
  }
}

/** probe main은 shell main build로, page의 bounds relay는 browser IIFE 하나로 묶는다. */
async function build(out: string): Promise<void> {
  await node(
    "const { build } = await import(process.argv[2]); " +
      "await build(process.argv[3], [{ in: process.argv[4], out: 'probe' }]);",
    [`${shellMain}/build.ts`, out, probeSource],
  );
  await node(
    "const esbuild = await import(process.argv[2]); " +
      "await esbuild.build({ entryPoints: [process.argv[3]], bundle: true, " +
      "format: 'iife', globalName: 'lophnBounds', platform: 'browser', " +
      "outfile: process.argv[4] });",
    [
      `${shellMain}/node_modules/esbuild/lib/main.js`,
      boundsSource,
      `${out}/bounds.js`,
    ],
  );
}

function fakeApp(path: string) {
  return Deno.serve({ path, onListen() {} }, (request) => {
    const url = new URL(request.url);
    if (request.headers.get("authorization") !== `probe ${APP}`) {
      return new Response("{}", { status: 401 });
    }
    if (url.pathname === "/screens/main/index.html") {
      return new Response(
        '<!doctype html><html><body style="margin:0;background:#3a3">' +
          "<p>card</p></body></html>",
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
    "shell/app-frame#R35: 세션 카드는 목록 scroll 경계 안의 보이는 사각형에만 붙고 경계 밖이면 떨어지며 경계 밖에 보인 frame이 없다",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-app-card-" });
    await Deno.chmod(home, 0o700);
    const out = `${home}/dist`;
    const userData = `${home}/user-data`;
    await Deno.mkdir(userData, { mode: 0o700 });
    const socket = `${home}/app.sock`;
    const server = fakeApp(socket);
    let child: Deno.ChildProcess | undefined;
    try {
      await build(out);
      await Deno.writeTextFile(`${out}/page.html`, PAGE);
      const config = {
        userData,
        result: `${home}/result.json`,
        preload: `${out}/preload-app.cjs`,
        page: `${out}/page.html`,
        app: APP,
        release: RELEASE,
        socket,
        message: MESSAGE,
        block: "usage",
      };
      child = new Deno.Command(electronExecutable, {
        args: [`${out}/probe.cjs`],
        env: {
          LOPHN_APP_CARD: JSON.stringify(config),
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
        list: Bounds;
        steps: Record<string, Bounds | undefined>;
        detached: boolean;
        attaches: number;
        outsideList: Bounds[];
      };
      assertEquals(result.list, { x: 0, y: 48, width: 600, height: 400 });
      // 처음에는 카드 위 100px만 목록 안이다.
      assertEquals(result.steps.partial, {
        x: 20,
        y: 348,
        width: 400,
        height: 100,
      });
      assertEquals(result.steps.whole, {
        x: 20,
        y: 148,
        width: 400,
        height: 240,
      });
      // 목록 위로 나가면 뗀다. 돌아오면 보이는 만큼 다시 붙인다.
      assertEquals(result.steps.outside, undefined);
      assertEquals(result.detached, true);
      assertEquals(result.steps.back, {
        x: 20,
        y: 248,
        width: 400,
        height: 200,
      });
      assert(result.attaches > 3);
      assertEquals(result.outsideList, []);
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
