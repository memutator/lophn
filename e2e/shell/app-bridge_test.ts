// shell#T38: 앱 preload bridge. 실제 Electron(Chromium)을 화면 없이(show:false·offscreen) 띄워
// shell main과 같은 app-frame 조립으로 앱 view를 열고, 페이지(main world)가 `lophnApp`만으로
// command를 부르고 외부 링크를 열고 처리되지 않은 오류를 낸다. core 통로·OS browser·collector
// 전송만 probe의 가짜이고 앱 화면과 invoke는 이 테스트가 Unix socket에 띄운 가짜 앱이 받는다.
// - shell/app-frame#R13, R15: 페이지에는 call·openExternal만 있고 Node·ipcRenderer가 없다.
//   call은 command 범위가 있는 연결로 고정 invoke 경로에 가고, 선언 밖 command와 사람이 거절한
//   confirm command는 앱에 닿지 않는다.
// - shell/app-frame#R5, R6: 다른 scheme·userinfo·8,193자 URL은 열지 않고 기록에는 origin·path만.
// - problems/reporting#R5, R6: 페이지의 error·unhandledrejection·루트 render 오류가 설치 preload를 거쳐 실제 view
//   신원으로 전달된다.
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
const probeSource = `${shellMain}/app-frame/testdata/app-bridge-probe.ts`;

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const OTHER = "app_01j9yyyyyyyyyyyyyyyyyyyyyy";
const RELEASE = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";

async function buildProbe(out: string): Promise<void> {
  const output = await new Deno.Command("node", {
    args: [
      "--input-type=module",
      "-e",
      "const { build } = await import(process.argv[2]); " +
      "await build(process.argv[3], [{ in: process.argv[4], out: 'probe' }]);",
      "app-bridge-probe",
      `${shellMain}/build.ts`,
      out,
      probeSource,
    ],
    cwd: shellMain,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(`build 실패: ${new TextDecoder().decode(output.stderr)}`);
  }
}

/** 가짜 앱 프로세스. 화면 연결은 화면만, command 연결은 invoke만 받는다. */
function fakeApp(path: string) {
  const invokes: { authorization: string | null; body: unknown }[] = [];
  const screens: string[] = [];
  const server = Deno.serve({ path, onListen() {} }, async (request) => {
    const url = new URL(request.url);
    const authorization = request.headers.get("authorization");
    if (
      url.pathname === "/screens/main/index.html" &&
      authorization === "probe screen"
    ) {
      screens.push(url.pathname);
      return new Response(
        "<!doctype html><html><body><p>app</p></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (
      url.pathname === "/_lophn/commands/invoke" && request.method === "POST"
    ) {
      const body = await request.json();
      invokes.push({ authorization, body });
      if (authorization !== "probe call") {
        return Response.json({
          error: { code: "unauthorized", message: "connection" },
        }, { status: 401 });
      }
      return Response.json({
        result: { result: { rows: 0 }, source: { coverage: "complete" } },
        mode: "live",
      });
    }
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  });
  return { invokes, screens, server };
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

Deno.test({
  name:
    "shell/app-frame#R5, R6, R13, R15, problems/reporting#R5, R6: 앱 페이지는 lophnApp으로만 command·외부 링크를 쓰고 오류는 실제 view 신원으로 전달된다",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-app-bridge-" });
    await Deno.chmod(home, 0o700);
    const out = `${home}/dist`;
    const userData = `${home}/user-data`;
    await Deno.mkdir(userData, { mode: 0o700 });
    const socket = `${home}/app.sock`;
    const fake = fakeApp(socket);
    let child: Deno.ChildProcess | undefined;
    try {
      await buildProbe(out);
      const config = {
        userData,
        result: `${home}/result.json`,
        preload: `${out}/preload-app.cjs`,
        app: APP,
        other: OTHER,
        release: RELEASE,
        socket,
      };
      child = new Deno.Command(electronExecutable, {
        args: [`${out}/probe.cjs`],
        env: {
          LOPHN_APP_BRIDGE: JSON.stringify(config),
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
      const { page, connects, opened, logs, forwards } = report.result as {
        page: Record<string, unknown>;
        connects: string[][];
        opened: string[];
        logs: string[];
        forwards: {
          view: Record<string, unknown>;
          observation: {
            observation: string;
            error: { name: string; message: string | null };
          };
        }[];
      };

      // 페이지에는 call·openExternal만 있고 Node·IPC 통로는 없다.
      assertEquals(page.bridge, ["call", "openExternal"]);
      assertEquals(page.frozen, true);
      assertEquals(page.ipc, "undefined");
      assertEquals(page.require, "undefined");

      // 일반 read는 command 연결로 고정 invoke 경로에 가고 앱 결과가 그대로 온다.
      assertEquals(page.read, {
        ok: true,
        value: {
          result: { result: { rows: 0 }, source: { coverage: "complete" } },
          mode: "live",
        },
      });
      assertEquals(connects, [["usage.list", "account.close"]]);
      assertEquals(fake.invokes, [{
        authorization: "probe call",
        body: {
          request_key: "req-1",
          command: "usage.list",
          release: RELEASE,
          input: {},
        },
      }]);
      // 선언 밖 command와 사람이 거절한 confirm command는 앱에 닿지 않는다.
      assertEquals(page.undeclared, {
        ok: false,
        message: "invalid_input: command is not available",
      });
      assertEquals(page.confirm, {
        ok: false,
        message: "forbidden: the person declined",
      });

      // 외부 링크는 형식 검사를 통과한 것만 열고 기록에는 origin·path만 남는다.
      assertEquals(page.external, { ok: true });
      for (const name of ["badScheme", "userinfo", "long"]) {
        assertEquals(page[name], {
          ok: false,
          message: "invalid_input: external link is invalid",
        }, name);
      }
      assertEquals(opened, ["https://example.com/oauth?state=SECRET#frag"]);
      const logged = logs.join("\n");
      assert(logged.includes("origin=https://example.com path=/oauth"));
      assertEquals(logged.includes("SECRET"), false);
      assertEquals(logged.includes("frag"), false);

      // 처리되지 않은 오류가 설치 preload를 거쳐 실제 view 신원으로 온다.
      const kinds = forwards.map((item) => item.observation.observation).sort();
      assertEquals(kinds, ["error", "render_error", "unhandledrejection"]);
      for (const forward of forwards) {
        assertEquals(forward.view.app, APP);
        assertEquals(forward.view.release, RELEASE);
        assertEquals(forward.view.mode, "live");
        assertEquals(forward.view.view_session, "view-1");
        assertEquals(forward.view.binding, "probe screen");
      }
      const error = forwards.find((item) =>
        item.observation.observation === "error"
      )!;
      assert(
        (error.observation.error.message ?? "").includes("boom"),
        JSON.stringify(error.observation.error),
      );
      // 화면에는 socket 경로·인증 값이 보이지 않는다.
      const visible = JSON.stringify(page);
      assertEquals(visible.includes(".sock"), false);
      assertEquals(visible.includes("probe call"), false);
      assertEquals(fake.screens.length > 0, true);
    } finally {
      if (child !== undefined) {
        const tree = await descendantPids(child.pid);
        signalPids(tree.filter(processAlive), "SIGKILL");
        await child.status.catch(() => {});
      }
      await fake.server.shutdown();
      await Deno.remove(home, { recursive: true });
    }
  },
});
