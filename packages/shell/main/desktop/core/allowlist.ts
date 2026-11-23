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
// - workflow 목록 읽기와 시작·멈춤·재시도(Workflows 탭과 sidebar). 보고(`report`)와 고치기(`edit`)는 agent가 부르므로 renderer는 부르지 않는다.
// - 앱 tray 값 읽기(`app_tray/list`. 작업 표시줄 tray). `app_tray/set`은 앱 process만 부른다.
// - 내 기기 명단 읽기·초대장 내기·초대장으로 들기·빼기·터미널 입력·이름 바꾸기(`roster/*`. Settings › Remote)
// - 명단의 다른 컴퓨터 이름 읽기(`machines/list`. 앱 상세의 Activity와 되돌리기 미리보기가 부른 컴퓨터를 이름으로 말한다). `machines/call`·`machines/watch`는 shell main만 부른다.
// - 이 컴퓨터의 이름 읽기·바꾸기(`machine/status`·`machine/rename`. Settings › Remote)
// - 이 컴퓨터를 로그인 때 띄우고 계속 돌리는 표시 읽기·바꾸기(`always_on/status`·`always_on/set`. Settings › Remote의 Keep running)
// - 못 본 turn 끝 읽기와 지우기(`unseen/list`·`unseen/dismiss`. 탭의 finished 점과 알림 panel의 Finished 줄). presence 보고는
//   shell main만 부른다.
// - project의 기계를 넘는 id 읽기와 등록 전 폴더 읽기(`projects/identity`·`match`), 등록(`projects/add`). project 등록 dialog와 상세
// - 터미널 탭의 열기·닫기·크기·출력 lease·탭 이름과 저장한 coding agent session의 이름(`terminals/*`). 사람의 입력(`terminals/input`)과
//   다시 시작(`restart`)은 그 창의 focus를 본 shell main이 capability를 실어 부르므로 넣지 않는다.
// - 터미널 탭의 GUI·TUI 바꾸기(`coding_sessions/switch`)
// - Recent에서 지운 coding session의 팀원 session 보관(`coding_sessions/forget`)
// - Settings › Coding agents의 다시 감지·hook 놓기·지우기와 hook 설치 물음의 답(`coding_agents/*`)
// - Agent Profile 편집기의 harness model catalog 다시 묻기(`harness_catalog/refresh`). 읽기는 read route라 아래에서 자동으로 열린다.
// - 사람이 browser 탭을 이 기계의 session에 넘기기와 창이 core에 다시 붙을 때 넘긴 탭을 다시 알리기(`tabs/hand`)
// - key 없이 이 기계의 주소로 provider 잇기, 구독 로그인 시작과 상태 읽기(`providers/connect-local`·`sign-in`·`sign-in-state`. Settings › Providers와
//   agent의 sign_in card). key로 잇기(`providers/connect-key`)는 upload라 main의 secret 입력 창만 부른다.
// - 다른 컴퓨터에서 늦게 온 mail의 보류 목록 읽기와 결정(`mail/holds`·`mail/decide_hold`. 대기 목록의 Mail from other computers)
// - 다른 컴퓨터에서 남긴 handoff note 읽기(`handoff/list`. sidebar의 project 줄 아래)
// 다른 memory route는 main의 고정 통로만 부른다.
const RENDERER_MEMORY_ROUTES: readonly string[] = [
  "memory:agent-mcp-auth/begin",
  "memory:agent-mcp-auth/complete",
  "memory:agent-mcp-auth/callback",
  "memory:agent-mcp-auth/state",
  "memory:agent-mcp-auth/cancel",
  "memory:agent-mcp-tools/list",
  "memory:apps/oauth_client_set",
  "memory:apps/oauth_begin",
  "memory:apps/oauth_callback",
  "memory:apps/oauth_cancel",
  "memory:apps/oauth_sign_out",
  "memory:apps/oauth_state",
  "memory:apps/update_state",
  "memory:settings/list",
  "memory:settings/update",
  "memory:secrets/status",
  "memory:secrets/delete",
  // logins/release는 shell capability를 싣는 shell main 전용이라 넣지 않는다.
  "memory:logins/list",
  "memory:logins/save",
  "memory:logins/delete",
  // browser profile 정의. `browser_profiles/cleared`(partition data를 지웠다)는 shell main 전용이라 넣지 않는다.
  "memory:browser_profiles/list",
  "memory:browser_profiles/save",
  "memory:browser_profiles/delete",
  // agent의 입력 요청 card가 읽고 Cancel하고, sign_in 요청의 로그인 결과를 알린다(done). hold는 once 값을 싣는 shell main 전용이다.
  "memory:input_request/read",
  "memory:input_request/cancel",
  "memory:input_request/done",
  "memory:instructions/read_global",
  "memory:instructions/write_global",
  "memory:diagnostics/status",
  "memory:turn_requests/decide",
  "memory:ask/read",
  "memory:ask/answer",
  "memory:acp/send",
  "memory:workflows/list",
  "memory:workflows/start",
  "memory:workflows/stop",
  "memory:workflows/retry",
  "memory:app_tray/list",
  "memory:roster/list",
  "memory:roster/invite",
  "memory:roster/join",
  "memory:roster/remove",
  "memory:roster/set_terminal_input",
  "memory:roster/rename",
  "memory:machines/list",
  "memory:mail/holds",
  "memory:mail/decide_hold",
  "memory:handoff/list",
  "memory:machine/status",
  "memory:machine/rename",
  "memory:always_on/status",
  "memory:always_on/set",
  "memory:unseen/list",
  "memory:unseen/dismiss",
  "memory:projects/identity",
  "memory:projects/match",
  "memory:terminals/open",
  "memory:terminals/close",
  "memory:terminals/resize",
  "memory:terminals/watch",
  "memory:terminals/name",
  "memory:terminals/rename_saved",
  "memory:coding_sessions/forget",
  "memory:coding_sessions/switch",
  "memory:coding_agents/refresh",
  "memory:coding_agents/install_hooks",
  "memory:coding_agents/uninstall_hooks",
  "memory:harness_catalog/refresh",
  "memory:tabs/hand",
  "memory:projects/add",
  "memory:providers/connect-local",
  "memory:providers/sign-in",
  "memory:providers/sign-in-state",
  "memory:providers/sign-in-callback",
];

// renderer가 byte를 주고받는 route. 사람이 고른 agent의 프로필 이미지와 메시지에 붙인 이미지, 터미널 탭 GUI에 붙인 이미지를 올리고 읽는다.
const RENDERER_UPLOAD_ROUTES: readonly string[] = [
  "upload:avatar-images/upload",
  "upload:message-images/upload",
  "upload:acp/image_upload",
];
const RENDERER_FILE_ROUTES: readonly string[] = [
  "file:avatar-images/read",
  "file:message-images/read",
  "file:acp/image_read",
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
