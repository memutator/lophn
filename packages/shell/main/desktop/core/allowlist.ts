// renderer가 부를 수 있는 것은 contract schema의 read·command와, worker에서 조립하는
// 문서 읽기 몇 개, MCP 로그인의 memory route 둘뿐이다. credential 발급·daemon 종료는 route가 아니라 pipe 메시지라 이
// 목록에 없다.
import { ALL_ROUTES } from "../../../../protocol/mod.ts";

// 문서 읽기 화면(shell/editor)이 쓰는 worker route. outline과 본문은 core read queue를
// 막지 않으려고 worker에서 조립할 뿐 읽기다. 쓰기·준비·파일 통로 worker는 넣지 않는다.
// lophn 공간 documents 화면(shell#T19)의 검색도 같은 이유의 읽기다.
// 추적 미리보기(shell#T15)는 폴더를 scan해 포함·제외만 돌려주고 아무것도 바꾸지 않는다.
// 버전 비교(shell#T18)의 section 이력·줄 diff도 고정 판 두 개를 읽기만 한다.
// projects 화면의 export(shell#T20)는 사람이 고른 고정 판을 redaction을 거쳐 묶어 읽을 뿐
// 판·자리를 바꾸지 않는다.
// settings의 앱 export(shell#T58)는 사람이 고른 앱의 자료를 읽어 밖으로 가져가는 준비다.
// 준비 본체는 core 그래프 밖 프로세스가 하지만 아무것도 바꾸지 않는다(shell/wording#R12).
// 설치 안내(documents/versions#R17)는 네트워크 없이 읽는 worker다. 안내 화면은 없고
// 사람 token이 list·get·outline·read만 부른다.
export const READING_WORKER_ROUTES: readonly string[] = [
  "worker:outline/document",
  "worker:documents/read",
  "worker:documents/section_history",
  "worker:documents/diff",
  "worker:documents/export",
  "worker:search/query",
  "worker:projects/preview_tracking",
  "worker:apps/export",
  "worker:guides/list",
  "worker:guides/get",
  "worker:guides/outline",
  "worker:guides/read",
];

// renderer가 부르는 memory route는 MCP server 로그인의 시작·완료·상태 읽기·취소뿐이다(extensions#R16, R17).
// 사람이 Settings › Tools and skills에서 [Sign in]이나 [Cancel sign-in]을 눌러야 시작·취소하고, 줄의 상태는 core가
// 읽어 준 값을 그린다. 입력은 server 이름과 자리뿐이고 값(verifier·state·token)은 응답 어디에도 없다.
// 또 하나는 "Summarize from here"의 요약 요청과 그 상태 읽기다(revert#R15). 사람이 rewind menu에서 요약을 고르면
// 시작하고, 요약을 가져가고 끝내는 입구는 runtime(machine)만 쓴다. 다른 memory route는 main의 고정 통로만 부른다.
export const RENDERER_MEMORY_ROUTES: readonly string[] = [
  "memory:agent-mcp-auth/begin",
  "memory:agent-mcp-auth/complete",
  "memory:agent-mcp-auth/state",
  "memory:agent-mcp-auth/cancel",
  "memory:rewind/summary-request",
  "memory:rewind/summary-state",
];

/** allowlist는 이름만 기억한다. schema 검사는 client가 route 원본으로 한다. */
const ALLOWED = new Set<string>();
for (const route of ALL_ROUTES) {
  const name = `${route.kind}:${route.resource}/${route.method}`;
  if (route.kind === "worker" && READING_WORKER_ROUTES.includes(name)) {
    ALLOWED.add(name);
    continue;
  }
  if (route.kind === "memory" && RENDERER_MEMORY_ROUTES.includes(name)) {
    ALLOWED.add(name);
    continue;
  }
  if (route.kind !== "read" && route.kind !== "command") continue;
  if (route.resource === "identity" && route.method === "issue") continue;
  // 연결 생성은 renderer가 token 검증 hash를 직접 낼 수 없으므로 renderer allowlist에 없다. 연결은
  // main의 고정 연결 intent(CONNECTION_INTENT)로만 만든다(desktop#R19).
  if (
    route.resource === "coding_agent_connections" && route.method === "create"
  ) {
    continue;
  }
  ALLOWED.add(`${route.kind}:${route.resource}/${route.method}`);
}

/**
 * 고정 연결 intent가 부르는 core route(사람 credential, memory route)다. renderer는 이 이름을 부를 수 없고
 * main의 연결 모듈(desktop/coding-connection.ts)이 renderer의 고정 intent를 따로 검증한 뒤에만 부른다(desktop#R19).
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
