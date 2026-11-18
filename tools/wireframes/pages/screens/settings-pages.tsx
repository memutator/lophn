// Settings의 새 설계 page. 모두 인자 없이 한 상태를 그린다.

import { SettingsFrame } from "./settings-frame.tsx";
import { click, find, press, type, wait } from "../../mock/drive.ts";
import type { Bookmark } from "../../../../packages/shell/ipc/browser.ts";
import { appPanelBindingId } from "../../../../packages/protocol/shell/keybindings.ts";
import { APP_BUDGET } from "../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { sampleSyncMachines } from "../../../../packages/shell/renderer/desktop/settings/sync/testdata/fake-source.ts";
import { sampleDevices } from "../../../../packages/shell/renderer/desktop/settings/remote/testdata/fake-source.ts";

/** Settings 머리의 [Back]. 누르면 Settings를 열기 전 화면으로 돌아간다. */
export const SettingsBack = () => <SettingsFrame pane="agents" />;

/** Settings › General. */
export const SettingsGeneral = () => <SettingsFrame pane="general" />;

/** Settings › General: 필수 설정이 비어 그 기능만 시작하지 않는 상태. 알림은 탭 위쪽 toast다. */
export const SettingsRequiredEmpty = () => (
  <SettingsFrame pane="general" requiredEmpty />
);

/** Settings › Appearance. */
export const SettingsAppearance = () => <SettingsFrame pane="appearance" />;

// 처음 값과 다르게 고른 것. Cool(light)·Tokyo Night(dark) theme, Purple accent, System UI, 설치된 코드 글꼴(D2Coding Bold),
// Serif 본문, Large, Compact다.
const PRESETS = {
  light_theme: "cool-light",
  dark_theme: "tokyo-night",
  accent: "#6b3fc4",
  font: "system",
  code_font: "custom",
  code_font_custom: "D2Coding",
  code_font_weight: "700",
  reading_font: "serif",
  text_size: "large",
  density: "compact",
} as const;

/** Settings › Appearance: preset을 바꾼 상태(Light). 화면 전체가 고른 색·글꼴·크기로 바뀐다. */
export const SettingsAppearancePresets = () => (
  <SettingsFrame pane="appearance" appearance={{ ...PRESETS, mode: "light" }} />
);

/** Settings › Appearance: preset을 바꾼 상태(Dark). */
export const SettingsAppearancePresetsDark = () => (
  <SettingsFrame pane="appearance" appearance={{ ...PRESETS, mode: "dark" }} />
);

/**
 * Settings › Appearance: light theme으로 theme file(Pastel)을 고른 상태. 그 file의 문제(모르는 색 이름, 대비가 모자란
 * 글자)가 줄 아래에 보이고, 읽을 수 없는 file(draft.json)은 Themes folder 줄 아래에 이유와 함께 보인다.
 */
export const SettingsAppearanceThemeFile = () => (
  <SettingsFrame
    pane="appearance"
    appearance={{ mode: "light", light_theme: "pastel" }}
  />
);

/** Settings › Appearance: UI 글꼴 칸을 열고 검색 칸에 "no"를 쳐 설치된 글꼴을 거른 상태. */
export const SettingsAppearanceFontSearch = () => (
  <SettingsFrame
    pane="appearance"
    appearance={{}}
    steps={[
      () => click('[data-appearance-row="font"] button[aria-haspopup]'),
      () => type('input[type="search"]', "no"),
    ]}
  />
);

/** Settings › Appearance: 저장된 코드 글꼴이 이 컴퓨터에 없어 그 이름에 Not installed가 붙은 상태. */
export const SettingsAppearanceFontMissing = () => (
  <SettingsFrame
    pane="appearance"
    appearance={{ code_font: "custom", code_font_custom: "Berkeley Mono" }}
    steps={[
      () => click('[data-appearance-row="code_font"] button[aria-haspopup]'),
    ]}
  />
);

/** Settings › Coding agents. */
export const SettingsCoding = () => <SettingsFrame pane="coding" />;

/** Settings › Shell rules. */
export const SettingsShellRules = () => <SettingsFrame pane="shell-rules" />;

/** Settings › Shell rules: Global 절의 더하기 줄에 pattern을 치고 Ask를 고른 상태. */
export const SettingsShellRulesAdd = () => (
  <SettingsFrame
    pane="shell-rules"
    steps={[
      () =>
        type('[data-layer="global"] [data-add-rule] input', "npm publish *"),
      () =>
        press('[data-layer="global"] [data-add-rule] button[role="combobox"]'),
      () => click('[role="option"]', "Ask"),
    ]}
  />
);

/** Settings › Diagnostics. */
export const SettingsDiagnostics = () => <SettingsFrame pane="diagnostics" />;

const icon = (fill: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='14' height='14' rx='3' fill='%23${fill}'/%3E%3C/svg%3E`;
const mark = (
  n: number,
  title: string,
  url: string,
  favicon?: string,
): Bookmark => ({
  id: `bookmark-${n}`,
  title,
  url,
  created_at: "2026-10-19T00:00:00.000Z",
  ...(favicon === undefined ? {} : { favicon }),
});
// 셋째는 favicon이 없어 Globe로 보인다.
const BOOKMARKS: Bookmark[] = [
  mark(1, "Deno", "https://deno.com/", icon("1f2937")),
  mark(2, "MDN Web Docs", "https://developer.mozilla.org/", icon("2563eb")),
  mark(3, "Grocery dev server", "http://localhost:5173/"),
];

/** Settings › Browser: Bookmarks, Links, Devices(등록한 기기가 없다)와 Browsing data([Clear browsing data]). */
export const SettingsBrowser = () => (
  <SettingsFrame pane="browser" browser={{ bookmarks: BOOKMARKS }} />
);

/** Settings › Browser: Devices 구역에 기기 둘이 등록되어 있다. 줄마다 크기·DPR·OS와 [Edit], [Remove]가 있다. */
export const SettingsBrowserDevices = () => (
  <SettingsFrame
    pane="browser"
    browser={{
      bookmarks: BOOKMARKS,
      devices: [
        { name: "iPhone 15", width: 390, height: 844, dpr: 3, os: "ios" },
        { name: "Pixel 8", width: 412, height: 915, dpr: 2.6, os: "android" },
      ],
    }}
  />
);

/** Settings › Browser: [Add device]를 눌러 기기 입력 칸이 열린 상태. 처음 값은 iPhone 크기다. */
export const SettingsBrowserDeviceAdd = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS }}
    steps={[() => click("[data-device-add]")]}
  />
);

const LOGINS = [
  {
    id: "lgn_fake0",
    label: "GitHub",
    origin: "https://github.com",
    username: "dev@example.com",
    note: "",
    password: true,
    totp: true,
  },
  {
    id: "lgn_fake1",
    label: "Staging admin",
    origin: "http://localhost:3000",
    username: "admin",
    note: "",
    password: false,
    totp: false,
  },
];

/** Settings › Browser: Logins 구역에 login 둘이 있다. 줄마다 password·TOTP 유무와 [Set password], [Set TOTP], [Edit], [Delete]가 있다. */
export const SettingsBrowserLogins = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS, logins: LOGINS }}
  />
);

/** Settings › Browser: [Add login]을 눌러 입력 칸(Label, Site, Username, Note)이 열린 상태. */
export const SettingsBrowserLoginAdd = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS, logins: LOGINS }}
    steps={[() => click("[data-login-add]")]}
  />
);

/** Settings › Keyboard. 바꾼 키가 없다. section(Tabs, Splits, ...)마다 제목 아래 줄이 서고 키 없는 줄은 흐린 Not set이다. */
export const SettingsKeyboard = () => <SettingsFrame pane="keyboard" />;

/** Settings › Keyboard: 탭 닫기를 바꾸고 sidebar 키를 뺀 뒤, Open a file에 이미 쓰는 키를 눌러 [Replace]·[Cancel]을 묻는 상태. */
export const SettingsKeyboardChanged = () => (
  <SettingsFrame
    pane="keyboard"
    keyboard={{
      other: { "tab.close": ["Ctrl+Alt+KeyQ"], "sidebar.toggle": [] },
      mac: { "tab.close": ["Cmd+Alt+KeyQ"], "sidebar.toggle": [] },
    }}
    steps={[
      () => click('[data-key-change="files.quick-open"]'),
      async () => {
        const field = await find("[data-key-capture]");
        field.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            code: "Tab",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        // 새 키 칸은 둘째 타를 1.5초 기다린다. 둘째 타가 없는 경우를 기다려 저장 뒤 상태를 그린다.
        await wait(1700);
      },
    ]}
  />
);

/** Settings › Keyboard: 겹친 키가 있는 저장 값. 위에 겹침 수와 [Show conflicts only]가 서고, 겹친 줄에 상대 이름과 [Remove]가 있다. 겹친 것만 보는 상태다. */
export const SettingsKeyboardConflicts = () => (
  <SettingsFrame
    pane="keyboard"
    keyboard={{
      // Rename the tab이 Next tab과 같은 키를, Reveal이 OS 전역 팔레트가 먼저 쓰는 Ctrl+Shift+K를 단 상태다.
      other: {
        "tab.rename": ["Ctrl+Tab"],
        "tab.reveal": ["Ctrl+Shift+KeyK"],
      },
      mac: {
        "tab.rename": ["Ctrl+Tab"],
        "tab.reveal": ["Cmd+Shift+KeyK"],
      },
    }}
    steps={[() => click("[data-key-conflicts-only]")]}
  />
);

/** Settings › Keyboard: 앱 단축키가 달린 저장 값. 앱 panel 화면마다 한 줄이고, 지워진 앱의 키는 "app not found" 줄로 남아 [Remove]만 된다. */
export const SettingsKeyboardApps = () => (
  <SettingsFrame
    pane="keyboard"
    keyboard={{
      other: {
        [appPanelBindingId(APP_BUDGET, "home")]: ["Ctrl+Alt+KeyG"],
        [appPanelBindingId("app_gone", "main")]: ["Ctrl+Alt+KeyH"],
      },
      mac: {
        [appPanelBindingId(APP_BUDGET, "home")]: ["Cmd+Alt+KeyG"],
        [appPanelBindingId("app_gone", "main")]: ["Cmd+Alt+KeyH"],
      },
    }}
    steps={[
      async () =>
        (await find('[data-key-section="app"]')).scrollIntoView({
          block: "start",
        }),
    ]}
  />
);

/** Settings › Browser: Links 구역. web과 local link 둘 다 Browser tab으로 연다. */
export const SettingsBrowserLinks = () => (
  <SettingsFrame pane="browser" browser={{ bookmarks: BOOKMARKS }} />
);

/** Settings › Browser: web link는 System browser, local link는 Browser tab으로 여는 설정. */
export const SettingsBrowserLinksSystem = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS, links: { web_links: "system_browser" } }}
  />
);

/** Settings › Browser: [Clear browsing data]를 눌러 확인 dialog가 열린 상태. */
export const SettingsBrowserClearData = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS }}
    steps={[() => click("[data-browser-clear]")]}
  />
);

/** Settings › Browser: bookmark 목록. 한 줄은 [Edit]을 눌러 title·URL 입력으로 바뀌었다. */
export const SettingsBrowserBookmarks = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS }}
    steps={[() => click("[data-bookmark-edit]", undefined, 1)]}
  />
);

/** Settings › Browser: bookmarks.json이 깨져 목록 자리에 오류 문장만 있다. 고치는 길은 열지 않는다. */
export const SettingsBrowserBookmarksCorrupt = () => (
  <SettingsFrame pane="browser" browser={{ corrupt: true }} />
);

/** Settings › Extensions: 켜짐(Harness GUI, [Turn off]), 설치했지만 꺼짐(Harness agents, [Turn on]), 설치 안 됨(Demo, [Install]) 세 줄. */
export const SettingsExtensions = () => (
  <SettingsFrame pane="extension-packages" extensions />
);

/** Settings › Extensions: 꺼진 extension의 [Remove]를 눌러 확인 dialog가 열린 상태. 켜져 있으면 먼저 끄라는 글만 보이고 dialog는 열리지 않는다. */
export const SettingsExtensionRemove = () => (
  <SettingsFrame
    pane="extension-packages"
    extensions
    steps={[
      () => click('[data-extension-id="harness"] [data-action="remove"]'),
    ]}
  />
);

/** Settings › Remote: 연결이 켜져 있고 My devices에 다섯(이 컴퓨터 Studio, 컴퓨터 둘은 relay로 붙음·꺼짐, 폰 둘 가운데 iPhone 16은 기준)이 있다. 아래에 Open at start와 Add a device가 있다. */
export const SettingsRemote = () => (
  <SettingsFrame pane="remote" machines={{}} />
);

/** Settings › Remote: "Keep running"과 "Keep this computer awake"가 켜져 있고 OS가 등록됨을 답했다("Starts when you log in"). */
export const SettingsRemoteKeepRunning = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{
      alwaysOn: {
        keepRunning: true,
        keepAwake: true,
        startAtLogin: "registered",
        awake: "held",
      },
    }}
  />
);

/** Settings › Remote: 표시는 켜졌는데 OS 등록이 서지 않았다. 경고와 [Try again]이 있다. */
export const SettingsRemoteLoginFailed = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{
      alwaysOn: { keepRunning: true, startAtLogin: "not_registered" },
    }}
  />
);

/** Settings › Remote: 사람이 OS의 시작 설정에서 껐다. 어디서 바꾸는지와 [Turn on again]이 있다. */
export const SettingsRemoteLoginOff = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{
      alwaysOn: {
        keepRunning: true,
        startAtLogin: "off_in_system",
        mechanism: "launchd",
      },
    }}
  />
);

/** Settings › Remote: 개발 build라 스위치가 disabled이고 이유만 보인다. */
export const SettingsRemoteDevelopment = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{
      alwaysOn: {
        startAtLogin: "unavailable",
        loginReason: "development_build",
        mechanism: null,
      },
    }}
  />
);

/** Settings › Remote: 연결이 꺼져 있어 명단과 더하기 대신 안내 한 줄만 있다. */
export const SettingsRemoteOff = () => (
  <SettingsFrame pane="remote" machines={{}} remote={{ enabled: false }} />
);

/** Settings › Remote: [Invite a phone]을 눌러 QR과 남은 시간(30분), [New invite], 새 기기의 터미널 입력 스위치가 보인다. */
export const SettingsRemoteInvitePhone = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    steps={[() => click("[data-remote-invite-phone]")]}
  />
);

/** Settings › Remote: [Invite a computer]를 누르고 "같은 때 켜질 수 없다"를 켜 7일짜리 초대장이 보인다. "Show as text"를 펼쳤다. */
export const SettingsRemoteInviteComputer = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    steps={[
      () => click("[data-remote-invite-computer]"),
      () => click('[data-remote-row="invite-long"] [role="switch"]'),
      // 스위치가 새 초대장을 내는 동안 "Show as text" 단추가 없다.
      () => wait(300),
      () => click("[data-remote-show-text]"),
    ]}
  />
);

const PASTED_INVITE = '{"invite":{"body":{"type":"invite","kind":"computer"}}}';

/** Settings › Remote: [Join with an invite]에 다른 컴퓨터의 초대장을 붙여 [Join]했는데 수명이 지나 거절되었다. 칸 아래에 이유가 선다. */
export const SettingsRemoteJoinFailed = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{ join: { ok: false, reason: "expired" } }}
    steps={[
      () => click("[data-remote-join-open]"),
      () => type("[data-remote-join-text]", PASTED_INVITE),
      () => click("[data-remote-join-send]"),
    ]}
  />
);

/** Settings › Remote: 초대한 컴퓨터가 답했지만 판이 어긋나 거절되었다. 칸 아래에 어느 쪽 lophn을 올릴지(여기는 그 컴퓨터)가 선다. 명단에는 아무것도 남지 않는다. */
export const SettingsRemoteJoinUpdate = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{ join: { ok: false, reason: "update_host" } }}
    steps={[
      () => click("[data-remote-join-open]"),
      () => type("[data-remote-join-text]", PASTED_INVITE),
      () => click("[data-remote-join-send]"),
    ]}
  />
);

/** Settings › Remote: 초대장으로 들었지만 초대한 컴퓨터가 꺼져 있어 기다리는 중이다. 그 컴퓨터를 아는 기기(폰)가 붙으면 끝난다는 글이 선다. */
export const SettingsRemoteJoinPending = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{ join: { ok: true, pending: true } }}
    steps={[
      () => click("[data-remote-join-open]"),
      () => type("[data-remote-join-text]", PASTED_INVITE),
      () => click("[data-remote-join-send]"),
    ]}
  />
);

/** Settings › Remote: 초대한 컴퓨터가 꺼져 있을 때 들어온 Work laptop이 Waiting이다. 그 소식이 닿으면 사라진다. */
export const SettingsRemoteWaiting = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{
      devices: sampleDevices().map((one) =>
        one.name === "Work laptop" ? { ...one, pending: true } : one,
      ),
    }}
  />
);

/** Settings › Remote: 도둑맞은 Travel laptop과 Home server가 서로 뺀 소식이 같이 닿아 둘 다 Disputed다. 믿지 않는 쪽의 Remove를 누르면 다른 쪽이 돌아온다. */
export const SettingsRemoteDisputed = () => (
  <SettingsFrame
    pane="remote"
    machines={{}}
    remote={{
      devices: [
        ...sampleDevices().filter((one) => one.name !== "Home server"),
        ...sampleDevices()
          .filter((one) => one.name === "Home server")
          .map((one) => ({ ...one, disputed: true, lastConnectedAt: null })),
        {
          id: "dev_01jd00000000000000000000x9",
          key: "key-x9",
          kind: "computer" as const,
          name: "Travel laptop",
          os: "windows" as const,
          machine: "mch_travel",
          thisComputer: false,
          lastConnectedAt: null,
          primary: false,
          terminalInput: true,
          pending: false,
          disputed: true,
        },
      ],
    }}
  />
);

/** Settings › Remote: 다른 컴퓨터가 이 컴퓨터를 빼 명단과 key를 버렸다. 명단에는 이 컴퓨터만 남고 위에 그 일을 알리는 한 줄이 선다. */
export const SettingsRemoteRemovedHere = () => (
  <SettingsFrame
    pane="remote"
    machines={{ machines: [] }}
    remote={{
      removedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      devices: sampleDevices().filter((one) => one.thisComputer),
    }}
  />
);

/** Settings › Remote: Open at start가 명단에 없는 기계(옮긴 뒤 아직 다시 들이지 않은 Old laptop)를 가리킨다. "A computer not in your devices"로 보인다. */
export const SettingsRemoteStartMissing = () => (
  <SettingsFrame
    pane="remote"
    machines={{ start: { mode: "machine", machine: "mch_oldlaptop" } }}
  />
);

/** Settings › Remote: 시작 기계(Home server)의 [Remove]를 눌러 확인 dialog가 열렸다. 모든 기계에서 끊기고 그 key로 다시 들지 못하며, 시작 기계라서 한 줄이 더 붙는다. */
export const SettingsRemoteRemove = () => (
  <SettingsFrame
    pane="remote"
    machines={{ start: { mode: "machine", machine: "mch_homeserver" } }}
    steps={[
      () =>
        click(
          '[data-remote-device="dev_01jd0000000000000000000002"] [data-remote-remove]',
        ),
    ]}
  />
);

/** Settings › Sync: 같이 보는 폴더(Google Drive 안) 줄이 맨 위에 서고 이름 붙인 폴더 둘이 있다(같이 보는 폴더는 쓸 수 없고 photos는 폴더가 없다). 컴퓨터는 이 컴퓨터, 직접 붙은 Home server, relay로 붙은 Office desktop, 꺼졌지만 폰이 file을 나른 Work laptop("via your phone"), 꺼진 Old netbook이다. 앱은 몇 분 전, 몇 시간 전, 맞춘 적 없음이다. */
export const SettingsSync = () => (
  <SettingsFrame
    pane="sync"
    machines={{ machines: sampleSyncMachines() }}
    sync={{ sharedState: "not_writable" }}
  />
);

/** Settings › Sync: 같이 보는 폴더도 이름 붙인 폴더도 없고 Remote가 꺼져 있다. 폴더를 고르거나 lophn에게 붙여 달라고 하라는 설명과, Remote를 켜라는 한 줄이 선다. */
export const SettingsSyncEmpty = () => (
  <SettingsFrame
    pane="sync"
    machines={{ machines: [] }}
    sync={{
      shared: null,
      named: [],
      remoteEnabled: false,
      received: [],
      apps: [],
    }}
  />
);

/** Settings › Sync: 이름 붙인 폴더 photos의 [Edit]를 눌러 path를 바꾸는 form. 이름 칸, path 칸과 [Choose…], 저장 전 평문 경고 한 줄이 있다. */
export const SettingsSyncEdit = () => (
  <SettingsFrame
    pane="sync"
    machines={{ machines: sampleSyncMachines() }}
    steps={[
      () => click('[data-sync-row="photos"] [data-sync-edit]'),
      () => type("[data-sync-path]", "/home/me/Pictures/lophn"),
    ]}
  />
);

/** Settings › Sync: 같이 보는 폴더에 data root 안의 path를 저장하려 했더니 core가 거절했다. 거절한 이유가 form 안 [Save] 위에 선다. */
export const SettingsSyncRefused = () => (
  <SettingsFrame
    pane="sync"
    machines={{ machines: sampleSyncMachines() }}
    sync={{
      refuse:
        "the shared folder (/home/me/.lophn/notes) is inside the lophn data folder or contains it",
    }}
    steps={[
      () => click('[data-sync-row="shared"] [data-sync-edit]'),
      () => type("[data-sync-path]", "/home/me/.lophn/notes"),
      () => click("[data-sync-save]"),
    ]}
  />
);
