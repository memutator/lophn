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

export type PartId = "now" | "new";

export interface Part {
  readonly id: PartId;
  readonly title: string;
  readonly summary: string;
}

export const PARTS: readonly Part[] = [
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

export const BADGE_NOW = "구현됨 · 진짜 화면";
export const BADGE_NEW = "새 설계";

export type ScreenId =
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
  | "new-placeholder";

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

export const PAGES: readonly WireframePage[] = [
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
  {
    id: "new-placeholder",
    part: "new",
    title: "새 설계 · 준비 중",
    badges: [BADGE_NEW],
    description:
      "새 설계 wireframe 자리. 명세가 오는 대로 page를 더한다(project tab 종류, context 탭, contract 위반 toast, 저장한 view가 있는 project 검색, project 걱정 없는 Workspace). 사람이 이 page들을 확인한 뒤에 구현한다.",
    screen: "new-placeholder",
  },
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
