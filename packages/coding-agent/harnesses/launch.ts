// lophn MCP server의 시작 조각이다(coding-agent/harnesses#R8, cli#R9, T30).
// 순수 값이다. 절대 Deno executable·설치 resource·cache 경로는 설치 adapter가
// 해석해 인자로 준다(architecture/coding-agent 2.2). argv는 분리된 배열이고
// shell 문자열로 합치지 않는다. env에는 connection 참조와 toolsets 같은 안전
// 이름만 있고 token 원문은 어디에도 없다(R12, connection#R17).
import type { JsonValue } from "./adapters/json.ts";
import type { McpShape } from "./model.ts";

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
  connection: string;
  toolsets: string;
};

export type McpLaunch = {
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
};

// 일곱 제품이 같은 server를 같은 권한으로 시작하게 하는 argv다.
export function launchOf(input: LaunchInputs): McpLaunch {
  const read = [
    input.resources,
    input.cache,
    ...input.discoveryFiles,
    input.submissionRoot,
  ];
  const net = [input.coreAddress, ...input.appAddresses];
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
      `${input.resources}/packages/coding-agent/mcp/main.ts`,
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
