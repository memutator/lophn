import type { Area } from "../types.ts";
import type { ReactNode } from "react";
import { openSettings } from "../../../../packages/shell/renderer/desktop/router.ts";
import {
  SettingsAgentsInstructionsPage,
  SettingsAgentsPage,
  SettingsConnectCustomPage,
  SettingsConnectPage,
  SettingsDefaultModelPromptPage,
  SettingsProvidersConnectedEmptyPage,
  SettingsProvidersConnectedFoundPage,
  SettingsProvidersPage,
  SettingsToolsOAuthFormPage,
  SettingsToolsPage,
} from "./agent-setup/agent-setup-pages.tsx";
import {
  SettingsAppearance,
  SettingsAppearanceFontMissing,
  SettingsAppearanceFontSearch,
  SettingsAppearancePresets,
  SettingsAppearancePresetsDark,
  SettingsBack,
  SettingsBrowser,
  SettingsBrowserBookmarks,
  SettingsBrowserBookmarksCorrupt,
  SettingsBrowserClearData,
  SettingsBrowserDeviceAdd,
  SettingsBrowserDevices,
  SettingsBrowserLinks,
  SettingsBrowserLinksSystem,
  SettingsCoding,
  SettingsExtensionRemove,
  SettingsExtensions,
  SettingsDiagnostics,
  SettingsGeneral,
  SettingsKeyboard,
  SettingsKeyboardApps,
  SettingsKeyboardChanged,
  SettingsKeyboardConflicts,
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
    "Settings의 General, Appearance, Browser, Providers, Agents, Tools, Coding agents, Shell rules, Diagnostics.",
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
        "왼쪽 sidebar 맨 위 [Back to <이전 자리>]이다. Settings tab을 닫아도 같다. 누르면 Settings를 열기 전 화면(같은 project, 앱, session)으로 돌아가고, 앞 화면이 없으면 Home으로 간다.",
      render: () => <SettingsBack />,
    },
    {
      id: "new-settings-general",
      title: "Settings · General",
      description:
        "같은 shell 안이다. 왼쪽 sidebar가 Settings 항목 목록이 되고(맨 위 [Back to <이전 자리>]), tab 줄에는 Settings tab 하나, 오른쪽 sidebar는 없다. 묶음(General, Agents, System)마다 제목과 항목 줄을 아이콘과 함께 모두 놓는다. General은 선언한 항목을 타입대로 보이고, 값을 바꾸는 칸은 줄 오른쪽 끝 고정 열에 있다. 사람이 정한 값과 기본값을 나눠 보이고, 범위를 넘은 값은 거절 이유가 보인다.",
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
        "화면 모양을 정하는 Settings 항목이다. Theme(Light, Dark, System이 기본), Accent와 Background(색 견본), Font·Code font·Reading font(preset과 설치된 글꼴을 검색해 고르고 옆 칸에서 굵기를 고른다), 글자 크기, 문서 읽기 폭, 화면 밀도가 있다. 고르면 바로 모든 화면에 적용된다. 줄마다 이름과 설명이 왼쪽, 고르는 칸이 오른쪽 끝 고정 열이다.",
      render: () => <SettingsAppearance />,
    },
    {
      id: "new-settings-appearance-presets",
      title: "Settings · Appearance, presets (light)",
      description:
        "기본이 아닌 preset(Purple, Cool, System UI, 설치된 코드 글꼴 D2Coding Bold, Serif 본문, Large, Compact)을 고른 상태다. 같은 화면의 색, 글꼴, 글자 크기, 줄 높이가 바뀐다. 다른 화면은 주소에 ?appearance=accent:purple,background:cool을 붙여 본다.",
      render: () => <SettingsAppearancePresets />,
    },
    {
      id: "new-settings-appearance-font-search",
      title: "Settings · Appearance, font search",
      description:
        "UI 글꼴 칸을 연 상태다. 목록 맨 위 검색 칸에 쳐서 preset과 설치된 글꼴을 거른다. 위아래 화살표로 옮기고 Enter로 고른다.",
      render: () => <SettingsAppearanceFontSearch />,
    },
    {
      id: "new-settings-appearance-font-missing",
      title: "Settings · Appearance, font not installed",
      description:
        "저장된 코드 글꼴이 이 컴퓨터에 없는 상태다. 그 이름은 Not installed를 붙여 preset 다음에 두고, 화면은 기본 코드 글꼴로 그린다.",
      render: () => <SettingsAppearanceFontMissing />,
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
        "provider마다 연결 하나다. 연결된 것은 끊고 나머지는 [+ Connect]로 연결한다. 위 안내 문구가 model은 model picker와 Settings › Agents에서 고른다고 알려 준다. 어느 model을 picker에 보일지는 여기가 아니라 Manage models 창에서 정한다. 왼쪽 sidebar 맨 위에 [Back]이 있다.",
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
        "전역 기본 model 하나(대화와 같은 picker 칸)와 전역 지침이 있다. lophn은 workspace마다 있어 여기서 고치지 않는다. 그림은 기본 model 칸의 picker를 연 모습으로, 맨 아래 Manage models 줄 한 줄로 보일 model을 정한다. 기본 model은 여기서 정한다. role별 기본 model과 요약용 model 줄은 없다.",
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
        "Agents 묶음 끝의 항목이다. Built in(늘 막는 것과 먼저 묻는 것, 접힌 목록으로 읽기만), Global(모든 project에 적용), project마다 한 절이 있다. 줄마다 pattern과 오른쪽 끝 열의 action(Allow, Ask, Deny)과 [Remove]가 있고, 절 끝의 더하기 줄에서 새 규칙을 더한다.",
      render: () => <SettingsShellRules />,
    },
    {
      id: "new-settings-shell-rules-add",
      title: "Settings · Shell rules · add",
      description:
        "Global 절의 더하기 줄에 pattern `npm publish *`를 치고 action을 Ask로 고른 상태다. pattern이 비면 [Add rule]이 꺼진다. 새 규칙은 절의 끝에 붙어 그 절에서 가장 나중에 맞는다.",
      render: () => <SettingsShellRulesAdd />,
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
        "작업대 단축키를 Tabs·Split·Desks·Floating·Open·View·Apps 묶음으로 보이는 Settings 항목이다. 줄 오른쪽 끝의 키 칸을 누르면 새 키를 받고, 받은 키는 바로 저장되어 그 OS에서만 바뀐다. 기본 키가 없는 줄은 흐린 Not set이다.",
      render: () => <SettingsKeyboard />,
    },
    {
      id: "settings-keyboard-changed",
      title: "Settings · Keyboard · changed",
      description:
        '탭 닫기를 다른 키로 바꾸고 sidebar 키를 뺀 상태다. 바꾼 줄에는 [Reset to default]가, 아래에는 [Reset all shortcuts]가 있다. Open a file 줄이 새 키를 받는 중이고 이미 쓰는 키(Ctrl+Tab)를 눌러 "Ctrl+Tab is used by Next tab. [Replace] [Cancel]"이 떴다.',
      render: () => <SettingsKeyboardChanged />,
    },
    {
      id: "settings-keyboard-conflicts",
      title: "Settings · Keyboard · conflicts",
      description:
        "저장된 키끼리 겹친 상태다. 맨 위에 겹친 키 수와 [Show conflicts only] 토글이 있고, 겹친 줄은 상대 이름과 [Remove]를 보인다. lophn이나 OS가 먼저 쓰는 키와 겹친 줄은 그렇다고 적는다.",
      render: () => <SettingsKeyboardConflicts />,
    },
    {
      id: "settings-keyboard-apps",
      title: "Settings · Keyboard · apps",
      description:
        'Apps 묶음이다. 설치된 앱의 panel 화면마다 줄이 있어 키를 달면 어디서든 그 화면을 연다. 지운 앱에 달린 키는 "없는 앱" 줄로 남아 [Remove]만 된다.',
      render: () => <SettingsKeyboardApps />,
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
      id: "settings-browser-devices",
      title: "Settings · Browser · devices",
      description:
        "Devices 구역이다. preview 탭이 흉내 낼 기기(이름, 크기, DPR, OS)가 줄마다 서고 [Edit]·[Remove]가 있다. 아래 [Add device]로 더한다.",
      render: () => <SettingsBrowserDevices />,
    },
    {
      id: "settings-browser-device-add",
      title: "Settings · Browser · add a device",
      description:
        "[Add device]를 눌러 입력 칸(Name, Width, Height, Pixel ratio, OS)이 열렸다. 처음 값은 iPhone 크기다. 범위 밖이거나 이름이 겹치면 저장되지 않고 한 줄 오류가 난다.",
      render: () => <SettingsBrowserDeviceAdd />,
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
      id: "new-settings-extensions",
      title: "Settings · Extensions",
      description:
        "Settings › System › Extensions. 본체와 따로 켜는 기능이 줄마다 이름, 설명, 판, 상태로 보인다. 켜진 줄은 [Turn off]와 [Remove], 설치했지만 꺼진 줄은 [Turn on]과 [Remove], 설치 안 된 줄은 [Install]이다. 상태 표시와 단추는 줄 오른쪽 끝 고정 열에 있다.",
      render: () => <SettingsExtensions />,
    },
    {
      id: "new-settings-extension-remove",
      title: "Settings · Remove extension",
      description:
        "꺼진 extension의 [Remove]를 눌러 연 확인 dialog. extension이 쓴 file만 지우고 사람이 그 폴더에 둔 file은 남는다는 한 줄을 보이고 빨간 Remove(danger)가 오른쪽 끝이다. 켜진 extension은 dialog 없이 먼저 끄라는 글만 보인다.",
      render: () => <SettingsExtensionRemove />,
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
