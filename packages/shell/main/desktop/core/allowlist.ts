// renderer가 부를 수 있는 것은 contract schema의 read·command와 아래 memory route 몇 개, 프로필 이미지의 upload·file route뿐이다. credential 발급·daemon 종료는 route가
// 아니라 pipe 메시지라 이 목록에 없다.
import { SHELL_ROUTES } from "./routes.ts";

// renderer가 부르는 memory route.
// - MCP server 로그인의 시작·완료·상태 읽기·취소(Settings › Tools and skills의 [Sign in]·[Cancel sign-in])
// - 설정 읽기·바꾸기, secret 상태 읽기·지우기, 진단 상태 읽기(Settings). secret 값 넣기(`secrets/put`)는 upload라
//   main의 secret 입력 창만 부른다.
// - Grants의 MCP tool 목록 읽기(`agent-mcp-tools/list`). 같은 resource의 `take`·`done`은 runtime만 부른다.
// - 대기 목록의 허락 결정(`approvals/decide_turn`)과 질문 읽기·답(`ask/read`·`ask/answer`)
// - 대화 입력함의 지금 보내기·빼기(`session_inputs/steer_now`·`remove`)
// - Settings의 coding agent harness 목록(`coding_agent_harnesses/list`). 감지 보고(`report`)와 터미널 결과·종료
//   알림(`coding_agent_terminals/*`)은 main이 자기 신원으로 보내므로 renderer는 부르지 않는다.
// 다른 memory route는 main의 고정 통로만 부른다.
const RENDERER_MEMORY_ROUTES: readonly string[] = [
  "memory:agent-mcp-auth/begin",
  "memory:agent-mcp-auth/complete",
  "memory:agent-mcp-auth/state",
  "memory:agent-mcp-auth/cancel",
  "memory:agent-mcp-tools/list",
  "memory:settings/list",
  "memory:settings/update",
  "memory:secrets/status",
  "memory:secrets/delete",
  "memory:diagnostics/status",
  "memory:approvals/decide_turn",
  "memory:ask/read",
  "memory:ask/answer",
  "memory:session_inputs/steer_now",
  "memory:session_inputs/remove",
  "memory:coding_agent_harnesses/list",
];

// renderer가 byte를 주고받는 route. 사람이 고른 agent의 프로필 이미지를 올리고 읽는다.
const RENDERER_UPLOAD_ROUTES: readonly string[] = [
  "upload:profile-images/upload",
];
const RENDERER_FILE_ROUTES: readonly string[] = [
  "file:profile-images/read",
];

/** allowlist는 이름만 기억한다. schema 검사는 client가 route 원본으로 한다. */
const ALLOWED = new Set<string>();
for (const route of SHELL_ROUTES) {
  const name = `${route.kind}:${route.resource}/${route.method}`;
  if (route.kind === "memory" && RENDERER_MEMORY_ROUTES.includes(name)) {
    ALLOWED.add(name);
    continue;
  }
  if (
    (route.kind === "upload" && RENDERER_UPLOAD_ROUTES.includes(name)) ||
    (route.kind === "file" && RENDERER_FILE_ROUTES.includes(name))
  ) {
    ALLOWED.add(name);
    continue;
  }
  if (route.kind !== "read" && route.kind !== "command") continue;
  if (route.resource === "identity" && route.method === "issue") continue;
  ALLOWED.add(`${route.kind}:${route.resource}/${route.method}`);
}

export function lookupCall(
  kind: string,
  resource: string,
  method: string,
): string | undefined {
  const key = `${kind}:${resource}/${method}`;
  return ALLOWED.has(key) ? key : undefined;
}

export function isAllowed(
  kind: string,
  resource: string,
  method: string,
): boolean {
  return ALLOWED.has(`${kind}:${resource}/${method}`);
}
