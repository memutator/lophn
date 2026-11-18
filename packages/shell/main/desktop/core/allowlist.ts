// renderer가 부를 수 있는 것은 contract schema의 read·command와 아래 memory route 몇 개, 프로필 이미지의 upload·file route뿐이다. credential 발급·daemon 종료는 route가
// 아니라 control socket 요청이라 이 목록에 없다.
import { SHELL_ROUTES } from "./routes.ts";

// renderer가 부르는 memory route.
// - MCP server 로그인의 시작·완료·상태 읽기·취소(Settings › Tools and skills의 [Sign in]·[Cancel sign-in])
// - 설정 읽기·바꾸기, secret 상태 읽기·지우기, 진단 상태 읽기(Settings). secret 값 넣기(`secrets/put`)는 upload라
//   main의 secret 입력 창만 부른다.
// - 앱 OAuth 로그인의 client id 넣기·시작·취소·sign out·상태 읽기(앱 공간 Access 탭 secret 줄). client secret 값은 보호 입력 창이 받는다.
// - Grants의 MCP tool 목록 읽기(`agent-mcp-tools/list`). 같은 resource의 `take`·`done`은 runtime만 부른다.
// - 대기 목록의 turn request 결정(`turn_requests/decide`)과 질문 읽기·답(`ask/read`·`ask/answer`)
// - 대화 조작(`acp/send`). 보내기, 멈춤, 다시 하기, 질문 답, 허락 결정, queue 고치기를 core가 지금 route로 나눈다.
// - workflow 목록 읽기와 시작·멈춤(Workflows 탭과 sidebar). 보고(`report`)와 고치기(`edit`)는 agent가 부르므로 renderer는 부르지 않는다.
// - 앱 tray 값 읽기(`app_tray/list`. 작업 표시줄 tray). `app_tray/set`은 앱 process만 부른다.
// - 내 기기 명단 읽기·초대장 내기·초대장으로 들기·빼기·터미널 입력·이름 바꾸기(`roster/*`. Settings › Remote). `machines/*`는 shell main만 부른다.
// - 이 컴퓨터의 이름 읽기·바꾸기(`machine/status`·`machine/rename`. Settings › Remote)
// - 이 컴퓨터를 로그인 때 띄우고 계속 돌리는 표시 읽기·바꾸기(`always_on/status`·`always_on/set`. Settings › Remote의 Keep running)
// - 못 본 turn 끝 읽기와 지우기(`unseen/list`·`unseen/dismiss`. 탭의 finished 점과 알림 panel의 Finished 줄). presence 보고와
//   터미널 signal은 shell main만 부른다.
// - project id file 상태와 만들기·나누기, 등록 전 폴더 읽기(`projects/identity`·`create_identity`·`renew_identity`·`match`). project 등록 dialog와 상세
// 다른 memory route는 main의 고정 통로만 부른다.
const RENDERER_MEMORY_ROUTES: readonly string[] = [
  "memory:agent-mcp-auth/begin",
  "memory:agent-mcp-auth/complete",
  "memory:agent-mcp-auth/state",
  "memory:agent-mcp-auth/cancel",
  "memory:agent-mcp-tools/list",
  "memory:apps/oauth_client_set",
  "memory:apps/oauth_begin",
  "memory:apps/oauth_cancel",
  "memory:apps/oauth_sign_out",
  "memory:apps/oauth_state",
  "memory:apps/update_state",
  "memory:extension_tools/catalog",
  "memory:settings/list",
  "memory:settings/update",
  "memory:secrets/status",
  "memory:secrets/delete",
  // logins/release는 shell capability를 싣는 shell main 전용이라 넣지 않는다.
  "memory:logins/list",
  "memory:logins/save",
  "memory:logins/delete",
  // agent의 입력 요청 card가 읽고 Cancel하고, sign_in 요청의 로그인 결과를 알린다(done). hold는 once 값을 싣는 shell main 전용이다.
  "memory:input_request/read",
  "memory:input_request/cancel",
  "memory:input_request/done",
  "memory:diagnostics/status",
  "memory:turn_requests/decide",
  "memory:ask/read",
  "memory:ask/answer",
  "memory:acp/send",
  "memory:workflows/list",
  "memory:workflows/start",
  "memory:workflows/stop",
  "memory:app_tray/list",
  "memory:roster/list",
  "memory:roster/invite",
  "memory:roster/join",
  "memory:roster/remove",
  "memory:roster/set_terminal_input",
  "memory:roster/rename",
  "memory:machine/status",
  "memory:machine/rename",
  "memory:always_on/status",
  "memory:always_on/set",
  "memory:unseen/list",
  "memory:unseen/dismiss",
  "memory:projects/identity",
  "memory:projects/create_identity",
  "memory:projects/renew_identity",
  "memory:projects/match",
];

// renderer가 byte를 주고받는 route. 사람이 고른 agent의 프로필 이미지와 메시지에 붙인 이미지를 올리고 읽는다.
const RENDERER_UPLOAD_ROUTES: readonly string[] = [
  "upload:profile-images/upload",
  "upload:message-images/upload",
];
const RENDERER_FILE_ROUTES: readonly string[] = [
  "file:profile-images/read",
  "file:message-images/read",
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
