import type { Area } from "../types.ts";
import type { ReactNode } from "react";
import { openSettings } from "../../../../packages/shell/renderer/desktop/router.ts";
import {
  SettingsAgentsInstructionsPage,
  SettingsAgentsPage,
  SettingsConnectCustomPage,
  SettingsConnectPage,
  SettingsDefaultModelPromptPage,
  SettingsLophnPage,
  SettingsProvidersConnectedEmptyPage,
  SettingsProvidersConnectedFoundPage,
  SettingsProvidersPage,
  SettingsToolsOAuthFormPage,
  SettingsToolsPage,
} from "./agent-setup/agent-setup-pages.tsx";
import {
  SettingsAppearance,
  SettingsAppearancePresets,
  SettingsAppearancePresetsDark,
  SettingsBack,
  SettingsBrowser,
  SettingsBrowserBookmarks,
  SettingsBrowserBookmarksCorrupt,
  SettingsBrowserClearData,
  SettingsBrowserLinks,
  SettingsBrowserLinksSystem,
  SettingsCoding,
  SettingsDiagnostics,
  SettingsGeneral,
  SettingsKeyboard,
  SettingsKeyboardChanged,
  SettingsJobsDelete,
  SettingsJobsEdit,
  SettingsJobsEmpty,
  SettingsJobsHistory,
  SettingsJobsList,
  SettingsRequiredEmpty,
  SettingsShellRules,
  SettingsShellRulesAdd,
} from "./settings-pages.tsx";
import { MockDesktop, type SettingsTab } from "../../mock/mock-desktop.tsx";

function settings(tab: SettingsTab): ReactNode {
  return <MockDesktop route={openSettings()} settingsTab={tab} />;
}

export const settingsArea: Area = {
  id: "settings",
  title: "Settings",
  summary:
    "Settings의 General, Appearance, Browser, Providers, Agents, Tools, Coding agents, Shell rules, Scheduled jobs, Diagnostics.",
  pages: [
    {
      id: "settings-coding",
      title: "Settings · Coding agents",
      description:
        "Settings의 Coding agents 탭. 감지한 coding agent와 연결을 보고 회수한다.",
      render: () => settings("coding"),
    },
    {
      id: "settings-general",
      title: "Settings · General",
      description:
        "Settings의 General 탭. 기본 model과 읽기 설정, 전역 Instructions 편집기로 가는 길.",
      render: () => settings("general"),
    },
    {
      id: "settings-diagnostics",
      title: "Settings · Diagnostics",
      description:
        "Settings의 Diagnostics 탭. 보안 상태 점검과 doctor 결과를 영향 한 문장과 다음 행동으로 보인다.",
      render: () => settings("diagnostics"),
    },
    {
      id: "new-settings-back",
      title: "Settings · Back",
      description:
        "Settings 머리 왼쪽의 [Back]이다. 누르면 Settings를 열기 전 화면(같은 project, 앱, session)으로 돌아가고, 앞 화면이 없으면 launcher로 간다.",
      render: () => <SettingsBack />,
    },
    {
      id: "new-settings-general",
      title: "Settings · General",
      description:
        "Settings sidebar는 project 창 sidebar의 panel 꼴이다. 묶음(General, Agents, System)마다 제목과 항목 줄을 아이콘과 함께 모두 놓는다. 위쪽 바의 단추로 접으면 항목 아이콘만 activity bar 꼴로 남는다. General은 선언한 항목을 타입대로 보이고, 값을 바꾸는 칸은 줄 오른쪽 끝 고정 열에 있다. 사람이 정한 값과 기본값을 나눠 보이고, 범위를 넘은 값은 거절 이유가 보인다.",
      render: () => <SettingsGeneral />,
    },
    {
      id: "new-settings-required-empty",
      title: "Settings · required setting empty",
      description:
        "필수 설정(기본 model)이 비었을 때다. 탭 위쪽 toast가 그 기능(lophn과 project agent)만 시작하지 않는다고 알리고 고르러 가는 길을 준다.",
      render: () => <SettingsRequiredEmpty />,
    },
    {
      id: "new-settings-appearance",
      title: "Settings · Appearance",
      description:
        "화면 모양을 정하는 Settings 항목이다. Theme(Light, Dark, System이 기본), Accent와 Background(색 견본), Font와 Code font(Custom은 설치된 글꼴 이름을 적는다), 글자 크기, 문서 읽기 폭, 화면 밀도가 있다. 고르면 바로 모든 화면에 적용된다. 줄마다 이름과 설명이 왼쪽, 고르는 칸이 오른쪽 끝 고정 열이다.",
      render: () => <SettingsAppearance />,
    },
    {
      id: "new-settings-appearance-presets",
      title: "Settings · Appearance, presets (light)",
      description:
        "기본이 아닌 preset(Purple, Cool, System UI, Custom 코드 글꼴, Large, Compact)을 고른 상태다. 같은 화면의 색, 글꼴, 글자 크기, 줄 높이가 바뀐다. 다른 화면은 주소에 ?appearance=accent:purple,background:cool을 붙여 본다.",
      render: () => <SettingsAppearancePresets />,
    },
    {
      id: "new-settings-appearance-presets-dark",
      title: "Settings · Appearance, presets (dark)",
      description: "같은 preset을 Dark로 본 상태다.",
      render: () => <SettingsAppearancePresetsDark />,
    },
    {
      id: "new-settings-providers",
      title: "Settings · Providers",
      description:
        "provider마다 연결 하나다. 연결된 것은 끊고 나머지는 [+ Connect]로 연결한다. 위 안내 문구가 model은 model picker와 Settings › Agents에서 고른다고 알려 준다. 어느 model을 picker에 보일지는 여기가 아니라 Manage models 창에서 정한다. 머리 왼쪽에 [Back]이 있다.",
      render: () => <SettingsProvidersPage />,
    },
    {
      id: "new-settings-providers-connected-found",
      title: "Settings · Providers, custom provider connected, models found",
      description:
        'Custom provider를 붙이고 목록을 찾은 직후다. 전역 기본 model이 이미 있어 다른 창이 뜨지 않으므로, 결과를 그 provider 줄 아래 한 줄로 보인다: "Found 2 models on Local server."와 오른쪽 끝 [Manage models](그 provider 묶음이 맨 위로 열린다). 이 화면을 떠날 때까지 남는다.',
      render: () => <SettingsProvidersConnectedFoundPage />,
    },
    {
      id: "new-settings-providers-connected-empty",
      title: "Settings · Providers, custom provider connected, no model list",
      description:
        'Custom provider를 붙였는데 /models 목록이 없을 때(hive처럼 404)다. Manage models가 그 provider의 Add model form과 함께 먼저 열리고, 닫은 뒤에도 provider 줄 아래에 "Local server didn\'t list its models. Add them by name."과 오른쪽 끝 [Add model](그 form이 열린 채 Manage models가 다시 열린다)이 남는다.',
      render: () => <SettingsProvidersConnectedEmptyPage />,
    },
    {
      id: "new-settings-connect",
      title: "Settings · connect a provider",
      description:
        "provider 연결 창이다. API key는 이 창에서 받지 않고 보호 입력으로 받는다.",
      render: () => <SettingsConnectPage />,
    },
    {
      id: "new-settings-connect-custom",
      title: "Settings · connect a custom provider",
      description:
        "Custom provider 연결 창이다. Provider ID, Display name 아래에 API 고르기(Chat Completions가 기본, Responses, Anthropic Messages)가 있고, Base URL 아래 안내가 주소를 /chat/completions, /responses, /messages 바로 앞까지 쓰라고 알려 준다. 연결하면 provider의 model 목록을 한 번 읽는다.",
      render: () => <SettingsConnectCustomPage />,
    },
    {
      id: "new-settings-default-model-prompt",
      title: "Settings · choose a default model",
      description:
        '처음 provider를 붙였는데 전역 기본 model이 없을 때 연결이 끝나자마자 뜨는 "Choose a default model" 대화창이다. 안의 picker는 창 위에 창을 겹치지 않도록 맨 아래 Manage models 줄이 없고, [Skip]으로 고르지 않고 닫을 수 있다.',
      render: () => <SettingsDefaultModelPromptPage />,
    },
    {
      id: "new-settings-agents",
      title: "Settings · Agents",
      description:
        "전역 기본 model 하나(대화와 같은 picker 칸)와 lophn 카드(전체에 하나), 전역 지침이 있다. 그림은 기본 model 칸의 picker를 연 모습으로, 맨 아래 Manage models 줄 한 줄로 보일 model을 정한다. 기본 model은 여기서 정한다. role별 기본 model과 요약용 model 줄은 없다.",
      render: () => <SettingsAgentsPage />,
    },
    {
      id: "settings-agents-instructions",
      title: "Settings · Agents › editing instructions",
      description:
        "모든 project의 지침(LOPHN.md) 상자의 [Edit]을 누르면 같은 자리가 파일 탭과 같은 markdown 편집기(live preview)가 된다. [Cancel]·[Save]가 오른쪽 끝에 있고, 다른 곳에서 파일이 바뀌었으면 저장하지 않고 [Reload]를 보인다. 따로 열리는 편집기 화면은 없다.",
      render: () => <SettingsAgentsInstructionsPage />,
    },
    {
      id: "new-settings-lophn",
      title: "Settings · Agents › lophn",
      description:
        "lophn의 설정이다. agent 설정 화면과 같고 project 지침 칸은 없다. 놓인 곳은 lophn 전체이고 Grants 탭이 있다. 폭은 다른 Settings 항목과 같은 기둥이다.",
      render: () => <SettingsLophnPage />,
    },
    {
      id: "new-settings-tools",
      title: "Settings · Tools and skills",
      description:
        "전역 skill 켬과 끔, 전역 MCP server다. 같은 이름은 project나 agent 층이 덮는다는 안내가 있다. OAuth로 로그인하는 server는 아직 로그인하지 않았으면 줄 오른쪽에 [Sign in]이 있다.",
      render: () => <SettingsToolsPage />,
    },
    {
      id: "new-settings-tools-oauth-form",
      title: "Settings · Tools and skills · add OAuth server",
      description:
        "전역 MCP server를 더하는 form에 web 주소와 OAuth 2.1 로그인을 고른 상태다. issuer(https), client ID, scopes(공백이나 쉼표로 가름)를 받고 client secret은 더한 뒤 보호 입력으로 받는다. 받지 않으면 public client로 sign-in한다.",
      render: () => <SettingsToolsOAuthFormPage />,
    },
    {
      id: "new-settings-coding",
      title: "Settings · Coding agents",
      description:
        "제품마다 vendor 아이콘과 실행 파일, version, turn 끝 신호 있음과 없음, 전역 hook 상태를 보인다. 검색 칸은 표 위에 띄워 둔다. hook이 놓이지 않은 제품에는 [Install hooks], 놓인 제품에는 [Uninstall hooks]가 있다. [Detect again]이 있다. 연결 만들기와 회수는 없다.",
      render: () => <SettingsCoding />,
    },
    {
      id: "new-settings-shell-rules",
      title: "Settings · Shell rules",
      description:
        "Agents 묶음 끝의 항목이다. Built in(늘 막는 것과 먼저 묻는 것, 접힌 목록으로 읽기만), Workspace(모든 project에 적용), project마다 한 절이 있다. 줄마다 pattern과 오른쪽 끝 열의 action(Allow, Ask, Deny)과 [Remove]가 있고, 절 끝의 더하기 줄에서 새 규칙을 더한다.",
      render: () => <SettingsShellRules />,
    },
    {
      id: "new-settings-shell-rules-add",
      title: "Settings · Shell rules · add",
      description:
        "Workspace 절의 더하기 줄에 pattern `npm publish *`를 치고 action을 Ask로 고른 상태다. pattern이 비면 [Add rule]이 꺼진다. 새 규칙은 절의 끝에 붙어 그 절에서 가장 나중에 맞는다.",
      render: () => <SettingsShellRulesAdd />,
    },
    {
      id: "settings-jobs-empty",
      title: "Settings · Scheduled jobs · empty",
      description:
        "System 묶음의 Scheduled jobs 항목에서 job이 하나도 없을 때의 본문이다. 사람은 job을 만들지 못하고 agent에게 만들어 달라고 말하라고 안내한다.",
      render: () => <SettingsJobsEmpty />,
    },
    {
      id: "settings-jobs-list",
      title: "Settings · Scheduled jobs · list",
      description:
        "모든 place의 job을 한곳에 모은 목록이다(job 다섯, 하나는 꺼짐). 줄에는 제목, 주기 글, 다음 차례, 할 일 요약, 만든 agent, 놓친 차례 정책, 마지막 결과가 있고 오른쪽 끝 고정 열에 켜고 끄는 switch, Edit, Delete, 기록 토글이 있다.",
      render: () => <SettingsJobsList />,
    },
    {
      id: "settings-jobs-history",
      title: "Settings · Scheduled jobs · history",
      description:
        "세 job의 기록을 폈다. 상태 여덟과 건너뜀 이유 셋(내가 건너뜀, 앞 차례가 아직 돎, 제때 온 차례로 바뀜), 놓친 차례를 접은 줄, session과 project를 여는 단추가 보인다. 시작하지 못한 실패는 이유 글이 붙는다.",
      render: () => <SettingsJobsHistory />,
    },
    {
      id: "settings-jobs-edit",
      title: "Settings · Scheduled jobs · edit",
      description:
        "Edit dialog다. 제목, 주기(숫자와 단위, 하루 단위일 때만 At), 놓친 차례 정책만 고친다. 할 일은 고치지 않고 만든 agent에게 말하라고 안내한다.",
      render: () => <SettingsJobsEdit />,
    },
    {
      id: "settings-jobs-delete",
      title: "Settings · Scheduled jobs · delete",
      description:
        "Delete 확인 dialog다. job과 그 기록을 지우고, 돌고 있는 것은 끝까지 돈다고 말한다.",
      render: () => <SettingsJobsDelete />,
    },
    {
      id: "settings-browser",
      title: "Settings · Browser",
      description:
        "browser 탭의 Bookmarks 목록과 Browsing data 구역이다. [Clear browsing data]는 모든 browser 탭이 같이 쓰는 로그인과 site data, cache를 지운다.",
      render: () => <SettingsBrowser />,
    },
    {
      id: "settings-keyboard",
      title: "Settings · Keyboard",
      description:
        "작업대 단축키를 줄마다 보이는 Settings 항목이다. 줄 오른쪽 끝의 키 칸을 누르면 새 키를 받고, 받은 키는 바로 저장되어 그 OS에서만 바뀐다.",
      render: () => <SettingsKeyboard />,
    },
    {
      id: "settings-keyboard-changed",
      title: "Settings · Keyboard · changed",
      description:
        "탭 닫기를 다른 키로 바꾸고 sidebar 키를 뺀 상태다. 바꾼 줄에는 [Reset to default]가, 아래에는 [Reset all shortcuts]가 있다. Open a file 줄이 새 키를 받는 중이고 이미 쓰는 키(Ctrl+Tab)를 눌러 막혔다.",
      render: () => <SettingsKeyboardChanged />,
    },
    {
      id: "settings-browser-links",
      title: "Settings · Browser · links",
      description:
        "Links 구역이다. terminal에서 연 web link와 local link(localhost, 사설 주소)를 각각 Browser tab이나 System browser로 열도록 고른다. 기본은 둘 다 Browser tab이다.",
      render: () => <SettingsBrowserLinks />,
    },
    {
      id: "settings-browser-links-system",
      title: "Settings · Browser · links to the system browser",
      description:
        "web link는 System browser, local link는 Browser tab이다. `gh auth login`이 연 주소는 OS browser로, `vite`가 낸 주소는 browser 탭으로 가는 설정이다.",
      render: () => <SettingsBrowserLinksSystem />,
    },
    {
      id: "settings-browser-clear-data",
      title: "Settings · Browser · clear browsing data",
      description:
        "[Clear browsing data]를 눌러 확인 dialog가 열렸다. 지우면 열린 browser 탭을 다시 load한다.",
      render: () => <SettingsBrowserClearData />,
    },
    {
      id: "settings-browser-bookmarks",
      title: "Settings · Browser · bookmarks",
      description:
        "bookmark 목록이다. 줄마다 favicon, title, URL, [Edit], [Remove]이고 favicon이 없으면 Globe다. 둘째 줄은 [Edit]을 눌러 title·URL 입력으로 바뀌었다.",
      render: () => <SettingsBrowserBookmarks />,
    },
    {
      id: "settings-browser-bookmarks-corrupt",
      title: "Settings · Browser · damaged bookmarks file",
      description:
        "bookmarks.json이 깨져 목록 자리에 오류 문장만 있다. 덮어쓰지 않으려고 고치거나 지우는 단추를 두지 않는다.",
      render: () => <SettingsBrowserBookmarksCorrupt />,
    },
    {
      id: "new-settings-diagnostics",
      title: "Settings · Diagnostics",
      description:
        "구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 점검한 시각이 있다. 사람이 [Run checks]를 누를 때만 점검한다.",
      render: () => <SettingsDiagnostics />,
    },
  ],
};
