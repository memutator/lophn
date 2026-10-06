// shell#T37: 앱 view 격리. 실제 Electron(Chromium)을 화면 없이(show:false·offscreen) 띄워
// shell main과 같은 app-frame 조립(scheme 등록, electron adapter, registry, session 정책,
// lophn-app proxy)으로 앱 view를 연다. core 앱 통로만 probe의 가짜 connector이고, 앱 화면은
// 이 테스트가 Unix socket에 띄운 가짜 앱 프로세스가 내준다.
// - shell/app-frame#R1, R8: 앱 사이·live와 preview 사이·preview bundle 사이에 localStorage·
//   IndexedDB·cookie를 읽지 못한다. 같은 앱·mode는 같은 저장을 본다.
// - shell/app-frame#R2, R16: 부여한 fetch host만 나가고 미부여 host·port·redirect·WebSocket·
//   subframe·다른 앱·shell scheme은 막힌다. 막힌 요청은 서버에 닿지 않는다.
// - shell/app-frame#R3, R4, R9: view에 Node·socket 경로가 없고 새 창·camera·location·scheme 밖
//   탐색을 거절한다.
// - shell/app-frame#R22: view 생성·attach·폐기가 같은 view_session으로 진단에 남는다.
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
const probeSource = `${shellMain}/app-frame/testdata/app-isolation-probe.ts`;

const APP_A = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const APP_B = "app_01j9yyyyyyyyyyyyyyyyyyyyyy";
const RELEASE = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const LIVE_HASH = "0".repeat(64);
const PREVIEW_HASHES = ["1".repeat(64), "2".repeat(64)];

async function run(command: string, args: string[], cwd?: string) {
  const output = await new Deno.Command(command, {
    args,
    ...(cwd ? { cwd } : {}),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `${command} 실패: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
}

/**
 * build.ts로 shell main·preload와 probe를 같은 dist에 묶는다. argv[1]이 build.ts면 build.ts가
 * 자기 실행(dist·native rebuild)으로 알아듣으므로 첫 인자는 이름표로 둔다.
 */
async function buildProbe(out: string): Promise<void> {
  await run(
    "node",
    [
      "--input-type=module",
      "-e",
      "const { build } = await import(process.argv[2]); " +
      "await build(process.argv[3], [{ in: process.argv[4], out: 'probe' }]);",
      "app-isolation-probe",
      `${shellMain}/build.ts`,
      out,
      probeSource,
    ],
    shellMain,
  );
}

async function selfSignedCert(dir: string) {
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    `${dir}/key.pem`,
    "-out",
    `${dir}/cert.pem`,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ]);
  return {
    cert: await Deno.readTextFile(`${dir}/cert.pem`),
    key: await Deno.readTextFile(`${dir}/key.pem`),
  };
}

/** 바깥 HTTPS 서버. 받은 요청 경로를 모두 적는다. */
function https(
  tls: { cert: string; key: string },
  handler: (path: string, request: Request) => Response,
) {
  const seen: string[] = [];
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...tls,
    onListen() {},
  }, (request) => {
    const path = new URL(request.url).pathname;
    seen.push(path);
    if (request.headers.get("upgrade") === "websocket") {
      const { response } = Deno.upgradeWebSocket(request);
      return response;
    }
    return handler(path, request);
  });
  return { seen, server, port: server.addr.port };
}

/** 가짜 앱 프로세스 하나. 자기 key의 인증만 받고 화면 byte를 내준다. */
function fakeApp(path: string, key: string) {
  const seen: { path: string; view: string | null }[] = [];
  const server = Deno.serve({ path, onListen() {} }, (request) => {
    const url = new URL(request.url);
    seen.push({
      path: url.pathname,
      view: url.searchParams.get("view_session"),
    });
    if (request.headers.get("authorization") !== `probe ${key}`) {
      return new Response("{}", { status: 401 });
    }
    if (url.pathname === "/screens/main/index.html") {
      return new Response(
        "<!doctype html><html><body><p>app</p></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    return new Response("{}", { status: 404 });
  });
  return { seen, server };
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

type Storage = { local: string | null; idb: unknown };

Deno.test({
  name:
    "shell/app-frame#R1, R2, R3, R4, R8, R9, R16, R22: 앱 사이·preview 사이 저장은 섞이지 않고 미부여 host는 막히며 view에 Node·socket이 없다",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-app-iso-" });
    await Deno.chmod(home, 0o700);
    const out = `${home}/dist`;
    const userData = `${home}/user-data`;
    await Deno.mkdir(userData, { mode: 0o700 });
    const tls = await selfSignedCert(home);
    const granted = https(tls, (path, request) => {
      // credential을 싣는 요청은 정확한 origin과 허락 header가 있어야 응답을 읽는다.
      const cors = {
        "access-control-allow-origin": request.headers.get("origin") ?? "*",
        "access-control-allow-credentials": "true",
      };
      if (path === "/redirect") {
        return new Response(null, {
          status: 302,
          headers: {
            ...cors,
            location: `https://127.0.0.1:${denied.port}/redirected`,
          },
        });
      }
      if (path === "/cookie-set") {
        return new Response("set", {
          headers: {
            ...cors,
            "set-cookie": "k=a-live; Path=/; Secure; SameSite=None",
          },
        });
      }
      if (path === "/cookie-echo") {
        return new Response(request.headers.get("cookie") ?? "", {
          headers: cors,
        });
      }
      return new Response("granted-ok", { headers: cors });
    });
    const denied = https(tls, () =>
      new Response("denied-reached", {
        headers: { "access-control-allow-origin": "*" },
      }));
    const keys = [
      `${APP_A}:live:${LIVE_HASH}`,
      `${APP_B}:live:${LIVE_HASH}`,
      `${APP_A}:preview:${PREVIEW_HASHES[0]}`,
      `${APP_A}:preview:${PREVIEW_HASHES[1]}`,
    ];
    const sockets: Record<string, string> = {};
    const apps = keys.map((key, index) => {
      sockets[key] = `${home}/app-${index}.sock`;
      return { key, ...fakeApp(sockets[key]!, key) };
    });
    let child: Deno.ChildProcess | undefined;
    try {
      await buildProbe(out);
      const config = {
        userData,
        result: `${home}/result.json`,
        preload: `${out}/preload-app.cjs`,
        appA: APP_A,
        appB: APP_B,
        release: RELEASE,
        previewHashes: PREVIEW_HASHES,
        sockets,
        granted: { host: "127.0.0.1", port: granted.port },
        denied: { host: "127.0.0.1", port: denied.port },
      };
      child = new Deno.Command(electronExecutable, {
        args: [`${out}/probe.cjs`],
        env: {
          LOPHN_APP_ISOLATION: JSON.stringify(config),
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
        write: boolean;
        cookieSet: string;
        cookieSame: string;
        cookiePreview1: string;
        cookiePreview2: string;
        jars: string[][];
        sameApp: Storage;
        otherApp: Storage;
        preview1: Storage;
        preview2: Storage;
        liveAfter: Storage;
        networkA: Record<string, string>;
        networkB: Record<string, string>;
        surface: {
          require: string;
          process: string;
          bridge: string[];
          opened: boolean;
          media: string;
          geo: string;
          href: string;
          resources: string[];
          html: string;
        };
        afterNavigate: string;
        destroyed: boolean[];
        diagnostics: Record<string, number | string>[];
      };

      // 같은 앱·live는 같은 저장을 본다(대조군). 다른 앱·preview·다른 bundle은 읽지 못한다.
      assertEquals(result.write, true);
      assertEquals(result.sameApp.local, "a-live");
      assertEquals(result.sameApp.idb, "a-live");
      for (
        const [name, storage] of Object.entries({
          otherApp: result.otherApp,
          preview1: result.preview1,
          preview2: result.preview2,
        })
      ) {
        assertEquals(storage.local, null, name);
        assertEquals(storage.idb, null, name);
      }
      assertEquals(result.liveAfter.local, "a-live");
      assertEquals(result.liveAfter.idb, "a-live");
      // 부여한 host가 남긴 cookie도 그 partition에만 있다.
      assertEquals(result.cookieSet, "set");
      assertEquals(result.cookieSame, "k=a-live");
      assertEquals(result.cookiePreview1, "");
      assertEquals(result.cookiePreview2, "");
      assertEquals(result.jars, [
        ["k=a-live"],
        [],
        ["k=a-live"],
        [],
      ]);

      // 부여한 host만 나간다. 나머지는 서버에 닿지 않는다.
      assertEquals(result.networkA.granted, "granted-ok");
      for (
        const name of [
          "denied",
          "deniedPort",
          "redirect",
          "socket",
          "otherApp",
          "shell",
        ]
      ) {
        assertEquals(result.networkA[name], "blocked", name);
      }
      assertEquals(result.networkB.granted, "blocked");
      assertEquals(denied.seen, []);
      // 새 창(/popup)·main frame 탐색(/navigate)은 부여한 host여도 나가지 않는다.
      assertEquals(
        granted.seen.filter((path) => !path.startsWith("/cookie-")).sort(),
        ["/ok", "/redirect"],
      );

      // view에는 Node·socket 경로가 없고 새 창·장치·scheme 밖 탐색을 거절한다.
      assertEquals(result.surface.require, "undefined");
      assertEquals(result.surface.process, "undefined");
      assertEquals(result.surface.bridge, []);
      assertEquals(result.surface.opened, true);
      assert(result.surface.media !== "granted");
      assert(result.surface.geo !== "granted");
      const label = `lophn-app://app-${APP_A.slice(4)}/main/index.html`;
      assertEquals(result.surface.href, label);
      assertEquals(result.afterNavigate, label);
      const visible = JSON.stringify(result.surface);
      assertEquals(visible.includes(".sock"), false);
      assertEquals(visible.includes(home), false);
      assertEquals(visible.includes("probe "), false);

      // 각 view는 자기 연결의 앱 socket에만 갔다.
      for (const app of apps) {
        assert(app.seen.length > 0, app.key);
        for (const request of app.seen) {
          assertEquals(request.path, "/screens/main/index.html");
        }
      }
      assertEquals(
        apps.map((app) => [...new Set(app.seen.map((s) => s.view))]),
        [["view-1", "view-2"], ["view-3"], ["view-4"], ["view-5"]],
      );

      // 생성·attach·폐기를 같은 view_session으로 남겼다.
      assertEquals(result.destroyed, [true, true, true, true, true]);
      const disposed = result.diagnostics.filter((payload) =>
        payload.disposed === 1
      );
      assertEquals(
        disposed.map((payload) => [
          payload.view_id,
          payload.created,
          payload.attached,
        ]),
        ["view-1", "view-2", "view-3", "view-4", "view-5"].map((
          id,
        ) => [id, 1, 1]),
      );
    } finally {
      if (child !== undefined) {
        const tree = await descendantPids(child.pid);
        signalPids(tree.filter(processAlive), "SIGKILL");
        await child.status.catch(() => {});
      }
      for (const app of apps) await app.server.shutdown();
      await granted.server.shutdown();
      await denied.server.shutdown();
      await Deno.remove(home, { recursive: true });
    }
  },
});
