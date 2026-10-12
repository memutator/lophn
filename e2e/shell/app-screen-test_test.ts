// shell#T46: 앱 화면 검사 host. problems runner처럼 Deno 부모가 build한 실제 실행 파일을
// `--app-screen-test`로 띄우고 상속 fd 3의 JSON lines로 입력을 주고 관측을 받는다. 앱 화면은
// 고정 bundle fixture(`fixtures/app-screens`)이고 앱 command는 이 테스트가 Unix socket에 띄운 가짜
// test 앱이 받는다. 창은 OS에 띄우지 않는다(show:false·offscreen).
// - problems/tests#R7: view의 error·unhandledrejection·루트 render 오류가 관측으로 오고, 깨진
//   view(load 실패·멈춤)에서도 feedback binding·캡처·dialog 결과가 온다.
// - problems/tests#R19: 관측은 stdout이 아닌 상속 fd 3의 한 줄 JSON이고 contract schema를 지나며
//   frame 상한 안이다. 막힌 network 시도는 주소의 hash만 실린다.
// - 사람 데이터: HOME·LOPHN_HOME에 아무것도 만들지 않고 임시 userData는 끝나면 사라진다.
import { assert, assertEquals } from "@std/assert";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { screenTestObservationSchema } from "../../packages/protocol/shell/screen-test.ts";
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
const bundleScreens = `${repoRoot}/fixtures/app-screens`;

async function buildShell(out: string): Promise<void> {
  const output = await new Deno.Command("node", {
    args: [
      "--input-type=module",
      "-e",
      "const { build } = await import(process.argv[2]); await build(process.argv[3]);",
      "app-screen-test",
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

/** 가짜 test 앱. 화면은 bundle 파일에서 오므로 invoke만 받는다. */
function fakeApp(path: string) {
  const invokes: unknown[] = [];
  const server = Deno.serve({ path, onListen() {} }, async (request) => {
    const url = new URL(request.url);
    if (
      url.pathname === "/_lophn/commands/invoke" && request.method === "POST"
    ) {
      invokes.push(await request.json());
      return Response.json({ result: { result: { pong: true } } });
    }
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  });
  return { invokes, server };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function readLine(stream: Readable, ms: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let text = "";
    const timer = setTimeout(() => resolve(undefined), ms);
    stream.on("data", (chunk: Uint8Array) => {
      text += new TextDecoder().decode(chunk);
      const newline = text.indexOf("\n");
      if (newline >= 0) {
        clearTimeout(timer);
        resolve(text.slice(0, newline + 1));
      }
    });
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(text === "" ? undefined : text);
    });
  });
}

async function entries(path: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(path)) names.push(entry.name);
  return names.sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name:
    "problems/tests#R7, R19: 화면 검사 host는 fd 3 JSON lines로 view 오류·깨진 view의 feedback·막힌 요청을 돌려주고 사람 데이터를 건드리지 않는다",
  ignore: !e2eEnabled(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "lophn-e2e-screen-test-" });
    await Deno.chmod(root, 0o700);
    const out = `${root}/dist`;
    const home = `${root}/home`;
    const lophnHome = `${root}/lophn-home`;
    const tmp = `${root}/tmp`;
    for (const dir of [home, lophnHome, tmp]) {
      await Deno.mkdir(dir, { mode: 0o700 });
    }
    const socket = `${root}/app.sock`;
    const fake = fakeApp(socket);
    let pid: number | undefined;
    try {
      await buildShell(out);
      const env: Record<string, string> = {
        HOME: home,
        LOPHN_HOME: lophnHome,
        TMPDIR: tmp,
        PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
      };
      for (const name of ["DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"]) {
        const value = Deno.env.get(name);
        if (value !== undefined) env[name] = value;
      }
      const child = spawn(
        electronExecutable,
        [`${out}/main.cjs`, "--app-screen-test"],
        { env, stdio: ["ignore", "pipe", "pipe", "pipe"] },
      );
      pid = child.pid;
      const exited = new Promise<number | null>((resolve) =>
        child.on("exit", (code) => resolve(code))
      );
      let stdout = "";
      child.stdout!.on("data", (chunk: Uint8Array) => {
        stdout += new TextDecoder().decode(chunk);
      });
      child.stderr!.on("data", () => {});
      const pipe = child.stdio[3] as unknown as Readable & Writable;
      const reply = readLine(pipe, 90_000);
      pipe.write(
        JSON.stringify({
          bundle_screens_dir: bundleScreens,
          screens: [
            { key: "hang", path: "hang/index.html" },
            { key: "main", path: "main/index.html" },
            { key: "missing", path: "missing/index.html" },
          ],
          app_socket_path: socket,
          deadline_ms: 15_000,
        }) + "\n",
      );
      const line = await reply;
      assert(line !== undefined, "관측이 fd 3에 오지 않았다");
      assert(new TextEncoder().encode(line).byteLength <= 65_536);
      assert(!line.includes("secret=fixture"), "막힌 주소 원문이 실렸다");
      const observation = screenTestObservationSchema.parse(JSON.parse(line));
      assertEquals(await exited, 0);
      assertEquals(stdout, "");

      // load: 정상 화면만 ok, 멈춘 화면은 기한, 없는 파일은 load 실패.
      const load = Object.fromEntries(
        observation.load.map((item) => [item.screen, item]),
      );
      assertEquals(load.main, { screen: "main", ok: true, reason: null });
      assertEquals(load.hang?.ok, false);
      assertEquals(load.hang?.reason, "timeout");
      assertEquals(load.missing?.ok, false);

      // view 오류 세 갈래가 설치 preload를 거쳐 그 화면의 관측으로 온다.
      const errors = observation.errors.filter((item) =>
        item.screen === "main"
      );
      assertEquals(
        errors.map((item) => item.observation).sort(),
        ["error", "render_error", "unhandledrejection"],
      );
      const byKind = Object.fromEntries(
        errors.map((item) => [item.observation, item]),
      );
      assert(byKind.error?.message?.includes("screen fixture error"));
      assertEquals(byKind.unhandledrejection?.name, "TypeError");
      assertEquals(byKind.render_error?.name, "RenderError");

      // 깨진 view에서도 feedback 경로가 남는다: 앱 view와 다른 renderer의 dialog가 열린다.
      const feedback = Object.fromEntries(
        observation.feedback_check.map((item) => [item.screen, item]),
      );
      assertEquals(feedback.main, {
        screen: "main",
        binding: true,
        capture: "captured",
        dialog: "opened",
      });
      assertEquals(feedback.hang?.binding, true);
      assertEquals(feedback.hang?.dialog, "opened");
      assertEquals(feedback.missing?.dialog, "opened");

      // CSP가 막은 fetch는 주소 hash로만 관측된다.
      const blockedHash = await sha256(
        "https://example.com/blocked?secret=fixture",
      );
      assert(
        observation.blocked_requests.some((item) =>
          item.screen === "main" && item.url_hash === blockedHash
        ),
        JSON.stringify(observation.blocked_requests),
      );

      // 앱 command는 runner가 준 test 앱 socket의 고정 invoke 경로로 간다.
      assertEquals(fake.invokes.length, 1);
      const invoke = fake.invokes[0] as Record<string, unknown>;
      assertEquals(invoke.command, "fixture.ping");
      assertEquals(invoke.input, { n: 1 });

      // 사람 데이터 root를 만들지 않고 임시 userData는 지워진다.
      assertEquals(await exists(`${home}/.lophn`), false);
      assertEquals(await exists(`${home}/.config/lophn`), false);
      assertEquals(await entries(lophnHome), []);
      assertEquals(
        (await entries(tmp)).filter((name) =>
          name.startsWith("lophn-app-screen-test-")
        ),
        [],
      );
    } finally {
      if (pid !== undefined) {
        const tree = [pid, ...await descendantPids(pid)];
        signalPids(tree.filter(processAlive), "SIGKILL");
      }
      await fake.server.shutdown();
      await Deno.remove(root, { recursive: true });
    }
  },
});
