// MCP 앱 direct socket 권한 시험이다(mcp#R29, T36). 앱 direct socket에 연결하려면 Deno가 그 경로의
// net(`unix:<경로>`)·read·write를 요구한다. 그래서 쓰기 권한은 정확한 socket 경로 각각뿐이고 일반 쓰기·
// 폴더·와일드카드는 없다. 실제 Deno process로 허락한 경로만 연결되는지 본다. 사람의 실제 data root는
// 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { launchOf } from "../harnesses/launch.ts";
import { mcpLaunchArgv } from "./launch.ts";

const SOCKETS = [
  "/run/user/1000/lophn/a0.sock",
  "/run/user/1000/lophn/a1.sock",
];

Deno.test("coding-agent/mcp-server#R29: 실행 argv의 쓰기 권한은 앱 direct socket의 정확한 경로뿐이다", () => {
  const argv = mcpLaunchArgv({
    deno: "/opt/lophn/deno",
    resources: "/opt/lophn/platform",
    cache: "/home/u/.cache/lophn/deno",
    connection: "cac_x",
    coreEndpoint: "http://127.0.0.1:7431",
    appSockets: SOCKETS,
  });
  const write = argv.args.filter((arg) => arg.startsWith("--allow-write"));
  assertEquals(write, [`--allow-write=${SOCKETS.join(",")}`]);
  assertFalse(argv.args.includes("--allow-write"));
  assert(
    argv.args.some((arg) =>
      arg.startsWith("--allow-net=127.0.0.1:7431,") &&
      arg.includes(`unix:${SOCKETS[0]}`) && arg.includes(`unix:${SOCKETS[1]}`)
    ),
  );
  assert(
    argv.args.some((arg) =>
      arg.startsWith("--allow-read=") && arg.includes(SOCKETS[0])
    ),
  );
  // 앱 socket이 없으면 쓰기 권한이 아예 없다.
  const none = mcpLaunchArgv({
    deno: "/opt/lophn/deno",
    resources: "/opt/lophn/platform",
    cache: "/home/u/.cache/lophn/deno",
    connection: "cac_x",
    coreEndpoint: "http://127.0.0.1:7431",
  });
  assertFalse(none.args.some((arg) => arg.startsWith("--allow-write")));
});

Deno.test("coding-agent/mcp-server#R29: 설치가 쓰는 launchOf도 같은 정확한 경로만 허락하고 일반 쓰기는 없다", () => {
  const launch = launchOf({
    executable: "/opt/lophn/deno",
    resources: "/opt/lophn/platform",
    cache: "/home/u/.cache/lophn/deno",
    discoveryFiles: [],
    submissionRoot: "/home/u/work",
    coreAddress: "127.0.0.1:7431",
    appAddresses: [],
    appSockets: SOCKETS,
    connection: "cac_x",
    toolsets: "core,app",
    credentialHelper: "/opt/lophn/lophn-credential",
  });
  assertEquals(
    launch.args.filter((arg) => arg.startsWith("--allow-write")),
    [`--allow-write=${SOCKETS.join(",")}`],
  );
  assert(launch.args.includes("--allow-run=/opt/lophn/lophn-credential"));
});

Deno.test("coding-agent/mcp-server#R29: 허락한 정확한 socket에만 연결되고 다른 경로·쓰기는 권한 오류다", async () => {
  const dir = await Deno.makeTempDir({ dir: "/tmp", prefix: "lophn-p-" });
  const allowed = `${dir}/a0.sock`;
  const other = `${dir}/a1.sock`;
  const server = Deno.serve(
    { path: allowed, onListen: () => {} },
    () => new Response("ok"),
  );
  const otherServer = Deno.serve(
    { path: other, onListen: () => {} },
    () => new Response("ok"),
  );
  const script = `
    const report = [];
    for (const path of Deno.args) {
      try {
        const conn = await Deno.connect({ transport: "unix", path });
        conn.close();
        report.push("connected");
      } catch (error) {
        report.push(error.name);
      }
    }
    try {
      await Deno.writeTextFile(Deno.args[0] + ".txt", "x");
      report.push("wrote");
    } catch (error) {
      report.push(error.name);
    }
    console.log(JSON.stringify(report));
  `;
  try {
    // `deno eval`은 모든 권한으로 돌아 허락 검사가 의미 없다. 파일로 `deno run`한다.
    const entry = `${dir}/probe.ts`;
    await Deno.writeTextFile(entry, script);
    const out = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        `--allow-read=${allowed}`,
        `--allow-write=${allowed}`,
        `--allow-net=unix:${allowed}`,
        entry,
        allowed,
        other,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
    assertEquals(JSON.parse(new TextDecoder().decode(out.stdout)), [
      "connected",
      "NotCapable",
      "NotCapable",
    ]);
  } finally {
    await server.shutdown();
    await otherServer.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});
