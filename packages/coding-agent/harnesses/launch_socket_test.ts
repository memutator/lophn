// 설치가 쓰는 MCP 시작 조각의 앱 direct socket 권한 시험이다(mcp#R29, T36). 쓰기 권한은 정확한 socket 경로
// 각각뿐이고 일반 쓰기는 없다. 사람의 실제 설정은 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { launchOf } from "./launch.ts";

const SOCKETS = [
  "/run/user/1000/lophn/a0.sock",
  "/run/user/1000/lophn/a1.sock",
];

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
