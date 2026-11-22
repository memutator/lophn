import type { Area } from "../types.ts";
import type { ReactNode } from "react";
import { openSettings } from "../../../../packages/shell/renderer/desktop/router.ts";
import {
  BUDGET_REVIEWER_ID,
  EVAL_ANALYST_ID,
  PROFILE_SHOP,
  PROFILE_WORK,
  QUEUE_WATCHER_ID,
  SAMPLE_BROWSER_PROFILES,
} from "../../../../packages/shell/renderer/workspace/agents/fake-data.ts";
import { click, find } from "../../mock/drive.ts";
import { SettingsFrame } from "./settings-frame.tsx";
import { SettingsMachineScene } from "./shell/settings-machine-scene.tsx";
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
  SettingsAppearanceThemeFile,
  SettingsBack,
  SettingsBrowser,
  SettingsBrowserBookmarks,
  SettingsBrowserBookmarksCorrupt,
  SettingsBrowserClearData,
  SettingsBrowserDeviceAdd,
  SettingsBrowserDevices,
  SettingsBrowserLoginAdd,
  SettingsBrowserLinks,
  SettingsBrowserLinksSystem,
  SettingsCoding,
  SettingsDiagnostics,
  SettingsGeneral,
  SettingsKeyboard,
  SettingsRemote,
  SettingsRemoteDevelopment,
  SettingsRemoteKeepRunning,
  SettingsRemoteLoginFailed,
  SettingsRemoteLoginOff,
  SettingsRemoteOff,
  SettingsRemoteInvitePhone,
  SettingsRemoteInviteComputer,
  SettingsRemoteJoinFailed,
  SettingsRemoteJoinPending,
  SettingsRemoteJoinUpdate,
  SettingsRemoteRemovedHere,
  SettingsRemoteWaiting,
  SettingsRemoteDisputed,
  SettingsRemoteRemove,
  SettingsSync,
  SettingsSyncEdit,
  SettingsSyncEmpty,
  SettingsSyncRefused,
  SettingsKeyboardApps,
  SettingsKeyboardChanged,
  SettingsKeyboardConflicts,
  SettingsRequiredEmpty,
  SettingsShellRules,
  SettingsShellRulesAdd,
} from "./settings-pages.tsx";
import { MockDesktop, type SettingsTab } from "../../mock/mock-desktop.tsx";

const PROFILE_AGENTS = [
  { id: EVAL_ANALYST_ID, name: "Eval analyst", profile: PROFILE_WORK },
  { id: BUDGET_REVIEWER_ID, name: "Budget reviewer", profile: PROFILE_WORK },
  { id: QUEUE_WATCHER_ID, name: "Queue watcher", profile: null },
];
const PROFILE_LOGINS = [
  {
    id: "lgn_fake0",
    profile: null,
    label: "GitHub",
    origin: "https://github.com",
    username: "dev@example.com",
    note: "",
    password: true,
    totp: true,
  },
  {
    id: "lgn_fake1",
    profile: null,
    label: "Staging admin",
    origin: "http://localhost:3000",
    username: "admin",
    note: "",
    password: false,
    totp: false,
  },
  {
    id: "lgn_fake2",
    profile: PROFILE_WORK,
    label: "Company wiki",
    origin: "https://wiki.example.com",
    username: "me@example.com",
    note: "",
    password: true,
    totp: false,
  },
  {
    id: "lgn_fake3",
    profile: PROFILE_WORK,
    label: "Time tracking",
    origin: "https://time.example.com",
    username: "me@example.com",
    note: "",
    password: true,
    totp: true,
  },
];
const WITH_PROFILES = {
  profiles: [...SAMPLE_BROWSER_PROFILES],
  agents: PROFILE_AGENTS,
  logins: PROFILE_LOGINS,
};

// 한 구역이 창 위쪽에 오게 올린다. Browser 항목이 길어서 아래 구역은 열자마자 잘린다.
const scrollToSection = (selector: string) => async () =>
  (await find(selector)).closest("section")!.scrollIntoView({ block: "start" });

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
        "기본이 아닌 값(light는 Cool, dark는 Tokyo Night theme, Purple accent, System UI, 설치된 코드 글꼴 D2Coding Bold, Serif 본문, Large, Compact)을 고른 상태다. 같은 화면의 색, 글꼴, 글자 크기, 줄 높이가 바뀐다. 다른 화면은 주소에 ?appearance=mode:dark,dark_theme:tokyo-night을 붙여 본다.",
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
      description:
        "같은 값을 Dark로 본 상태다. dark theme이 Tokyo Night라 syntax·터미널 색까지 Tokyo Night다.",
      render: () => <SettingsAppearancePresetsDark />,
    },
    {
      id: "new-settings-appearance-theme-file",
      title: "Settings · Appearance, theme file with problems",
      description:
        "light theme으로 theme file(Pastel)을 고른 상태다. 고른 file의 문제(모르는 색 이름, 대비가 모자란 글자)가 줄 아래에 보인다. 읽을 수 없는 file(draft.json)은 Themes folder 줄 아래에 이유와 함께 보인다. [Open folder]는 data root의 themes 폴더를 연다.",
      render: () => <SettingsAppearanceThemeFile />,
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
        "전역 skill 켬과 끔, 전역 MCP server다. 같은 이름은 project나 agent 층이 덮는다는 안내가 있다. OAuth로 로그인하는 server는 아직 로그인하지 않았으면 줄 오른쪽에 [Sign in]이 있다. secret을 가리키는 server(bearer·API key credential, OAuth client secret, 헤더)는 자리마다 [Set …]이나 값이 들어 있으면 [Change …]가 있어 이미 있는 server의 값을 보호 입력 창으로 바꾼다.",
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
        "browser 탭의 Bookmarks 목록, Profiles 구역(기본 profile 줄만 있고 [Add profile]로 만든다), Browsing data 구역이다. [Clear browsing data]는 기본 profile의 로그인과 site data, cache를 지운다.",
      render: () => <SettingsBrowser />,
    },
    {
      id: "settings-browser-profiles",
      title: "Settings · Browser · profiles",
      description:
        "Profiles 구역이다. 맨 위는 지울 수 없는 기본 profile이고 아래에 사람이 만든 profile(Work, Shopping)이 색 점과 이름, 그 profile을 쓰는 agent 이름과 함께 선다. 줄 오른쪽 끝 고정 열에 [Rename], [Color], [Clear data], [Delete]가 있고 아래 [Add profile]로 이름과 색을 골라 더한다.",
      render: () => (
        <SettingsFrame
          pane="browser"
          browser={WITH_PROFILES}
          steps={[scrollToSection("[data-profiles]")]}
        />
      ),
    },
    {
      id: "settings-browser-profile-delete",
      title: "Settings · Browser · delete a profile",
      description:
        "Work의 [Delete]를 눌러 확인 dialog가 열렸다. 그 profile의 저장 login 수와 cookie·site data가 함께 지워진다는 것, 그 profile을 쓰던 agent는 기본 profile로 떨어진다는 것, 다른 컴퓨터와 나누는 중이면 거기서도 지워진다는 것을 말한다. 확인하면 partition data를 지운 뒤 core가 login과 profile을 지우고, 중간에 실패하면 profile이 남는다.",
      render: () => (
        <SettingsFrame
          pane="browser"
          browser={WITH_PROFILES}
          steps={[
            scrollToSection("[data-profiles]"),
            () => click("[data-profile-delete]"),
          ]}
        />
      ),
    },
    {
      id: "settings-browser-share",
      title: "Settings · Browser · share with other computers",
      description:
        "Logins 아래의 Your other computers 구역이다. 줄 하나가 profile과 저장 login(password, TOTP key 포함)을 짝지은 컴퓨터들과 같게 둔다는 것, 컴퓨터 사이의 암호화된 연결로만 가고 같이 보는 폴더로는 가지 않으며 두 컴퓨터가 같이 켜져 있을 때 닿는다는 것, cookie와 site data는 컴퓨터마다 따로이고 어느 agent가 어느 profile을 쓰는지도 컴퓨터마다 정한다는 것을 말하고, 오른쪽 끝 Switch로 이 컴퓨터의 나누기를 끈다(기본은 켬).",
      render: () => (
        <SettingsFrame
          pane="browser"
          browser={WITH_PROFILES}
          steps={[scrollToSection("[data-browser-share]")]}
        />
      ),
    },
    {
      id: "settings-remote",
      title: "Settings · Remote",
      description:
        '연결을 켜는 Switch와 My devices, Add a device 구역이다. 명단의 기기마다 종류와 OS, 이 컴퓨터 표시, 컴퓨터의 연결 상태나 폰의 마지막 연결, "이 컴퓨터의 터미널에 칠 수 있게" 허락하는 스위치(이 컴퓨터 줄에는 없다. 허락은 컴퓨터마다 따로다)와 [Rename]·[Make primary](폰)·[Remove]가 있다. 아래에 Open at start, [Invite a phone]·[Invite a computer]·[Join with an invite]가 있다. 위에 This computer와 Keep running 구역이 있다.',
      render: () => <SettingsRemote />,
    },
    {
      id: "settings-remote-keep-running",
      title: "Settings · Remote · keep running",
      description:
        "Keep lophn running on this computer와 Keep this computer awake가 켜져 있고 OS가 등록됨을 답했다. 사실 한 줄은 Starts when you log in이다.",
      render: () => <SettingsRemoteKeepRunning />,
    },
    {
      id: "settings-remote-login-failed",
      title: "Settings · Remote · login not registered",
      description:
        "표시는 켜졌는데 OS 등록이 서지 않았다. 경고와 [Try again]이 같은 켜기를 다시 보낸다.",
      render: () => <SettingsRemoteLoginFailed />,
    },
    {
      id: "settings-remote-login-off",
      title: "Settings · Remote · login off in system",
      description:
        "사람이 OS의 시작 설정에서 등록을 껐다. 어디서 바꾸는지(OS별)와 [Turn on again]이 있다.",
      render: () => <SettingsRemoteLoginOff />,
    },
    {
      id: "settings-remote-development",
      title: "Settings · Remote · development build",
      description:
        "개발 build라 Keep lophn running 스위치가 disabled이고 Not available in a development build만 보인다.",
      render: () => <SettingsRemoteDevelopment />,
    },
    {
      id: "settings-remote-off",
      title: "Settings · Remote · off",
      description:
        "연결이 꺼진 상태다. 명단과 더하기 대신 켜라는 안내 한 줄만 있다.",
      render: () => <SettingsRemoteOff />,
    },
    {
      id: "settings-remote-invite-phone",
      title: "Settings · Remote · invite a phone",
      description:
        "[Invite a phone]을 눌러 초대장 QR이 열렸다. 남은 시간(30분에서 줄어든다), Show as text, [New invite]와 새 기기가 이 컴퓨터의 터미널에 칠 수 있게 하는 스위치(다른 컴퓨터는 따로 정한다)가 있다. 새 폰이 들어오면 초대장이 닫히고 My devices에 선다.",
      render: () => <SettingsRemoteInvitePhone />,
    },
    {
      id: "settings-remote-invite-computer",
      title: "Settings · Remote · invite a computer (7 days)",
      description:
        '[Invite a computer]를 누르고 "The new device can\'t be on at the same time as this computer"를 켰다. 초대장은 7일짜리이고 글을 펼쳐 다른 컴퓨터의 Join with an invite에 붙여 넣는다(dual boot, 집과 직장).',
      render: () => <SettingsRemoteInviteComputer />,
    },
    {
      id: "settings-remote-join-failed",
      title: "Settings · Remote · join refused",
      description:
        '[Join with an invite]에 붙인 초대장이 수명이 지나 거절되었다. 칸 위에 "초대한 컴퓨터가 이 컴퓨터의 터미널에 칠 수 있게" 하는 스위치(기본 켬)가 있고 칸 아래에 이유(지남, 이미 쓰임, 확인 안 됨, 빠진 컴퓨터, 이 컴퓨터의 초대장 등)가 선다.',
      render: () => <SettingsRemoteJoinFailed />,
    },
    {
      id: "settings-remote-join-update",
      title: "Settings · Remote · join needs an update",
      description:
        "초대한 컴퓨터가 답했지만 remote protocol 판이 어긋났다. 칸 아래에 어느 쪽 lophn을 올릴지(이 컴퓨터, 그 컴퓨터)가 선다. 기다리는 중이 아니고 명단에 아무것도 남지 않는다.",
      render: () => <SettingsRemoteJoinUpdate />,
    },
    {
      id: "settings-remote-join-pending",
      title: "Settings · Remote · join pending",
      description:
        "초대장으로 들었지만 초대한 컴퓨터가 꺼져 있다. 그 컴퓨터를 아는 기기(폰)가 이 컴퓨터에 붙으면 끝난다는 글이 선다.",
      render: () => <SettingsRemoteJoinPending />,
    },
    {
      id: "settings-remote-waiting",
      title: "Settings · Remote · device waiting",
      description:
        "초대한 컴퓨터가 꺼져 있을 때 들어온 Work laptop 줄에 Waiting과 그 이유가 선다.",
      render: () => <SettingsRemoteWaiting />,
    },
    {
      id: "settings-remote-disputed",
      title: "Settings · Remote · disputed removal",
      description:
        "두 컴퓨터가 서로 뺀 소식이 같이 닿아 둘 다 Disputed로 선다. 줄에는 설명 한 줄과 Remove만 있고, 믿지 않는 쪽을 빼면 다른 쪽이 돌아온다.",
      render: () => <SettingsRemoteDisputed />,
    },
    {
      id: "settings-remote-removed-here",
      title: "Settings · Remote · this computer was removed",
      description:
        "다른 컴퓨터가 이 컴퓨터를 명단에서 뺐다. 이 컴퓨터는 명단과 key를 버리고 자기만 든 명단으로 섰고, My devices 위에 그 일과 다시 들려면 새 초대장을 쓰라는 한 줄이 선다.",
      render: () => <SettingsRemoteRemovedHere />,
    },
    {
      id: "settings-remote-remove",
      title: "Settings · Remote · remove a device",
      description:
        "Home server의 [Remove]를 눌러 확인 dialog가 열렸다. 모든 기계에서 끊기고 그 key로 다시 들지 못한다.",
      render: () => <SettingsRemoteRemove />,
    },
    {
      id: "settings-sync",
      title: "Settings · Sync",
      description:
        'Remote 다음 항목이다. 폴더 구역은 맨 위에 "Folder all my computers see"(path)가 따로 서고 그 아래 이름 붙인 폴더가 있다. 컴퓨터 구역은 이 컴퓨터와 다른 컴퓨터의 연결(직접, relay, 꺼짐과 마지막으로 본 때)과 그 컴퓨터의 file을 마지막으로 받은 길과 때(연결, 폰, 폴더)를 보인다. 앱 구역은 앱마다 어느 폴더로 맞추는지와 마지막으로 맞춘 때다. 길을 고르는 설정은 없다.',
      render: () => <SettingsSync />,
    },
    {
      id: "settings-sync-empty",
      title: "Settings · Sync · nothing set",
      description:
        "같이 보는 폴더도 이름 붙인 폴더도 없다. Google Drive, Syncthing, 두 OS가 같이 보는 디스크의 폴더를 고르거나 lophn에게 붙여 달라고 하라는 한 줄이 있다. Remote가 꺼져 있어 컴퓨터 구역은 Remote를 켜라는 한 줄과 [Open Remote]뿐이다.",
      render: () => <SettingsSyncEmpty />,
    },
    {
      id: "settings-sync-edit",
      title: "Settings · Sync · edit a folder",
      description:
        "이름 붙인 폴더 하나를 고치는 form이다. 이름 칸, path 칸과 [Choose…], 저장 전에 보이는 평문 경고 한 줄(Google Drive 같은 도구가 올리면 암호화되지 않는다), 오른쪽 끝의 [Cancel]·[Save]다. 같이 보는 폴더는 이름 칸 없이 path만 있다.",
      render: () => <SettingsSyncEdit />,
    },
    {
      id: "settings-sync-refused",
      title: "Settings · Sync · folder refused",
      description:
        "core가 폴더를 거절했다(data root 안, 겹침, 예약된 이름). 거절한 이유가 form 안에 그대로 보이고 아무것도 저장되지 않았다.",
      render: () => <SettingsSyncRefused />,
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
      id: "settings-browser-logins",
      title: "Settings · Browser · logins",
      description:
        "Logins 구역이다. login은 browser profile마다 묶여(기본이 먼저) 묶음 이름 아래 줄마다 서고 password·TOTP가 있는지만 보인다. 값은 [Set password]·[Set TOTP]가 여는 보호 입력 창으로만 넣는다. 묶음마다 [Add login]이 있고 login은 다른 profile로 옮기지 못한다.",
      render: () => (
        <SettingsFrame
          pane="browser"
          browser={WITH_PROFILES}
          steps={[scrollToSection("[data-login-group]")]}
        />
      ),
    },
    {
      id: "settings-browser-login-add",
      title: "Settings · Browser · add a login",
      description:
        "[Add login]을 눌러 입력 칸(Label, Site, Username, Note)이 열렸다. Site는 주소를 쳐도 origin(scheme, host, port)만 저장한다.",
      render: () => <SettingsBrowserLoginAdd />,
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
      id: "settings-machine-picker",
      title: "Settings · Pick a computer",
      description:
        'Settings 왼쪽 목록 맨 위의 기계 고르기(다른 컴퓨터가 명단에 있을 때만 선다)에서 Home server를 고른 상태다. 꺼진 컴퓨터(Laptop)는 고를 수 없다. 그 기계의 core에 걸린 항목(General, Providers, Agents, Tools and skills, Shell rules, Diagnostics)만 서고 나머지 항목은 "이 컴퓨터의 설정" 한 줄과 [This computer\'s settings]다. 본문은 그 기계의 설정을 읽고 쓰고, provider key는 보호 입력 창으로 그 기계에 넣는다.',
      render: () => <SettingsMachineScene granted />,
    },
    {
      id: "settings-machine-no-grant",
      title: "Settings · Pick a computer · not allowed",
      description:
        "이 컴퓨터가 그 기계에서 터미널 입력을 허락받지 못한 상태. 항목을 열 때마다 묻고, 막히면 본문 자리에 까닭과 허락을 켜는 곳(Settings › Remote › My devices) 한 줄이 선다. 이 컴퓨터의 설정은 그대로 쓸 수 있다.",
      render: () => <SettingsMachineScene granted={false} />,
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
