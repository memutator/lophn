// wireframes gallery의 page 목록. React와 CSS를 import하지 않아 `deno test`가 그대로 읽는다.
//
// page 하나를 더하는 법:
//   1. 이 목록에 항목 하나를 더한다(id, part, title, badges, description, screen).
//   2. `ScreenId`에 screen 이름을 더하고 `frames/screens.tsx`의 SCREENS에 그 화면을 그리는
//      component를 더한다. 새 설계(part "new")는 `frames/compositions/`에 `@lophn/design`
//      component와 고정 데이터만으로 짠 정적 구성을 둔다. 빠뜨리면 deno check가 잡는다.
//
// 버린 화면은 이 목록에 올리지 않는다(pages_test.ts가 지킨다): Settings › Backup, project
// Export panel, lophn 공간 Documents 화면, Contexts(Focus) 화면, context Materials의
// Baseline·Reference·Follow-changes 묶음.

export type PartId = "design" | "now" | "new";

export interface Part {
  readonly id: PartId;
  readonly title: string;
  readonly summary: string;
}

export const PARTS: readonly Part[] = [
  {
    id: "design",
    title: "디자인 시스템",
    summary:
      "@lophn/design의 token과 component, 앱이 import하는 SDK(@lophn/ui-*)의 공개 예제를 있는 그대로 그린다. frame 없이 본문에 바로 그리고, 위쪽 Light·Dark 선택을 따른다.",
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
      "구현 전에 사람이 확인할 새 설계 wireframe. @lophn/design component와 고정 데이터만으로 짠 정적 구성이다.",
  },
];

export const BADGE_DESIGN = "디자인 시스템";
export const BADGE_NOW = "구현됨 · 진짜 화면";
export const BADGE_NEW = "새 설계";

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
  | "lophn-things-to-confirm"
  | "lophn-roles"
  | "settings-connections"
  | "settings-coding"
  | "settings-extensions"
  | "settings-general"
  | "settings-update"
  | "settings-diagnostics"
  | "settings-notifications"
  | "project-document"
  | "project-terminal"
  | "project-app-panel"
  | "app-space"
  | "conversation-dock"
  | "new-tab-kinds"
  | "new-tab-menu"
  | "new-context-overview"
  | "new-context-contract"
  | "new-context-violations"
  | "new-violation-toast"
  | "new-search-table"
  | "new-search-board"
  | "new-search-combobox"
  | "new-workspace"
  | "new-organize"
  | "new-sidebar-collapsed"
  | "new-contexts"
  | "new-object";

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
    "Components · toast & chip",
    "Toast의 neutral·error와 행동 0~2개 변형, 기다리는 질문을 알리는 Chip을 시간이 가지 않는 timer로 고정해 보인다.",
    "components-toast",
  ),
  design(
    "components-states",
    "Components · states",
    "비었음·불러오기 실패·Skeleton·오래된 값(StaleNote)·StatusMark·DiffMark·AuthorMark 같은 상태 표시를 보인다.",
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
    "페이지 틀(Form·Launcher·Overview·Dashboard·ListDetail·Table·Reading)을 칸 폭 안에서 그대로 보인다. 틀 안은 이름만 적은 상자다.",
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
    "@lophn/ui-action 예제(order-actions). blueprint command를 버튼으로 두고 확인 표시를 선언의 confirm에 따른다. 앱 bridge가 없어 눌러도 실패 문구가 나온다.",
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
    "lophn-things-to-confirm",
    "Lophn Workspace · Things to confirm",
    ["answer-question", "approve-action"],
    "lophn 공간의 Things to confirm. agent의 질문과 approval이 한 곳에 모이고, 기다리는 것이 먼저 보인다.",
    "lophn-things-to-confirm",
  ),
  now(
    "lophn-roles",
    "Lophn Workspace · Roles",
    ["manage-operator", "set-up-operator"],
    "lophn 공간의 Roles. 역할마다 하는 일·만든 것·대화·작업 검토·Preset을 본다.",
    "lophn-roles",
  ),
  now(
    "settings-connections",
    "Settings · Connections",
    ["connect-provider", "manage-provider-accounts"],
    "Settings의 Connections 탭. provider와 계정 목록, 연결 상태와 다음 행동. key는 이 화면이 받지 않고 보호 창이 받는다.",
    "settings-connections",
  ),
  now(
    "settings-coding",
    "Settings · Coding agents",
    ["connect-coding-agent", "manage-coding-access"],
    "Settings의 Coding agents 탭. 감지한 coding agent와 연결을 보고 회수한다.",
    "settings-coding",
  ),
  now(
    "settings-extensions",
    "Settings · Extensions",
    ["add-agent-extension"],
    "Settings의 Extensions 탭. agent가 쓰는 도구와 skill 확장을 더하고 끈다.",
    "settings-extensions",
  ),
  now(
    "settings-general",
    "Settings · General",
    ["edit-instructions"],
    "Settings의 General 탭. 기본 model과 읽기 설정, 전역 Instructions 편집기로 가는 길.",
    "settings-general",
  ),
  now(
    "settings-update",
    "Settings · Update",
    ["update-lophn"],
    "Settings의 Update 탭. 새 version과 호환 여부만 안내하고, 자동 다운로드·설치·재시작은 하지 않는다.",
    "settings-update",
  ),
  now(
    "settings-diagnostics",
    "Settings · Diagnostics",
    [],
    "Settings의 Diagnostics 탭. 보안 상태 점검과 doctor 결과를 영향 한 문장과 다음 행동으로 보인다.",
    "settings-diagnostics",
  ),
  now(
    "settings-notifications",
    "Settings · Notifications",
    ["catch-up-notifications"],
    "Settings의 Notifications 탭. OS notification을 켤지 고른다. 켠 뒤에만 shell이 올린다.",
    "settings-notifications",
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
    "project-app-panel",
    "Project workspace · app panel tab",
    ["project-workspace", "ask-app-hint"],
    "프로젝트 작업대의 app panel 탭. 앱 화면의 panel 크기를 탭으로 띄운다. 앱 view는 native view라서 여기서는 안내 상자로 그린다.",
    "project-app-panel",
  ),
  now(
    "app-space",
    "App space",
    ["connect-apps", "report-app-problem"],
    "앱 공간. 상단 바에 앱 이름과 [Report a problem], 본문에 앱 view, 운영 탭(Tasks·Issues 등). 앱 view는 안내 상자로 그린다.",
    "app-space",
  ),
  now(
    "conversation-dock",
    "Conversation dock",
    ["ask-lophn-help"],
    "공간 오른쪽에 여는 대화 도크. lophn과 나눈 말, 시각 블록(표·차트), 결과 문서 링크가 보인다.",
    "conversation-dock",
  ),
  fresh(
    "new-project-tabs",
    "Project · tab kinds",
    "프로젝트 화면의 칸에 띄우는 탭 종류를 늘려 대부분의 화면을 탭으로 연다. 문서·터미널·앱 패널에 더해 대화·context·검색이 탭이 된다.",
    "new-tab-kinds",
  ),
  fresh(
    "new-project-tab-menu",
    "Project · new tab menu",
    "탭 줄 끝의 + 메뉴를 펼친 상태. New tab 아래에 문서·터미널·대화(lophn·Context Engineer·Operator)·context·검색·앱 패널이 있다.",
    "new-tab-menu",
  ),
  fresh(
    "new-sidebar-collapsed",
    "Project · sidebar collapsed",
    "접은 sidebar는 바로 가기 rail이 된다. 펼치기·Terminal·Search·Contexts·Saved views·Conversation 단추가 위에서부터 있고, 누르면 그 탭이 탭 줄에 열린다. 단추에 올리면 tooltip이 뜬다.",
    "new-sidebar-collapsed",
  ),
  fresh(
    "new-contexts",
    "Contexts tab",
    "project의 context 목록을 여는 새 탭 종류. context마다 목적, 다루는 것의 종류 수, 버전, 위반, 쓰는 Operator를 보이고 [Open]은 그 context의 탭(Overview)을 연다.",
    "new-contexts",
  ),
  fresh(
    "new-context-overview",
    "Context tab · Overview",
    "context를 열면 먼저 Overview가 보인다. 어떤 것들이 있고 각각 무엇이며 서로 어떻게 이어지는지를 그림으로, 무엇으로 이루어졌는지를 Composition 트리로 사람 말로 보인다. 타입 같은 계약 세부는 Contract 탭에 있다.",
    "new-context-overview",
  ),
  fresh(
    "new-context-contract",
    "Context tab · Contract",
    "계약 세부는 뒤쪽 탭에 있다. 자료가 놓인 곳·field 타입·다른 context에 내놓는 것·선언된 검색·test 결과다. 보통은 열 일이 없다.",
    "new-context-contract",
  ),
  fresh(
    "new-context-violations",
    "Context tab · Violations",
    "문서가 계약을 어기면 program이 찾아 알리고, 단추 하나로 Context Engineer에게 넘긴다. 근거는 자동으로 붙는다.",
    "new-context-violations",
  ),
  fresh(
    "new-violation-toast",
    "Contract violation toast",
    "위반이 생기면 오른쪽 아래 toast로 알린다. 누르면 그 context의 Violations가 열린다.",
    "new-violation-toast",
  ),
  fresh(
    "new-search-table",
    "Search tab · table result",
    "검색 화면은 Context Engineer가 계약에 선언한 검색으로 그려진다. 입력 칸의 종류와 결과 보기도 선언에서 나온다. 결과는 page로 나뉘고, Finding·Scenario·Experiment 칸은 링크라서 누르면 객체 탭이 열린다.",
    "new-search-table",
  ),
  fresh(
    "new-search-board",
    "Search tab · board result",
    "같은 선언 방식으로 결과 보기를 바꿀 수 있다. 상태별 묶음(board)으로 보이는 검색의 예다. 일반 검색어 검색은 위 막대의 돋보기로만 남는다.",
    "new-search-board",
  ),
  fresh(
    "new-search-combobox",
    "Search tab · typing a pick",
    '고르는 입력(Change, Metric, Scenario, About change)은 타이핑을 받는 combobox다. 입력칸에 "C-04"를 쓰면 맞는 후보(C-049·C-041·C-040)가 아래에 걸러져 펼쳐진다.',
    "new-search-combobox",
  ),
  fresh(
    "new-object",
    "Object tab · Finding",
    "검색 결과의 Finding·Scenario·Experiment는 링크이고 누르면 객체 탭이 새로 열린다. 선언된 field를 사람 말로, 관계를 링크로, 맨 아래에 원본 문서를 보인다.",
    "new-object",
  ),
  fresh(
    "new-workspace",
    "Lophn Workspace · without project concerns",
    "Lophn Workspace는 따로인 페이지로 남고, project 관심사(Documents, Context)는 뺀다. project 상세에는 project 자체 관리만 남는다.",
    "new-workspace",
  ),
  fresh(
    "new-organize",
    "Project · organize documents",
    "문서 보관·이동·추적 중단·폴더 연결 해제는 Workspace가 아니라 project 화면에서 한다. sidebar의 문서 행과 폴더 행을 오른쪽 클릭해 연다.",
    "new-organize",
  ),
];

/** 이 화면들은 버렸다. 목록에 올리지 않는다. */
export const DISCARDED_SCREENS: readonly string[] = [
  "settings-backup",
  "project-export",
  "lophn-documents",
  "lophn-contexts",
  "lophn-focus",
  "context-materials",
];

/** 버린 화면을 가리키는 이름 모양(지금 화면 part의 id·title·screen에 쓰지 않는다). */
export const DISCARDED_NAME =
  /\b(backup|export|documents|contexts?|focus|materials|baseline|reference|follow-changes|watch|perspective)\b/i;

export function pageById(id: string): WireframePage | undefined {
  return PAGES.find((page) => page.id === id);
}
