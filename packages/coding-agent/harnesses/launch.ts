// lophn MCP server의 시작 조각이다.
// 순수 값이다. 절대 Deno executable·설치 resource·cache 경로는 설치 adapter가
// 해석해 인자로 준다. argv는 분리된 배열이고
// shell 문자열로 합치지 않는다. env에는 connection 참조와 toolsets 같은 안전
// 이름만 있고 token 원문은 어디에도 없다.
import type { JsonValue } from "./adapters/json.ts";
import type { McpShape } from "./model.ts";

// mcp-server는 지워졌다. 이 file은 coding-agent-harness가 지운다.
const MCP_ENTRY = "packages/coding-agent/mcp-server/main.ts";

export type LaunchInputs = {
  // 절대 Deno executable이다.
  executable: string;
  // 설치 resource 루트, Deno cache, daemon discovery 파일, 제출 root다.
  resources: string;
  cache: string;
  discoveryFiles: readonly string[];
  submissionRoot: string;
  // core loopback `host:port`와 허용 앱 loopback `host:port`다.
  coreAddress: string;
  appAddresses: readonly string[];
  // 앱 direct socket의 정확한 절대 경로 목록이다(없으면 앱 direct 연결은 unavailable이다).
  appSockets?: readonly string[];
  connection: string;
  toolsets: string;
  // 설치 묶음의 credential helper 절대 경로다. 실행 권한은 이 경로 하나뿐이다(architecture 2.2).
  credentialHelper: string;
};

export type McpLaunch = {
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
};

// 일곱 제품이 같은 server를 같은 권한으로 시작하게 하는 argv다.
export function launchOf(input: LaunchInputs): McpLaunch {
  const sockets = input.appSockets ?? [];
  // /proc/self/stat은 helper 요청의 process generation(시작 tick)을 읽는 고정 파일이다.
  const read = [
    input.resources,
    input.cache,
    ...input.discoveryFiles,
    input.submissionRoot,
    "/proc/self/stat",
    ...sockets,
  ];
  const net = [
    input.coreAddress,
    ...input.appAddresses,
    ...sockets.map((path) => `unix:${path}`),
  ];
  return {
    executable: input.executable,
    args: [
      "run",
      "--cached-only",
      "--no-prompt",
      "--config",
      `${input.resources}/deno.json`,
      `--allow-read=${read.join(",")}`,
      "--allow-env=LOPHN_HOME,LOPHN_CONNECTION,LOPHN_DAEMON_URL,LOPHN_APP,LOPHN_MCP_TOOLSETS,LOPHN_AGENT_LABEL,DENO_DIR",
      `--allow-net=${net.join(",")}`,
      // 쓰기는 앱 direct socket의 정확한 경로뿐이다(unix socket 연결이 net·read·write를 함께 요구한다).
      ...(sockets.length > 0 ? [`--allow-write=${sockets.join(",")}`] : []),
      // credential helper 하나만 실행한다. 다른 실행·일반 쓰기·ffi 권한은 없다.
      `--allow-run=${input.credentialHelper}`,
      `${input.resources}/${MCP_ENTRY}`,
      "--connection",
      input.connection,
      "--toolsets",
      input.toolsets,
      "--cwd",
      input.submissionRoot,
    ],
    env: {
      LOPHN_CONNECTION: input.connection,
      LOPHN_MCP_TOOLSETS: input.toolsets,
    },
  };
}

// 제품별 MCP 항목 모양이다(domain-model 일곱 adapter 표).
export function mcpEntryOf(
  shape: McpShape | undefined,
  launch: McpLaunch,
): JsonValue {
  if (shape === "opencode_local") {
    // type=local, command 배열(executable 포함), environment다.
    return {
      type: "local",
      command: [launch.executable, ...launch.args],
      environment: { ...launch.env },
    };
  }
  return {
    command: launch.executable,
    args: [...launch.args],
    env: { ...launch.env },
  };
}
