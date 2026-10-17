// wireframes gallery의 page 목록.
//
// page 하나를 더하는 법:
//   1. 이 목록에 항목 하나를 더한다(id, part, title, badges, description, screen).
//   2. `ScreenId`에 screen 이름을 더하고 `frames/screens.tsx`의 SCREENS에 그 화면을 그리는
//      component를 더한다. 새 설계(part "new")는 `frames/compositions/`에 `@lophn/ui`
//      component와 고정 데이터만으로 짠 정적 구성을 둔다. 빠뜨리면 deno check가 잡는다.
//
// 버린 화면은 이 목록에 올리지 않는다: Settings › Backup, project
// Export panel, lophn 공간 Documents 화면, Contexts(Focus) 화면, context Materials의
// Baseline·Reference·Follow-changes 묶음.

type PartId = "design" | "now" | "new";

interface Part {
  readonly id: PartId;
  readonly title: string;
  readonly summary: string;
}

export const PARTS: readonly Part[] = [
  {
    id: "design",
    title: "디자인 시스템",
    summary:
      "@lophn/ui의 token과 component, 앱이 import하는 SDK(@lophn/ui-*)의 공개 예제를 있는 그대로 그린다. frame 없이 본문에 바로 그리고, 위쪽 Light·Dark 선택을 따른다.",
  },
  {
    id: "now",
    title: "지금 화면",
    summary:
      "main의 실제 renderer 화면을 mock 데이터로 그린다. 앱 코드 그대로라서 main이 바뀌면 다시 build하면 따라 바뀐다.",
  },
  {
    id: "new",
    title: "새 설계",
    summary:
      "구현 전에 사람이 확인할 새 설계 wireframe. @lophn/ui component와 고정 데이터만으로 짠 정적 구성이다.",
  },
];

const BADGE_DESIGN = "디자인 시스템";
const BADGE_NOW = "구현됨 · 진짜 화면";
const BADGE_NEW = "새 설계";

export type ScreenId =
  | "tokens-colors"
  | "tokens-type"
  | "tokens-space"
  | "tokens-icons"
  | "components-buttons"
  | "components-forms"
  | "components-navigation"
  | "components-table"
  | "components-menus"
  | "components-dialogs"
  | "components-toast"
  | "components-states"
  | "components-cards"
  | "components-frames"
  | "sdk-tokens"
  | "sdk-layout"
  | "sdk-table"
  | "sdk-actions"
  | "sdk-controls"
  | "sdk-filters"
  | "sdk-states"
  | "sdk-reading"
  | "sdk-overlays"
  | "sdk-stats"
  | "sdk-charts"
  | "launcher-empty"
  | "launcher-projects"
  | "launcher-start-failed"
  | "launcher-sandbox-failed"
  | "launcher-schema-failed"
  | "lophn-projects"
  | "lophn-apps"
  | "settings-coding"
  | "settings-general"
  | "settings-diagnostics"
  | "project-document"
  | "project-terminal"
  | "app-space"
  | "new-waiting-list"
  | "new-waiting-permission"
  | "new-waiting-deny-reason"
  | "new-waiting-activation"
  | "new-waiting-first-activation"
  | "new-waiting-reaction"
  | "new-waiting-settled"
  | "new-waiting-toasts"
  | "new-secret-input"
  | "new-secret-input-app"
  | "new-secret-input-mcp"
  | "new-agent-conversation"
  | "new-agent-queued-message"
  | "new-agent-sender-chips"
  | "new-agent-call-open"
  | "new-agent-call-replies"
  | "new-agent-question"
  | "new-agent-question-answered"
  | "new-agent-question-ended"
  | "new-agent-approval"
  | "new-agent-approval-deny"
  | "new-agent-approval-settings"
  | "new-agent-approval-states"
  | "new-agent-commands"
  | "new-agent-commands-filtered"
  | "new-agent-recap"
  | "new-agent-permissions"
  | "new-agent-model-picker"
  | "new-agent-request-error"
  | "new-agent-rewind"
  | "new-agent-sessions"
  | "new-agent-sessions-edit"
  | "new-agent-session-archived"
  | "new-explorer-root"
  | "new-sidebar-context"
  | "new-agent-sidebar"
  | "new-sidebar-collapsed"
  | "new-tab-kinds"
  | "new-tab-menu"
  | "new-organize"
  | "new-file-delete"
  | "new-instructions-file"
  | "new-file-open-path"
  | "new-file-outside"
  | "new-document-tab"
  | "new-document-editing"
  | "new-document-tab-info"
  | "new-document-tab-contexts"
  | "new-viewer-text"
  | "new-viewer-media"
  | "new-file-reloaded"
  | "new-file-conflict"
  | "new-file-conflict-compare"
  | "new-file-search"
  | "new-file-search-folder"
  | "new-file-search-opened"
  | "new-search-table"
  | "new-search-board"
  | "new-contexts"
  | "new-contexts-archived"
  | "new-context-overview"
  | "new-context-versions"
  | "new-context-restored"
  | "new-context-searches"
  | "new-context-violations"
  | "new-context-glossary"
  | "new-context-glossary-add"
  | "new-context-glossary-edit"
  | "new-context-glossary-delete"
  | "new-context-contract"
  | "new-ways-to-open"
  | "new-agent-toast-opened"
  | "new-violation-session-open"
  | "new-project-agents"
  | "new-operator-editor"
  | "new-operator-create"
  | "new-agent-editor-app-engineer"
  | "new-agent-mcp-server-form"
  | "new-agent-grants"
  | "new-agent-grants-app"
  | "new-app-space"
  | "new-app-agent-pane"
  | "new-app-version-applied"
  | "new-app-version-applying"
  | "new-app-version-failed"
  | "new-app-access"
  | "new-app-access-revoking"
  | "new-app-activity"
  | "new-app-rewind-confirm"
  | "new-app-rewind-running"
  | "new-app-rewind-done"
  | "new-app-rewind-conflict"
  | "new-app-issues"
  | "new-app-issue-detail"
  | "new-app-report"
  | "new-app-report-existing"
  | "new-app-annotate"
  | "new-app-annotate-list"
  | "new-app-project-picker"
  | "new-app-coding-toast"
  | "new-app-coding-terminal"
  | "new-app-coding-permission"
  | "new-app-coding-ended"
  | "new-workspace"
  | "new-workspace-folder-missing"
  | "new-workspace-subfolder-add"
  | "new-workspace-subfolder-edit"
  | "new-workspace-apps"
  | "new-settings-general"
  | "new-settings-required-empty"
  | "new-settings-appearance"
  | "new-settings-providers"
  | "new-settings-connect"
  | "new-settings-agents"
  | "new-settings-lophn"
  | "new-settings-tools"
  | "new-settings-coding"
  | "new-settings-reactions"
  | "new-settings-diagnostics"
  | "new-launcher-projects"
  | "new-launcher-empty"
  | "new-launcher-register"
  | "new-start-failure";

export interface WireframePage {
  /** 주소 `#/<id>`와 frame의 `?frame=<id>`에 쓴다. */
  readonly id: string;
  readonly part: PartId;
  /** 화면 이름. 영어로 쓴다. */
  readonly title: string;
  /** 첫 badge는 part를 말한다. 나머지는 이 화면이 속한 flow다. */
  readonly badges: readonly string[];
  /** 한두 문장. 한국어로 쓴다. */
  readonly description: string;
  readonly screen: ScreenId;
}

function design(
  id: string,
  title: string,
  description: string,
  screen: ScreenId,
): WireframePage {
  return {
    id,
    part: "design",
    title,
    badges: [BADGE_DESIGN],
    description,
    screen,
  };
}

function now(
  id: string,
  title: string,
  flows: readonly string[],
  description: string,
  screen: ScreenId,
): WireframePage {
  return {
    id,
    part: "now",
    title,
    badges: [BADGE_NOW, ...flows.map((flow) => `flow: ${flow}`)],
    description,
    screen,
  };
}

function fresh(
  id: string,
  title: string,
  description: string,
  screen: ScreenId,
): WireframePage {
  return { id, part: "new", title, badges: [BADGE_NEW], description, screen };
}

export const PAGES: readonly WireframePage[] = [
  design(
    "tokens-colors",
    "Tokens · colors",
    "packages/design의 색 token 전부를 이름과 값이 있는 견본으로 보인다. 모든 견본은 light와 dark 값을 나란히 놓아 위쪽 테마 선택과 상관없이 둘이 한눈에 비교된다.",
    "tokens-colors",
  ),
  design(
    "tokens-type",
    "Tokens · type",
    "글자 크기·줄 높이·굵기·자간과 sans·mono 글꼴을 영어와 한국어 견본 문장으로 보인다.",
    "tokens-type",
  ),
  design(
    "tokens-space",
    "Tokens · space & layout",
    "간격·모서리·테두리·그림자·z-index와 페이지 틀·sidebar·dialog 같은 폭 token을 막대와 상자로 보인다. 폭은 가장 긴 1440px 기준의 비율이다.",
    "tokens-space",
  ),
  design(
    "tokens-icons",
    "Tokens · icons",
    "packages/design/components의 아이콘 묶음(*-icons.ts) 전부를 이름과 함께 격자로 보인다. 모두 선 1.5의 Lucide 한 벌이다.",
    "tokens-icons",
  ),
  design(
    "components-buttons",
    "Components · buttons",
    "Button의 variant·크기·아이콘·비활성, IconButton, Kbd, CopyButton을 실제 component로 보인다.",
    "components-buttons",
  ),
  design(
    "components-forms",
    "Components · form controls",
    "Field로 감싼 Input·Textarea·Select와 Checkbox·Switch를 기본·도움말·오류·비활성 상태로 보인다.",
    "components-forms",
  ),
  design(
    "components-navigation",
    "Components · tabs, tree & list",
    "일반 Tabs, 폴더 Tree, 이름과 메타가 있는 List를 선택된 상태와 함께 보인다.",
    "components-navigation",
  ),
  design(
    "components-table",
    "Components · table",
    "text·number·time·id 열이 있는 Table을 compact와 comfortable 밀도로 보이고, 값이 없는 칸의 모양도 보인다.",
    "components-table",
  ),
  design(
    "components-menus",
    "Components · menu, popover & tooltip",
    "Menu·Popover·Tooltip을 열어 둔 채로 보인다. 아래 상자 안에 portal로 그려 page 안에 머문다.",
    "components-menus",
  ),
  design(
    "components-dialogs",
    "Components · dialog, sheet & palette",
    "Dialog·Sheet·Palette를 열어 둔 채로 보인다. 각 상자가 viewport 역할을 해서 backdrop과 위치가 상자 안에 그려진다.",
    "components-dialogs",
  ),
  design(
    "components-toast",
    "Components · toast",
    "Toast의 neutral·error와 행동 0~2개 변형을 시간이 가지 않는 timer로 고정해 보인다.",
    "components-toast",
  ),
  design(
    "components-states",
    "Components · states",
    "비었음·불러오기 실패·Skeleton·오래된 값(StaleNote)·StatusMark·DiffMark 같은 상태 표시를 보인다.",
    "components-states",
  ),
  design(
    "components-cards",
    "Components · card & stat tile",
    "독립 객체 하나를 묶는 Card와 수치 타일(StatTile·StatRow)을 증가·감소·변화 없음·단위 있는 값으로 보인다.",
    "components-cards",
  ),
  design(
    "components-frames",
    "Components · page frames",
    "페이지 틀(Form·Dashboard·ListDetail·Table·Reading)을 칸 폭 안에서 그대로 보인다. 틀 안은 이름만 적은 상자다.",
    "components-frames",
  ),
  design(
    "sdk-tokens",
    "SDK · tokens",
    "@lophn/tokens 예제. 앱이 token 이름과 차트 색을 가져다 쓰는 법을 보인다(예제 chart-colors).",
    "sdk-tokens",
  ),
  design(
    "sdk-layout",
    "SDK · layout",
    "@lophn/ui-layout 예제(orders-app). 앱 shell·sidebar·tab·grid·card와 다섯 가지 페이지 틀을 연다.",
    "sdk-layout",
  ),
  design(
    "sdk-table",
    "SDK · table",
    "@lophn/ui-table 예제(orders-table). 금액으로 정렬하고 25행씩 나누어 본다.",
    "sdk-table",
  ),
  design(
    "sdk-actions",
    "SDK · actions",
    "@lophn/ui-action 예제(order-actions). blueprint command를 버튼으로 두고 누르면 확인 없이 바로 호출한다. 앱 bridge가 없어 눌러도 실패 문구가 나온다.",
    "sdk-actions",
  ),
  design(
    "sdk-controls",
    "SDK · controls",
    "@lophn/ui-control 예제(control-sizes). sm·md·lg 높이의 Button·Input·Select를 같은 줄에 맞춘다.",
    "sdk-controls",
  ),
  design(
    "sdk-filters",
    "SDK · filters",
    "@lophn/ui-filter 예제(orders-filters). 기간·상태·검색으로 read command의 입력을 만든다.",
    "sdk-filters",
  ),
  design(
    "sdk-states",
    "SDK · states",
    "@lophn/ui-state 예제(orders-status). 읽기 결과의 loading·empty·error·freshness를 보인다. 한 화면에 네 상태를 나란히 놓았다.",
    "sdk-states",
  ),
  design(
    "sdk-reading",
    "SDK · reading",
    "@lophn/ui-reading 예제(weekly-report). 목차와 문서 주소가 있는 읽기 틀로 주간 보고서를 그린다.",
    "sdk-reading",
  ),
  design(
    "sdk-overlays",
    "SDK · overlays",
    "@lophn/ui-overlay 예제(overlays). tooltip·popover·menu·dialog·toast를 여는 단추들이다. 눌러 열어 볼 수 있다.",
    "sdk-overlays",
  ),
  design(
    "sdk-stats",
    "SDK · stats",
    "@lophn/ui-stat 예제(orders-summary). 이번 기간과 지난 기간 값으로 수치와 변화량을 보인다.",
    "sdk-stats",
  ),
  design(
    "sdk-charts",
    "SDK · charts",
    "@lophn/ui-chart 예제(sales-dashboard). 시계열·막대·누적 막대·분포·산점·node-edge 여섯 차트를 보인다.",
    "sdk-charts",
  ),
  now(
    "launcher-empty",
    "Launcher · empty",
    ["first-project", "install-lophn"],
    "처음 여는 런처. 프로젝트 카드가 없어 비었음 안내만 보인다. first-project 흐름의 1단계(아직 프로젝트 없음)이고, install-lophn은 설치 뒤 처음 여는 자리다.",
    "launcher-empty",
  ),
  now(
    "launcher-projects",
    "Launcher · with projects",
    ["first-project"],
    "프로젝트 카드가 있는 런처. 카드는 이름·목적·문서 수·추적 상태를 보이고, 카드를 누르면 그 프로젝트 작업대로 간다.",
    "launcher-projects",
  ),
  now(
    "launcher-start-failed",
    "Start failure · start",
    ["install-lophn"],
    "core가 시작하지 못했을 때 런처 자리에 뜨는 화면. 일반 런처 모양 없이 실패 종류와 다음 행동 하나만 보인다.",
    "launcher-start-failed",
  ),
  now(
    "launcher-sandbox-failed",
    "Start failure · sandbox",
    ["install-lophn"],
    "sandbox를 세우지 못했을 때의 시작 실패 화면. start failure와 구별되는 종류 이름과 다음 행동 하나를 보인다.",
    "launcher-sandbox-failed",
  ),
  now(
    "launcher-schema-failed",
    "Start failure · schema",
    ["install-lophn"],
    "core와 shell의 schema 판이 맞지 않을 때의 시작 실패 화면. 업데이트 확인이 다음 행동이다.",
    "launcher-schema-failed",
  ),
  now(
    "lophn-projects",
    "Lophn Workspace · Projects",
    ["organize-documents"],
    "lophn 공간의 Projects. 등록한 프로젝트를 목록으로 보고, 고르면 이름·보관·폴더 같은 정리를 상세에서 한다.",
    "lophn-projects",
  ),
  now(
    "lophn-apps",
    "Lophn Workspace · Apps",
    ["connect-apps", "new-app"],
    "lophn 공간의 Apps. 설치한 앱의 상태와 열기, 앱 공간으로 가는 길이 한 목록에 있다.",
    "lophn-apps",
  ),
  now(
    "settings-coding",
    "Settings · Coding agents",
    ["connect-coding-agent", "manage-coding-access"],
    "Settings의 Coding agents 탭. 감지한 coding agent와 연결을 보고 회수한다.",
    "settings-coding",
  ),
  now(
    "settings-general",
    "Settings · General",
    ["edit-instructions"],
    "Settings의 General 탭. 기본 model과 읽기 설정, 전역 Instructions 편집기로 가는 길.",
    "settings-general",
  ),
  now(
    "settings-diagnostics",
    "Settings · Diagnostics",
    [],
    "Settings의 Diagnostics 탭. 보안 상태 점검과 doctor 결과를 영향 한 문장과 다음 행동으로 보인다.",
    "settings-diagnostics",
  ),
  now(
    "project-document",
    "Project workspace · document tab",
    ["project-workspace", "edit-document"],
    "프로젝트 작업대의 문서 탭. 왼쪽 sidebar에서 문서를 고르고 읽기·편집을 같은 기둥에서 한다.",
    "project-document",
  ),
  now(
    "project-terminal",
    "Project workspace · terminal tab",
    ["project-workspace", "start-coding-agent"],
    "프로젝트 작업대의 terminal 탭. 문서 옆 칸에 같은 폴더의 shell이 열린다. 여기 출력은 PTY 없이 gallery의 가짜 통로가 준 것이다.",
    "project-terminal",
  ),
  now(
    "app-space",
    "App space",
    ["connect-apps", "report-app-problem"],
    "앱 공간. 상단 바에 앱 이름과 [Report a problem], 본문에 앱 view, 운영 탭(Issues 등). 앱 view는 안내 상자로 그린다.",
    "app-space",
  ),
  fresh(
    "new-waiting-list",
    "Waiting · list",
    "창 위 pill(5 waiting)을 펼친 대기 목록이다. 모든 session의 권한 요청, 질문, 승인이 세 묶음으로 나뉘고 항목마다 agent, session, 앱이나 project가 보인다. 세부는 접혀 있어 제목, 한 줄 설명, 단추만 보이고 단추는 카드 오른쪽 끝에 모인다. coding agent 항목은 harness 아이콘과 [Answer in terminal]만 있다.",
    "new-waiting-list",
  ),
  fresh(
    "new-waiting-permission",
    "Waiting · permission requests",
    "권한 요청 셋의 세부를 펼친 상태다. 대상, 정규화한 입력, 효과가 program 문구로만 보인다. app-api와 MCP tool은 선택지 넷이고 설정 고치기는 Allow와 Deny다.",
    "new-waiting-permission",
  ),
  fresh(
    "new-waiting-deny-reason",
    "Waiting · deny with reason",
    "Deny를 누르면 이유 칸이 열린다. 비워도 되고, 적으면 요청한 agent의 tool 결과로 간다.",
    "new-waiting-deny-reason",
  ),
  fresh(
    "new-waiting-activation",
    "Waiting · activation approval",
    "activation 허락 카드의 세부를 펼친 상태다. 이전 release보다 늘어난 선언(network host, secret, 파일, 다른 앱 app-api 쓰기)과 손실 단계(표 지움, 칸 지움, type 좁힘)만 보인다.",
    "new-waiting-activation",
  ),
  fresh(
    "new-waiting-first-activation",
    "Waiting · first activation",
    "첫 activation의 세부를 펼친 상태다. 선언 전부가 늘어난 것이고 손실 단계는 없다.",
    "new-waiting-first-activation",
  ),
  fresh(
    "new-waiting-reaction",
    "Waiting · reaction approval",
    "물음으로 둔 reaction의 세부를 펼친 상태다. 어떤 domain event로 어떤 agent의 session을 열지 보이고 Allow와 Deny만 있다.",
    "new-waiting-reaction",
  ),
  fresh(
    "new-waiting-settled",
    "Waiting · just settled",
    "결정한 뒤 목록에 잠깐 남는 줄이다. 허락 접수(applying)와 적용 성공(applied)을 나누고, 거절과 cancelled(원래 일이 끝남)를 나눈다.",
    "new-waiting-settled",
  ),
  fresh(
    "new-waiting-toasts",
    "Waiting · toasts",
    "창 오른쪽 아래에 쌓인 toast 넷(권한 요청, 허락 요청, 질문, App restart halted)이다. layout을 차지하지 않고 단추([Review], [Open session])는 오른쪽 끝에 있다.",
    "new-waiting-toasts",
  ),
  fresh(
    "new-secret-input",
    "Secret input · provider key",
    "shell이 띄우는 작은 secret 보호 입력 창이다. 값은 점으로만 보이고, 저장하면 이름과 설정 여부만 남는다. 빈 칸이면 Save가 꺼져 있다.",
    "new-secret-input",
  ),
  fresh(
    "new-secret-input-app",
    "Secret input · app secret",
    "이미 설정된 앱 secret의 값을 바꾸는 상태다. 저장하면 값이 바뀐다는 안내가 있다.",
    "new-secret-input-app",
  ),
  fresh(
    "new-secret-input-mcp",
    "Secret input · MCP credential",
    "MCP server credential을 받는 같은 보호 입력 창이다.",
    "new-secret-input-mcp",
  ),
  fresh(
    "new-agent-conversation",
    "Agent · tab",
    "일하는 중인 Agent 탭이다. 도는 turn에 steer로 들어간 메시지에 steer 표시가 붙고, 시각 블록은 앱 카드뿐이다. 일하는 중 composer에는 Stop과 Send만 있고, 입력칸 아래에 권한 요약 한 줄이 있다.",
    "new-agent-conversation",
  ),
  fresh(
    "new-agent-queued-message",
    "Agent · queued message",
    "일하는 중에 보낸 메시지가 composer 위 Next turn 줄로 쌓인 모습이다. 줄 오른쪽 끝의 [Send now]를 누르면 도는 turn에 steer로 들어가고 steer 표시가 붙는다. 보내기 방식을 고르는 menu는 없다.",
    "new-agent-queued-message",
  ),
  fresh(
    "new-agent-sender-chips",
    "Agent · sender chips",
    "받은 메시지에 보낸 쪽 chip이 붙는다(program의 reaction, 다른 agent, coding agent). coding agent chip에는 harness 아이콘이 있다. chip을 누르면 맡긴 글, 근거 링크, 보낸 session 링크가 든 panel이 열린다.",
    "new-agent-sender-chips",
  ),
  fresh(
    "new-agent-call-open",
    "Agent · handed-over task",
    "다른 agent에게 맡긴 일의 블록이다. 받는 곳, 맡긴 글 한 줄, 답 방식이 보이고 누르면 그때의 상태를 읽는다. 끝나지 않은 일에는 [Cancel]이 있다. 상태가 바뀌어도 따로 알리지 않는다.",
    "new-agent-call-open",
  ),
  fresh(
    "new-agent-call-replies",
    "Agent · replies to a handed-over task",
    "답과 실패가 블록 안이 아니라 그 일에 이어진 새 메시지로 보인다. 답이 온 경우와 받은 session이 답 없이 끝나 실패한 경우다.",
    "new-agent-call-replies",
  ),
  fresh(
    "new-agent-question",
    "Agent · question card",
    "composer 위 질문 카드다. 질문은 한 번에 하나만 보이고 ‹ 1 of 2 ›로 넘긴다. 질문마다 header, 선택지 2~4개(label과 description), multiSelect, 늘 붙는 Other가 있다. 단추는 오른쪽 끝이다.",
    "new-agent-question",
  ),
  fresh(
    "new-agent-question-answered",
    "Agent · question answered",
    "답을 보내면 카드가 접힌 요약으로 남고 agent의 일이 이어진다.",
    "new-agent-question-answered",
  ),
  fresh(
    "new-agent-question-ended",
    "Agent · question ended by message",
    "기다리는 중 사람이 그냥 메시지를 보내면 카드가 Ended by your message로 접히고, 고른 답이 없다고 보인다.",
    "new-agent-question-ended",
  ),
  fresh(
    "new-agent-approval",
    "Agent · approval card",
    "app-api나 MCP tool의 승인 카드다. 확인 창 없이 Allow once, Allow for this session, Always allow, Deny로 바로 결정한다. 내용은 program 문구(대상, 입력, 효과)다.",
    "new-agent-approval",
  ),
  fresh(
    "new-agent-approval-deny",
    "Agent · approval deny reason",
    "Deny를 누르면 이유 칸이 열린다. 적지 않고 보내도 된다.",
    "new-agent-approval-deny",
  ),
  fresh(
    "new-agent-approval-settings",
    "Agent · approval for settings",
    "설정 고치기(LOPHN.md 쓰기) 카드다. 선택지는 Allow와 Deny뿐이고 바뀌는 줄을 diff로 보인다.",
    "new-agent-approval-settings",
  ),
  fresh(
    "new-agent-approval-states",
    "Agent · approval results",
    "결정 뒤 대화에 남는 줄 넷이다. 허락 접수, 적용됨, 거절(이유 포함), cancelled(이 일이 끝나서 없어진 요청)를 구별한다.",
    "new-agent-approval-states",
  ),
  fresh(
    "new-agent-commands",
    "Agent · commands",
    "입력칸에 /를 친 메뉴다. 한 줄에 아이콘, 이름, 설명이 붙은 얇은 행이고 묶음은 선으로 나눈다. Recap이 있고 Permissions는 grant와 이 session의 허락을 보인다.",
    "new-agent-commands",
  ),
  fresh(
    "new-agent-commands-filtered",
    "Agent · commands filtered",
    "일하는 중 /re로 거른 메뉴다. 이름이나 설명에 맞는 것만 남고, 고른 명령은 다음 turn에 들어간다고 줄 오른쪽에 보인다.",
    "new-agent-commands-filtered",
  ),
  fresh(
    "new-agent-recap",
    "Agent · recap",
    "/recap 결과다. session을 짧게 요약해 보이고 대화 이력은 그대로 둔다.",
    "new-agent-recap",
  ),
  fresh(
    "new-agent-permissions",
    "Agent · permissions",
    "/permissions 보기다. 그 agent의 grant(대상, 효과, 묻는지)와 이 session에서 이 session 동안으로 허락한 대상을 보인다. 입력칸 아래 권한 요약을 눌러도 같은 보기가 열린다.",
    "new-agent-permissions",
  ),
  fresh(
    "new-agent-model-picker",
    "Agent · model picker",
    "composer의 model을 누르면 Favorites가 맨 위에, 그 아래 provider별 model이 provider 아이콘과 함께 나온다. option 축은 고른 model이 가진 것만 보이고 따로 붙는 안내 문구는 없다.",
    "new-agent-model-picker",
  ),
  fresh(
    "new-agent-request-error",
    "Agent · request error",
    "model을 바꾼 뒤 provider가 요청을 거절한 모습이다. 어떤 오류인지와 [Retry]가 대화 안 오류 메시지로 남는다. model을 바꿀 때 조정 안내는 없고 새 model의 기본 variant로 맞춘다.",
    "new-agent-request-error",
  ),
  fresh(
    "new-agent-rewind",
    "Agent · rewind",
    "내 메시지에서 그 시점으로 되돌리는 대화 안 panel이다. 대화와 file tool로 바꾼 파일은 기본으로 함께 되돌리고, 앱은 앱마다 고른다. write 목록, 함께 되돌아갈 다른 변경, 되돌아가지 않는 external 효과, 결과를 모르는 write를 보인다.",
    "new-agent-rewind",
  ),
  fresh(
    "new-agent-sessions",
    "Agent · session switcher",
    "agent header의 session 제목을 누르면 열리는 목록이다. Archived 줄에는 되살리기가 없고 눌러서 읽기만 한다. session 상태는 열림, archive, 지움 셋이다.",
    "new-agent-sessions",
  ),
  fresh(
    "new-agent-sessions-edit",
    "Agent · session rename and delete",
    "이름 고치기와 지움 확인이다. 지움 확인에 다른 agent가 이 session에 맡겨 두고 답을 기다리는 일이 실패한다는 영향이 적혀 있다.",
    "new-agent-sessions-edit",
  ),
  fresh(
    "new-agent-session-archived",
    "Agent · archived session",
    "archive한 session을 열면 기록만 보이고 입력칸이 없다. 머리에 Archived 표시와 안내 줄이 있다.",
    "new-agent-session-archived",
  ),
  fresh(
    "new-explorer-root",
    "Sidebar · Explorer",
    "sidebar 맨 위 밑줄 탭(Explorer, Context, Agent)에서 Explorer를 고른 모양이다. 루트는 작은 대문자 이름 한 줄 머리이고, 그 menu를 연 상태로 연결한 폴더 둘과 하위 폴더가 이름과 경로로 보인다. tree에는 차분한 파일 종류 아이콘이 붙는다.",
    "new-explorer-root",
  ),
  fresh(
    "new-sidebar-context",
    "Sidebar · Context",
    "sidebar 맨 위 밑줄 탭에서 Context를 고른 모양이다. contexts 목록과 saved views만 보이고 saved view 이름을 누르면 결과 탭이 열린다.",
    "new-sidebar-context",
  ),
  fresh(
    "new-agent-sidebar",
    "Sidebar · Agent",
    "sidebar 맨 위 밑줄 탭에서 Agent를 고른 모양이다. lophn, Project Manager, Operators마다 열린 session이 아래에 들여 쓰여 있고 맨 아래에 Recent가 있다. session을 누르면 그 탭이 열리고 묶음 머리의 Manage는 Agents 탭을 연다.",
    "new-agent-sidebar",
  ),
  fresh(
    "new-sidebar-collapsed",
    "Sidebar · collapsed",
    "접은 sidebar는 바로 가기 rail이 된다. 위에서부터 펼치기, Terminal, Contexts, Saved views, Agent, Search이고 Search는 project 키워드 검색을 연다.",
    "new-sidebar-collapsed",
  ),
  fresh(
    "new-project-tabs",
    "Project · tab kinds",
    "한 칸에 md 문서, JSON 파일, project 키워드 검색, Context, Terminal 탭이 같이 열려 있고 오른쪽 칸에 lophn Agent 탭이 있다. 탭 줄은 앱 공간 pane과 같은 component이고, 탭마다 아이콘과 이름만 있다. 파일은 파일 종류 아이콘, agent는 profile 아이콘이다.",
    "new-tab-kinds",
  ),
  fresh(
    "new-project-tab-menu",
    "Project · new tab menu",
    "탭 줄 끝의 + 메뉴를 펼친 상태다. Agent 하위 메뉴에 lophn, Project Manager, Operator가 있고 Agents(관리 탭)와 New context 항목은 없다.",
    "new-tab-menu",
  ),
  fresh(
    "new-organize",
    "Project · file actions",
    "파일 tree 행을 오른쪽 클릭한 메뉴다. Open, Rename, Delete가 있고 보관, 이동, 폴더 연결 해제는 없다.",
    "new-organize",
  ),
  fresh(
    "new-file-delete",
    "Project · delete a file",
    "파일 지우기 확인이 화면 가운데 modal로 뜬다. 파일은 디스크에서 지워진다.",
    "new-file-delete",
  ),
  fresh(
    "new-instructions-file",
    "Project · LOPHN.md as a plain file",
    "project 지침 LOPHN.md를 따로 둔 진입 없이 일반 문서 탭으로 연다.",
    "new-instructions-file",
  ),
  fresh(
    "new-file-open-path",
    "Project · open a file by path",
    "팔레트에 절대 경로를 친 상태다. 그 경로를 여는 행에 Outside project가 적혀 있고, Open file…은 OS dialog로 연다.",
    "new-file-open-path",
  ),
  fresh(
    "new-file-outside",
    "Project · file outside the project",
    "project 밖 파일을 연 문서 탭이다. view bar에는 경로 대신 Outside project 표시가 있고 경로는 위쪽 경로와 Info에 있다.",
    "new-file-outside",
  ),
  fresh(
    "new-document-tab",
    "Document · read",
    "md 문서 탭이다. 탭 key는 파일 경로이고 view bar는 한 줄로, 오른쪽에 저장 상태, Edit, Info, …가 있다. 판 번호, 판 hint, 형식 문제 표시는 없다.",
    "new-document-tab",
  ),
  fresh(
    "new-document-editing",
    "Document · editing",
    "md를 고치는 중이고 저장 상태가 Saving…이다. 저장 상태는 디스크 저장과 충돌만 있다.",
    "new-document-editing",
  ),
  fresh(
    "new-document-tab-info",
    "Document · info panel",
    "문서 탭 오른쪽에 본문 위로 떠서 열리는 정보 panel이다. 탭은 Info와 Contexts 둘이고 Info에 경로, 크기, 바뀐 시각, Outline이 있다. 본문 폭은 줄지 않는다.",
    "new-document-tab-info",
  ),
  fresh(
    "new-document-tab-contexts",
    "Document · info panel, Contexts",
    "같은 panel에서 Contexts 탭을 연 상태다. 이 문서를 다루는 context를 보인다.",
    "new-document-tab-contexts",
  ),
  fresh(
    "new-viewer-text",
    "Document · text files",
    "확장자로 viewer를 고른다. 왼쪽은 JSON, 오른쪽은 YAML text 편집기이고 줄 번호와 지금 줄 표시가 있다.",
    "new-viewer-text",
  ),
  fresh(
    "new-viewer-media",
    "Document · image and pdf",
    "이미지와 pdf viewer다. 보기만 하고, view bar는 한 줄이며 바탕이 탭 본문과 같다.",
    "new-viewer-media",
  ),
  fresh(
    "new-file-reloaded",
    "Document · changed outside, reloaded",
    "고치지 않은 파일이 밖(다른 편집기, git)에서 바뀌어 다시 읽었다는 알림이 탭 위쪽 toast로 뜬다.",
    "new-file-reloaded",
  ),
  fresh(
    "new-file-conflict",
    "Document · conflict",
    "고치는 중에 디스크의 파일이 바뀌면 탭 위쪽 toast가 알린다. Compare, Use disk version, Keep my version 단추는 오른쪽 끝에 있다.",
    "new-file-conflict",
  ),
  fresh(
    "new-file-conflict-compare",
    "Document · conflict, compare with disk",
    "디스크 쪽과 내가 고친 쪽을 나란히 보인다. 다른 줄은 +/− 기호와 배경으로 구별한다.",
    "new-file-conflict-compare",
  ),
  fresh(
    "new-file-search",
    "Search · find in files",
    "rail의 Search가 여는 project 키워드 검색이다. 검색어, 폴더 고르기, 경로 순과 줄 순의 결과, 일치한 부분이 칠해진 snippet이 있다. 취소, 건너뛴 파일 안내, 더 보기는 없다.",
    "new-file-search",
  ),
  fresh(
    "new-file-search-folder",
    "Search · narrowed to a folder",
    "폴더를 eval로 좁힌 검색이다.",
    "new-file-search-folder",
  ),
  fresh(
    "new-file-search-opened",
    "Search · result opened at its line",
    "결과를 눌러 연 뒤다. 오른쪽 문서가 일치한 줄로 scroll해 칠해져 있고 view bar에 Line 16이 보인다. 왼쪽 검색 탭은 그대로 남는다.",
    "new-file-search-opened",
  ),
  fresh(
    "new-search-table",
    "Search · declared (table)",
    "context 계약에 선언된 검색의 table 결과다. 입력 form, page 이동, 개체 링크가 있다. project 키워드 검색과는 다른 탭이다.",
    "new-search-table",
  ),
  fresh(
    "new-search-board",
    "Search · declared (board)",
    "선언된 검색의 board 결과(Experiments by status)다. 같은 탭에서 다른 검색을 고른 모양이다.",
    "new-search-board",
  ),
  fresh(
    "new-contexts",
    "Contexts · list",
    "project의 context 목록이다. 카드에 이름, 목적, 개체 종류 수, 적용된 판과 검사 결과, 위반 수, [Open]과 [Archive]가 있다. [New context]와 쓰는 Operator 수는 없다. context는 Project Manager가 대화에서 만든다.",
    "new-contexts",
  ),
  fresh(
    "new-contexts-archived",
    "Contexts · archived",
    "보관한 context 목록을 펼친 상태다. 보관한 context는 검색과 위반에서 빠진다는 한 줄과 [Unarchive]가 있다.",
    "new-contexts-archived",
  ),
  fresh(
    "new-context-overview",
    "Context · Overview",
    "Context 탭의 첫 하위 탭이다. 머리는 이름, 목적, 적용된 판과 [Versions]이고 [Ask …]와 [History]는 없다. 도메인 그림과 Composition 트리가 있다.",
    "new-context-overview",
  ),
  fresh(
    "new-context-versions",
    "Context · versions",
    "머리의 [Versions]를 펼친 상태다. 판마다 시각과 바뀐 것 한 줄이 있고, 옛 판 줄의 [Restore]로 확인 없이 되돌린다. 판 목록은 배경 없이 테두리만 있다.",
    "new-context-versions",
  ),
  fresh(
    "new-context-restored",
    "Context · version restored",
    "옛 판으로 되돌린 직후다. 탭 위쪽에 toast가 뜨고 판 목록의 Current와 머리의 판이 바뀐다.",
    "new-context-restored",
  ),
  fresh(
    "new-context-searches",
    "Context · Searches",
    "이 context에 선언된 검색과 saved view 목록이다. 누르면 Search 탭이 열린다.",
    "new-context-searches",
  ),
  fresh(
    "new-context-violations",
    "Context · Violations",
    "위반 목록이다. 줄마다 파일(눌러 열기), 어긴 규칙, [Send to Project Manager]가 있고 위에 [Send all to Project Manager]가 있다. 누르면 위반 근거가 붙은 Project Manager session이 열린다. 진행 중 표시는 없다.",
    "new-context-violations",
  ),
  fresh(
    "new-context-glossary",
    "Context · Glossary",
    "용어집 하위 탭이다. 맨 위 머리 줄에 Glossary와 용어 수, 오른쪽 끝에 [Add term]이 있다. 사람과 Project Manager 둘 다 용어를 더하고 고치고 지운다. 줄 오른쪽 끝의 [Edit]과 [Delete]는 hover했을 때만 보인다.",
    "new-context-glossary",
  ),
  fresh(
    "new-context-glossary-add",
    "Context · Glossary (add)",
    "[Add term]을 눌러 목록 맨 위에 빈 인라인 줄이 생긴 상태다. 용어와 뜻을 줄에서 바로 쓰고 Enter나 ✓로 저장, Esc나 ×로 취소한다.",
    "new-context-glossary-add",
  ),
  fresh(
    "new-context-glossary-edit",
    "Context · Glossary (edit)",
    "한 줄의 [Edit]을 눌러 그 줄이 같은 칸 배치 그대로 글자 칸이 된 상태다. ✓와 ×는 오른쪽 끝에 있다.",
    "new-context-glossary-edit",
  ),
  fresh(
    "new-context-glossary-delete",
    "Context · Glossary (delete)",
    "[Delete]를 눌러 화면 가운데에 지우기 확인 modal이 뜬 상태다.",
    "new-context-glossary-delete",
  ),
  fresh(
    "new-context-contract",
    "Context · Contract",
    "계약 세부 하위 탭이다. 개체 종류별 자료 위치와 field, 관계, 선언된 검색과 test 결과가 있다.",
    "new-context-contract",
  ),
  fresh(
    "new-ways-to-open",
    "Context · ways to open",
    "Context 탭을 여는 길 여덟을 한 장에 모았다. 길마다 try it을 누르면 그 길을 눌러 볼 수 있는 page로 간다.",
    "new-ways-to-open",
  ),
  fresh(
    "new-agent-toast-opened",
    "Violation · Project Manager session (new)",
    "reaction이 꺼져 있어 toast를 누를 때 새로 연 Project Manager session이다. 어느 파일이 어느 규칙을 어겼는지가 chip으로 붙고 입력칸은 비어 있다.",
    "new-agent-toast-opened",
  ),
  fresh(
    "new-violation-session-open",
    "Violation · Project Manager session (open)",
    "reaction이 이미 연 session으로 간 경우다. Project Manager가 위반 문서와 계약을 읽고 일하는 중이고 사람이 쓴 글은 없다.",
    "new-violation-session-open",
  ),
  fresh(
    "new-project-agents",
    "Agent settings · project Agents tab",
    "Project Manager 카드(project마다 하나), Operator 카드와 [New Operator], 같이 쓰는 지침(LOPHN.md), project 층 model 하나, 층 표시가 붙은 skill과 MCP가 있다. lophn은 이 탭에 없고 Settings › Agents에서 정한다. sidebar Agents 묶음의 Manage로 연다.",
    "new-project-agents",
  ),
  fresh(
    "new-operator-editor",
    "Agent settings · Operator",
    "사람이 만든 Operator의 설정이다. 프로필, 이름, 놓인 곳, project 지침과 이 agent 지침을 같이 보이는 블록, model, context, skill, MCP가 있다. Built-in instructions 줄과 Permissions 칸은 없고 Definition과 Grants 탭이 있다.",
    "new-operator-editor",
  ),
  fresh(
    "new-operator-create",
    "Agent settings · new Operator",
    "같은 화면에서 새 Operator를 만든다. 놓을 곳(project나 앱)을 고르고, 앱을 고르면 일할 project 폴더를 고른다. Grants 탭은 만든 뒤에 열린다.",
    "new-operator-create",
  ),
  fresh(
    "new-agent-editor-app-engineer",
    "Agent settings · App Engineer",
    "고정 role agent의 설정이다. 이름은 고정이고 놓인 곳은 앱이다. 지침 블록에 앱 source가 속한 등록 project의 LOPHN.md가 나온다.",
    "new-agent-editor-app-engineer",
  ),
  fresh(
    "new-agent-mcp-server-form",
    "Agent settings · add MCP server",
    "agent 층에서 MCP server를 더하는 form이다. 이름, 연결 방식, 실행이나 주소, 로그인 방식만 받고 key와 token은 더한 뒤 보호 입력으로 받는다.",
    "new-agent-mcp-server-form",
  ),
  fresh(
    "new-agent-grants",
    "Agent settings · grants",
    "agent에게 맡길 것 넷(앱, MCP server의 tool, 부를 수 있는 다른 agent, 설정 고치기)을 붙이고 대상마다 묻는지를 정한다. 위에 효과별 기본값(read와 write는 묻지 않음, external과 설정 고치기는 물음)이 있다.",
    "new-agent-grants",
  ),
  fresh(
    "new-agent-grants-app",
    "Agent settings · grants, app expanded",
    "앱 하나를 펼쳐 app-api마다 넣음과 뺌, 묻는지를 보인다. 뺀 것, 사람이 바꾼 것(Changed by you, Reset), 새 release가 더해 기본값으로 들어온 것이 한 표에 있다.",
    "new-agent-grants-app",
  ),
  fresh(
    "new-app-space",
    "App space · frame",
    "앱 공간이다. 탭 줄 없이 앱 화면이 title bar 아래 전체를 쓴다. title bar에 [Report a problem], [Annotate], 앱 상세 단추가 있고, 펼친 agent select에 lophn, App Engineer, Operator 둘, Manage가 있다.",
    "new-app-space",
  ),
  fresh(
    "new-app-agent-pane",
    "App space · agent pane",
    "title bar의 Agent select로 연 agent pane이다. 앱 화면 옆에 붙고, pane 안의 대화는 project 창 Agent 탭과 같은 component다.",
    "new-app-agent-pane",
  ),
  fresh(
    "new-app-version-applied",
    "App space · Version (applied)",
    "운영 패널 탭은 Version, Access, Activity, Issues 넷이다. Version 탭은 적용된 release, 늘어난 선언과 손실 단계만 보이는 what changes, 이전 release로 돌아가기를 보인다. 돌아가기는 data schema가 같은 release에만 켜지고 나머지는 이유와 함께 꺼진다.",
    "new-app-version-applied",
  ),
  fresh(
    "new-app-version-applying",
    "App space · Version (applying)",
    "사람이 시작하지 않은 activation이 도는 중이다. 접수를 닫고 도는 호출을 기다리는 단계가 보이고 그동안 돌아가기는 꺼진다.",
    "new-app-version-applying",
  ),
  fresh(
    "new-app-version-failed",
    "App space · Version (apply failed)",
    "적용 실패와 이유가 보인다. 이전 release가 그대로 활성이고 App Engineer가 이어 받는다는 안내가 있다.",
    "new-app-version-failed",
  ),
  fresh(
    "new-app-access",
    "App space · Access",
    "앱이 activation 때 허락받은 바깥 자원(network host, secret 이름, 파일)과 다른 앱 app-api를 보이고 [Revoke]로 거둔다. 예전 Connections 탭을 합쳤고 만들기 단추는 없다.",
    "new-app-access",
  ),
  fresh(
    "new-app-access-revoking",
    "App space · Access (revoking)",
    "거두기를 요청한 뒤다. 요청 접수(새 호출 막힘)와 정리(이전 process 종료 확인 뒤 다시 시작)를 두 단계로 나눠 보인다.",
    "new-app-access-revoking",
  ),
  fresh(
    "new-app-activity",
    "App space · Activity",
    "호출 기록이다. 호출자(사람 화면, agent session 링크, 다른 앱, 앱 시작), project, 효과, 대기와 되돌림됨이 보인다. 지금 release의 live write, external, 앱 시작 행에만 [Rewind from here]가 있고, 행을 펼치면 부른 쪽 session과 tool call, 입력 지문, 결과, 되돌림 기록이 있다.",
    "new-app-activity",
  ),
  fresh(
    "new-app-rewind-confirm",
    "App space · rewind panel",
    "Activity 탭 안의 rewind panel이다. 고른 호출부터 최신까지 함께 되돌아갈 목록을 보이고 external은 Won't be undone, 결과를 모르는 write는 Can't be undone으로 표시한다. 그 앱을 쓴 모두의 변경이 함께 사라진다는 안내가 있고 사람이 눌러야 시작한다.",
    "new-app-rewind-confirm",
  ),
  fresh(
    "new-app-rewind-running",
    "App space · rewind in progress",
    "접수를 닫고 도는 호출을 기다리는 중이다. 그동안 붙잡힌 호출의 안내가 있다.",
    "new-app-rewind-running",
  ),
  fresh(
    "new-app-rewind-done",
    "App space · rewind done",
    "성공 결과다. 앱이 고른 시점 직전으로 돌아갔고 열린 앱 화면이 갱신됐다. 되돌아가지 않은 external과 되돌릴 수 없던 write가 구별돼 보인다.",
    "new-app-rewind-done",
  ),
  fresh(
    "new-app-rewind-conflict",
    "App space · rewind cancelled",
    "충돌로 통째로 취소된 결과다. 아무것도 바뀌지 않았고, 이유와 붙잡았던 호출이 이어졌음이 보인다.",
    "new-app-rewind-conflict",
  ),
  fresh(
    "new-app-issues",
    "App space · Issues list",
    "상태(Open, Resolved, Ignored)와 기간으로 거르는 문제 목록이다. 한 줄은 영향 한 문장, 접수 수, 마지막 시각, 상태이고 재발한 문제에는 Recurred 표시가 붙는다.",
    "new-app-issues",
  ),
  fresh(
    "new-app-issue-detail",
    "App space · Issue detail (recurred)",
    "재발한 문제의 상세다. 이전 해결 시각과 다시 난 release, 접수 수, 처음과 마지막 시각, 발생 목록, 근거(원래 source 위치의 stack, log, release와 commit, 제보 글)가 있다. [Mark resolved]와 [Ignore]는 확인 없이 바로 바뀐다.",
    "new-app-issue-detail",
  ),
  fresh(
    "new-app-report",
    "App space · report a problem",
    "제보 dialog다. 글만 보내고 screenshot과 화면 상태는 없다. 새 문제로 보낸다.",
    "new-app-report",
  ),
  fresh(
    "new-app-report-existing",
    "App space · report to an existing problem",
    "Send it as에서 기존 문제의 또 다른 접수를 고르면 열린 문제 가운데 하나를 고르는 칸이 생긴다.",
    "new-app-report-existing",
  ),
  fresh(
    "new-app-annotate",
    "App space · annotate (picking)",
    "앱 공간 바의 [Annotate]를 켰다. 요소를 가리키면 윤곽과 이름표가 뜨고, 고른 요소에 번호와 메모 칸이 붙는다. 영역을 끄는 중인 모양도 있다.",
    "new-app-annotate",
  ),
  fresh(
    "new-app-annotate-list",
    "App space · annotations list",
    "모은 annotation 셋(요소 둘, 영역 하나)의 목록이다. 하나씩 지우거나 전부 지우고 [Send to App Engineer]로 한 번에 보낸다. 문제가 되지 않고 App Engineer session의 메시지가 된다.",
    "new-app-annotate-list",
  ),
  fresh(
    "new-app-project-picker",
    "App space · choose a project",
    "앱 place에서 연 화면이 project를 정하지 못했을 때 shell이 앱 화면 안에 띄우는 project 고르기다.",
    "new-app-project-picker",
  ),
  fresh(
    "new-app-coding-toast",
    "App space · coding tab opened",
    "App Engineer가 ticket을 맡기자 lophn이 coding 터미널을 열었다. agent 대화에 focus가 그대로 있고 pane 위쪽 toast로 알린다. pane 머리에 harness 아이콘이 붙은 터미널 탭이 생겼다.",
    "new-app-coding-toast",
  ),
  fresh(
    "new-app-coding-terminal",
    "App space · coding terminal tab",
    "pane 머리에서 바꿔 본 coding 터미널이다. harness 아이콘과 ticket이 탭 이름이고 터미널 바탕은 pane과 같다.",
    "new-app-coding-terminal",
  ),
  fresh(
    "new-app-coding-permission",
    "App space · coding permission prompt",
    "대기 목록에서 coding agent의 권한 요청을 눌러 온 장면이다. 그 터미널로 focus가 오고 물음은 TUI 안에 있다. 답은 TUI에서 한다.",
    "new-app-coding-permission",
  ),
  fresh(
    "new-app-coding-ended",
    "App space · coding session ended",
    "끝난 coding session이다. 상태 줄만 있고 다시 시작 단추는 없다. 새 맡기기는 새 터미널로 열린다.",
    "new-app-coding-ended",
  ),
  fresh(
    "new-workspace",
    "Workspace · Projects",
    "Lophn Workspace의 화면은 Projects, Apps, Settings 셋이다. Projects 상세는 이름 하나, 목적, 폴더와 폴더 설명, 보관이고, 등록 폴더 아래에 하위 폴더가 들여 써서 중첩으로 보인다(설명, [Add subfolder], [Remove]). 목록과 상세는 가운데에 놓인다.",
    "new-workspace",
  ),
  fresh(
    "new-workspace-folder-missing",
    "Workspace · folder not found",
    "등록한 폴더 하나가 사라진 상태다. 탭 위쪽 toast가 알리고, 그 폴더 줄에 Not found와 [Choose new location]이 있다.",
    "new-workspace-folder-missing",
  ),
  fresh(
    "new-workspace-subfolder-add",
    "Workspace · add subfolder",
    "등록 폴더 안의 하위 폴더를 더하는 dialog다. 폴더 고르기는 그 등록 폴더 안으로만 열리고, 이미 더한 폴더는 Added로 보인다. 고른 폴더에 설명을 달아 더한다.",
    "new-workspace-subfolder-add",
  ),
  fresh(
    "new-workspace-subfolder-edit",
    "Workspace · edit subfolders",
    "하위 폴더 설명을 고친 상태와 하위 폴더 하나를 뺀 상태다. 빼도 폴더 자체는 그대로이고 [Undo]가 있다.",
    "new-workspace-subfolder-edit",
  ),
  fresh(
    "new-workspace-apps",
    "Workspace · Apps",
    "앱 목록(실행 상태, [Open], [Archive])과 보관한 앱([Unarchive])뿐이다. 앱 등록 단추는 없고, 앱은 lophn이나 사람이 등록한다는 안내가 있다.",
    "new-workspace-apps",
  ),
  fresh(
    "new-settings-general",
    "Settings · General",
    "Settings 항목은 sidebar의 Settings 아래 묶음(General, Agents, System)으로 들어가고 항목마다 아이콘이 있다. General은 선언한 항목을 타입대로 보이고, 값을 바꾸는 칸은 줄 오른쪽 끝 고정 열에 있다. 사람이 정한 값과 기본값을 나눠 보이고, 범위를 넘은 값은 거절 이유가 보인다.",
    "new-settings-general",
  ),
  fresh(
    "new-settings-required-empty",
    "Settings · required setting empty",
    "필수 설정(기본 model)이 비었을 때다. 탭 위쪽 toast가 그 기능(lophn과 project agent)만 시작하지 않는다고 알리고 고르러 가는 길을 준다.",
    "new-settings-required-empty",
  ),
  fresh(
    "new-settings-appearance",
    "Settings · Appearance",
    "화면 모양을 정하는 Settings 항목이다. Theme(Light, Dark, System이 기본, 고르면 바로 바뀜), 글자 크기, 문서 읽기 폭, 화면 밀도가 있다. 줄마다 이름과 설명이 왼쪽, 고르는 칸이 오른쪽 끝 고정 열이다.",
    "new-settings-appearance",
  ),
  fresh(
    "new-settings-providers",
    "Settings · Providers",
    "provider마다 연결 하나다. 연결된 것은 끊고 나머지는 [+ Connect]로 연결한다. 계정 목록 같은 계정 기능은 없다.",
    "new-settings-providers",
  ),
  fresh(
    "new-settings-connect",
    "Settings · connect a provider",
    "provider 연결 창이다. API key는 이 창에서 받지 않고 보호 입력으로 받는다.",
    "new-settings-connect",
  ),
  fresh(
    "new-settings-agents",
    "Settings · Agents",
    "전역 기본 model 하나, lophn 카드(전체에 하나), 전역 지침, grant 기본값 설명이 있다. role별 기본 model과 요약용 model 줄은 없다.",
    "new-settings-agents",
  ),
  fresh(
    "new-settings-lophn",
    "Settings · Agents › lophn",
    "lophn의 설정이다. agent 설정 화면과 같고 project 지침 칸은 없다. 놓인 곳은 lophn 전체이고 Grants 탭이 있다.",
    "new-settings-lophn",
  ),
  fresh(
    "new-settings-tools",
    "Settings · Tools and skills",
    "전역 skill 켬과 끔, 전역 MCP server다. 같은 이름은 project나 agent 층이 덮는다는 안내가 있다.",
    "new-settings-tools",
  ),
  fresh(
    "new-settings-coding",
    "Settings · Coding agents",
    "제품마다 vendor 아이콘과 실행 파일, version, 로그인, turn 끝 신호 있음과 없음, 첫 prompt를 맡길 수 있는지, skill 설치 실패를 보인다. 기본 제품은 아이콘이 붙은 줄에서 고르고, [Detect again]이 있다. 연결 만들기와 회수는 없다.",
    "new-settings-coding",
  ),
  fresh(
    "new-settings-reactions",
    "Settings · Reactions",
    "새 일을 여는 domain event 다섯마다 Off, Open without asking, Ask를 고른다. 기본은 열고 묻지 않음이고, 항목마다 어느 agent의 session이 열리는지 한 줄이 있다.",
    "new-settings-reactions",
  ),
  fresh(
    "new-settings-diagnostics",
    "Settings · Diagnostics",
    "구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 점검한 시각이 있다. 사람이 [Run checks]를 누를 때만 점검한다.",
    "new-settings-diagnostics",
  ),
  fresh(
    "new-launcher-projects",
    "Launcher · project cards",
    "런처의 project 카드(이름, 목적, 폴더 수 또는 Folder not found)와 앱 카드다. 들어가는 단추의 이름이 Lophn Workspace다.",
    "new-launcher-projects",
  ),
  fresh(
    "new-launcher-empty",
    "Launcher · empty",
    "project도 앱도 없는 런처다. 다음 행동 단추의 이름이 Lophn Workspace다.",
    "new-launcher-empty",
  ),
  fresh(
    "new-launcher-register",
    "Launcher · register project",
    "project 등록 dialog다. 이름, 목적, 폴더와 폴더 설명을 받고 짧은 이름 고르기는 없다.",
    "new-launcher-register",
  ),
  fresh(
    "new-start-failure",
    "Launcher · start failure",
    "높은 schema, hash가 다른 이력, 손상 원본 세 경우를 나란히 놓았다. 셋 모두 원본을 그대로 두고 시작하지 않았다는 안내와 update 안내, [Try again]이 있다.",
    "new-start-failure",
  ),
];

export function pageById(id: string): WireframePage | undefined {
  return PAGES.find((page) => page.id === id);
}
