// MCP 실행 argv 생성이다. 각 <…>는 설치 때 해석한
// 절대 경로·loopback endpoint다. shell 문자열로 합치지 않고 분리 argv로 돌려주며
// `--cached-only`를 붙이고 `-A`·`--allow-run`·`--allow-write`·`--allow-ffi`는 없다.
// OS keychain 접근은 helper 실행 권한 하나뿐이다.

export type McpLaunchInputs = {
  // Deno executable의 절대 위치다.
  deno: string;
  // 설치 resource root다. deno.json 설치 사본과 packages가 여기 아래에 있다.
  resources: string;
  // Deno cache 절대 위치다.
  cache: string;
  // 연결 참조다. credential 원문은 argv에 없다(LOPHN_CONNECTION 참조만 있다).
  connection: string;
  // core loopback endpoint다.
  coreEndpoint: string;
  // app scope 연결이 허용한 app loopback endpoint 목록이다.
  appEndpoints?: readonly string[];
  // 앱 direct socket의 정확한 절대 경로 목록이다. 폴더나 와일드카드가 아니다.
  appSockets?: readonly string[];
  // daemon 발견 파일이 있는 절대 위치 목록이다(현재 daemon 연결 정보·설치 설정).
  discoveryFiles?: readonly string[];
  // 연결 source가 없는 문서 작업의 제출 workspace다. 사람이 선택한 폴더 하나만 있다.
  submissionRoot?: string;
  toolsets?: string;
  // label 표시 순서의 첫 항목이다. 권한과 관계없다.
  label?: string;
  // 현재 작업 폴더다. 대상 앱 blueprint 발견 기준이다.
  cwd?: string;
  // 설치 묶음의 credential helper 절대 경로다. 있으면 실행 권한은 이 경로 하나뿐이다.
  credentialHelper?: string;
};

// MCP 실행 entry의 설치 resource root 기준 경로다. 설치 설정(harnesses)과 doctor
// probe도 이 값 하나로 같은 entry를 가리킨다.
export const MCP_ENTRY = "packages/coding-agent/mcp-server/main.ts";

const TOOLSETS_ENV = "LOPHN_MCP_TOOLSETS";

const TOOLSETS_ARG = "--toolsets";

const CONNECTION_ENV = "LOPHN_CONNECTION";

const CONNECTION_ARG = "--connection";

const LABEL_ARG = "--label";

const CWD_ARG = "--cwd";

// helper는 OS keychain 도구 실행만 허용한 고정 권한 compile binary다
// MCP·CLI에는 이 실행 권한 하나만 준다.
export function helperArg(helperPath: string): string {
  return `--allow-run=${helperPath}`;
}

// loopback endpoint를 Deno --allow-net 값으로 바꾼다. Deno는 URL을 받지 않고
// host:port만 받는다.
function netValue(endpoint: string): string {
  const rest = endpoint.replace(/^https?:\/\//, "");
  return rest.replace(/\/.*$/, "");
}

// 실행 argv를 분리 배열로 만든다. 환경 허용 목록에 token 이름은 없다. helper 경로는
// credential provider가 결정하므로 argv에 넣지 않는다.
export function mcpLaunchArgv(inputs: McpLaunchInputs): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const resources = inputs.resources.replace(/\/$/, "");
  const entry = `${resources}/${MCP_ENTRY}`;
  const config = `${resources}/deno.json`;
  const sockets = inputs.appSockets ?? [];
  const net = [
    netValue(inputs.coreEndpoint),
    ...(inputs.appEndpoints ?? []).map(netValue),
    ...sockets.map((path) => `unix:${path}`),
  ]
    .join(",");
  const read = [
    resources,
    inputs.cache,
    ...(inputs.discoveryFiles ?? []),
    ...(inputs.submissionRoot ? [inputs.submissionRoot] : []),
    // helper 요청의 process generation(시작 tick)을 읽는 고정 파일이다.
    ...(inputs.credentialHelper ? ["/proc/self/stat"] : []),
    ...sockets,
  ].join(",");

  const args = [
    "run",
    "--cached-only",
    "--no-prompt",
    `--config=${config}`,
    `--allow-read=${read}`,
    "--allow-env=LOPHN_HOME,LOPHN_CONNECTION,LOPHN_DAEMON_URL,LOPHN_APP,LOPHN_MCP_TOOLSETS,LOPHN_AGENT_LABEL,DENO_DIR",
    `--allow-net=${net}`,
    ...(sockets.length > 0 ? [`--allow-write=${sockets.join(",")}`] : []),
    ...(inputs.credentialHelper ? [helperArg(inputs.credentialHelper)] : []),
    entry,
  ];
  if (inputs.connection !== "") args.push(CONNECTION_ARG, inputs.connection);
  if (inputs.toolsets !== undefined && inputs.toolsets !== "") {
    args.push(TOOLSETS_ARG, inputs.toolsets);
  }
  if (inputs.label !== undefined && inputs.label !== "") {
    args.push(LABEL_ARG, inputs.label);
  }
  if (inputs.cwd !== undefined && inputs.cwd !== "") {
    args.push(CWD_ARG, inputs.cwd);
  }
  // connection 참조는 worker 환경의 argv 말고 env에도 두지 않는다. argv가 정본이다.
  const env: Record<string, string> = {};
  if (inputs.connection !== "") env[CONNECTION_ENV] = inputs.connection;
  if (inputs.toolsets !== undefined && inputs.toolsets !== "") {
    env[TOOLSETS_ENV] = inputs.toolsets;
  }
  return { command: inputs.deno, args, env };
}
