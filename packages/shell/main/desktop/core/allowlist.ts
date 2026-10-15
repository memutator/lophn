// renderer가 부를 수 있는 것은 contract schema의 read·command와, worker에서 조립하는 문서 읽기 몇 개,
// 아래 memory route 몇 개, 프로필 이미지의 upload·file route뿐이다. credential 발급·daemon 종료는 route가
// 아니라 pipe 메시지라 이 목록에 없다.
import { SHELL_ROUTES } from "./routes.ts";

// 문서 읽기 화면(shell/editor)이 쓰는 worker route. outline과 본문은 core read queue를
// 막지 않으려고 worker에서 조립할 뿐 읽기다. 쓰기·준비·파일 통로 worker는 넣지 않는다.
// lophn 공간 documents 화면의 검색도 같은 이유의 읽기다.
// projects 화면의 export는 사람이 고른 고정 판을 redaction을 거쳐 묶어 읽을 뿐
// 판·자리를 바꾸지 않는다.
// settings의 앱 export는 사람이 고른 앱의 자료를 읽어 밖으로 가져가는 준비다.
// 준비 본체는 core 그래프 밖 프로세스가 하지만 아무것도 바꾸지 않는다.
export const READING_WORKER_ROUTES: readonly string[] = [
  "worker:outline/document",
  "worker:documents/read",
  "worker:documents/export",
  "worker:search/query",
];

// renderer가 부르는 memory route.
// - MCP server 로그인의 시작·완료·상태 읽기·취소(Settings › Tools and skills의 [Sign in]·[Cancel sign-in])
// - 설정 읽기·바꾸기, secret 상태 읽기·지우기, 진단 상태 읽기(Settings). secret 값 넣기(`secrets/put`)는 upload라
//   main의 secret 입력 창만 부른다.
// - 대기 목록의 허락 결정(`approvals/decide_turn`)과 질문 읽기·답(`ask/read`·`ask/answer`)
// - 대화 입력함의 지금 보내기·빼기(`session_inputs/steer_now`·`remove`)
// - Settings의 coding agent harness 목록(`coding_agent_harnesses/list`). 감지 보고(`report`)와 터미널 결과·종료
//   알림(`coding_agent_terminals/*`)은 main이 자기 신원으로 보내므로 renderer는 부르지 않는다.
// 다른 memory route는 main의 고정 통로만 부른다.
export const RENDERER_MEMORY_ROUTES: readonly string[] = [
  "memory:agent-mcp-auth/begin",
  "memory:agent-mcp-auth/complete",
  "memory:agent-mcp-auth/state",
  "memory:agent-mcp-auth/cancel",
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
export const RENDERER_UPLOAD_ROUTES: readonly string[] = [
  "upload:profile-images/upload",
];
export const RENDERER_FILE_ROUTES: readonly string[] = [
  "file:profile-images/read",
];

/** allowlist는 이름만 기억한다. schema 검사는 client가 route 원본으로 한다. */
const ALLOWED = new Set<string>();
for (const route of SHELL_ROUTES) {
  const name = `${route.kind}:${route.resource}/${route.method}`;
  if (route.kind === "worker" && READING_WORKER_ROUTES.includes(name)) {
    ALLOWED.add(name);
    continue;
  }
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
  // 연결 생성은 renderer가 token 검증 hash를 직접 낼 수 없으므로 renderer allowlist에 없다. 연결은
  // main의 고정 연결 intent(CONNECTION_INTENT)로만 만든다.
  if (
    route.resource === "coding_agent_connections" && route.method === "create"
  ) {
    continue;
  }
  ALLOWED.add(`${route.kind}:${route.resource}/${route.method}`);
}

/**
 * 고정 연결 intent가 부르는 core route(사람 credential, memory route)다. renderer는 이 이름을 부를 수 없고
 * main의 연결 모듈(desktop/coding-connection.ts)이 renderer의 고정 intent를 따로 검증한 뒤에만 부른다.
 */
export const CONNECTION_INTENT = "memory:coding_agent_connections/connect";

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
