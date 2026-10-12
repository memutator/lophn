// MCP 실행 argv 테스트다(R1, connection#R16). 분리 argv로 `--cached-only`를
// 붙이고 원격 접속·시작 download가 생길 수 있는 권한은 없는지, 환경 허용 목록과
// 절대 위치를 본다. 공백 위치로 argv에 그대로 들어가는지도 본다.
import { assertEquals } from "@std/assert";
import { mcpLaunchArgv } from "./launch.ts";

const inputs = {
  deno: "/usr/local/bin/deno",
  resources: "/opt/lophn/resources",
  cache: "/home/u/.cache/lophn/deno",
  connection: "default",
  coreEndpoint: "http://127.0.0.1:8642",
  appEndpoints: ["http://127.0.0.1:9001"],
  discoveryFiles: ["/home/u/.lophn-actual/daemon.json"],
  submissionRoot: "/home/u/work docs",
  toolsets: "core,app",
  label: "codex",
  cwd: "/home/u/work docs",
};

Deno.test(
  "coding-agent/connection#R16: 실행 argv는 --cached-only를 쓰고 원격 권한을 두지 않는다",
  () => {
    const argv = mcpLaunchArgv(inputs);
    assertEquals(argv.command, "/usr/local/bin/deno");
    assertEquals(argv.args[0], "run");
    // 설치된 코드·설정·캐시만 쓴다(R16). 시작 download가 없다.
    assertEquals(argv.args.includes("--cached-only"), true);
    // -A와 허용 밖 권한은 없다(R1).
    assertEquals(argv.args.includes("-A"), false);
    assertEquals(argv.args.includes("--allow-run"), false);
    assertEquals(argv.args.includes("--allow-write"), false);
    assertEquals(argv.args.includes("--allow-ffi"), false);
    // argv에서 시작하는 module은 설치 resource 아래 절대 위치다(R1).
    const argv2 = mcpLaunchArgv({
      deno: "/usr/local/bin/deno",
      resources: "/opt/lophn/resources",
      cache: inputs.cache,
      connection: "",
      coreEndpoint: inputs.coreEndpoint,
    });
    assertEquals(
      argv2.args[argv2.args.length - 1],
      "/opt/lophn/resources/packages/coding-agent/mcp-server/main.ts",
    );
    assertEquals(
      argv2.args.includes("--config=/opt/lophn/resources/deno.json"),
      true,
    );
    // --allow-net은 Deno가 받는 host:port다. URL은 받지 않는다.
    assertEquals(
      argv.args.includes("--allow-net=127.0.0.1:8642,127.0.0.1:9001"),
      true,
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R1: 환경 허용 목록은 token 이름 없이 고정 목록이다",
  () => {
    const argv = mcpLaunchArgv(inputs);
    const envArg = argv.args.find((item) => item.startsWith("--allow-env="));
    assertEquals(
      envArg,
      "--allow-env=LOPHN_HOME,LOPHN_CONNECTION,LOPHN_DAEMON_URL,LOPHN_APP,LOPHN_MCP_TOOLSETS,LOPHN_AGENT_LABEL,DENO_DIR",
    );
    // credential 원문은 argv에 없다. 연결 참조만 있다.
    assertEquals(argv.args.includes("secret-credential"), false);
    assertEquals(argv.env["LOPHN_CONNECTION"], "default");
    assertEquals(argv.env["LOPHN_MCP_TOOLSETS"], "core,app");
    // argv에도 같은 참조가 있다(connection이 argv 정본이다).
    assertEquals(argv.args.includes("--connection"), true);
    assertEquals(argv.args.includes("default"), true);
  },
);

Deno.test(
  "coding-agent/mcp-server#R1: 공백이 든 위치는 분리 argv에 그대로 들어간다",
  () => {
    const argv = mcpLaunchArgv(inputs);
    // shell 문자열로 합치지 않는다. 분리 argv의 항목 하나가 곧 위치다.
    assertEquals(argv.args.includes("/home/u/work docs"), true);
    assertEquals(argv.args.includes("--cwd"), true);
    assertEquals(argv.args.includes("/home/u/work docs"), true);
    assertEquals(argv.args.includes("--label"), true);
    assertEquals(argv.args.includes("codex"), true);
    const read = argv.args.find((item) => item.startsWith("--allow-read="));
    assertEquals(
      read,
      "--allow-read=/opt/lophn/resources,/home/u/.cache/lophn/deno,/home/u/.lophn-actual/daemon.json,/home/u/work docs",
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R1: 권한 밖 항목 없이 최소 argv로 시작 준비가 된다",
  () => {
    // connection·toolsets·label 없이도 argv가 성립한다.
    const argv = mcpLaunchArgv({
      deno: "/usr/bin/deno",
      resources: "/opt/r",
      cache: "/tmp/cache",
      connection: "",
      coreEndpoint: "http://127.0.0.1:1",
    });
    assertEquals(argv.args.includes("--connection"), false);
    assertEquals(argv.args.includes("--toolsets"), false);
    assertEquals(argv.args.includes("--label"), false);
    assertEquals(argv.env, {});
    assertEquals(argv.command, "/usr/bin/deno");
  },
);

Deno.test("coding-agent/connection#R17 coding-agent/mcp-server#R36: 실행 권한은 helper 절대 경로 하나뿐이고 token·일반 run·write 권한이 없다", () => {
  const helper = "/opt/lophn/lophn-credential";
  const argv = mcpLaunchArgv({ ...inputs, credentialHelper: helper });
  const runs = argv.args.filter((arg) => arg.startsWith("--allow-run"));
  assertEquals(runs, [`--allow-run=${helper}`]);
  assertEquals(argv.args.includes("--allow-run"), false);
  assertEquals(argv.args.includes("--allow-write"), false);
  assertEquals(argv.args.some((arg) => arg.includes("token")), false);
  assertEquals(
    argv.args.find((arg) => arg.startsWith("--allow-read="))?.split(",")
      .includes("/proc/self/stat"),
    true,
  );
});
