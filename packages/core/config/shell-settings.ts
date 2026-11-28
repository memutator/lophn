// shell의 화면 설정 선언. 화면의 이름과 설명 문구는 settingWordingKey가 key에서 만들고, 여기 description은
// `lophn settings get`과 agent가 읽는 영어 설명이다.
// 고르는 값의 목록과 뜻 검사는 shell과 같은 규칙을 쓴다: 모양은 packages/design(appearance, themes),
// 단축키는 packages/protocol/shell/keybindings.ts다. 그래서 틀린 값은 바꾼 쪽이 그 자리에서 이유를 받는다.
// shell은 CSS를 만들 때 같은 규칙으로 한 번 더 검사한다(앱 화면에 들어가는 CSS의 경계다).
import { z } from "zod";
import {
  ACCENT_FROM_THEME,
  CODE_FONTS,
  DENSITIES,
  FONT_WEIGHTS,
  FONTS,
  isFontName,
  MODES,
  READING_FONTS,
  TEXT_SIZES,
} from "../../design/appearance.ts";
import {
  BUILT_IN_THEMES,
  type BrokenReason,
  loadThemes,
  type Mode,
  THEME_PATHS,
  type ThemeProblem,
  type Themes,
} from "../../design/themes.ts";
import {
  declareSetting,
  declareSettingFolder,
  SETTING_ENTRY_ID,
  type SettingIssue,
  type SettingsView,
} from "../../protocol/config/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  remoteAddressesSchema,
  remoteDeviceSchema,
} from "../../protocol/remote/frames.ts";
import { BROWSER_SHARE_SETTING } from "../../protocol/secrets/browser-vault.ts";
import {
  BROWSER_SEARCH_ENGINE_CUSTOM_SETTING,
  BROWSER_SEARCH_ENGINE_SETTING,
  CUSTOM_SEARCH_URL_MAX,
  DEFAULT_SEARCH_ENGINE,
  isValidCustomSearchUrl,
  SEARCH_ENGINE_IDS,
} from "../../protocol/shell/browser-search.ts";
import {
  bindingId,
  isChordText,
  KEYBINDINGS,
  parseBindingId,
} from "../../protocol/shell/keybindings.ts";

const reject = (message: string): SettingIssue => ({
  level: "reject",
  message,
});
const note = (message: string): SettingIssue => ({ level: "note", message });
const oneOf = <T extends string>(list: readonly T[]) =>
  z.enum(list as readonly [T, ...T[]]);

const modeSetting = declareSetting({
  key: "shell.mode",
  type: oneOf(MODES),
  default: "system",
  description:
    "Light or dark. `system` follows the OS. The mode picks which of shell.light_theme and shell.dark_theme is shown.",
});

const BROKEN_THEME: Readonly<Record<BrokenReason, string>> = {
  bad_id: "the id must be lowercase letters, digits and `-` (1 to 64)",
  too_large: "the theme is larger than 256 KB",
  not_json: "the theme is not JSON",
  bad_shape:
    "the shape is wrong: name is nonblank text up to 64, mode is light or dark, extends is a theme id, colors is an object",
  no_mode: "give `mode` (light or dark) or `extends` (a theme id)",
  unknown_extends: "`extends` names a theme that does not exist",
  extends_cycle: "`extends` loops back to this theme",
  id_taken: "a built-in theme already has this id",
};

function problemText(problem: ThemeProblem): string {
  switch (problem.kind) {
    case "unknown_path":
      return `colors.${problem.path} is not a color token and was ignored`;
    case "bad_value":
      return `colors.${problem.path} is not a hex color and was ignored`;
    case "contrast":
      return `low contrast: ${problem.foreground} on ${problem.background} is ${problem.ratio.toFixed(2)}:1, needs ${problem.minimum}:1`;
  }
}

// 색 theme. 항목 하나가 한 모드의 theme이고 `<data root>/themes/<id>.json`이다. 모양과 상속은 design의 loadThemes가 본다.
// 쓸 수 없는 theme은 거절하고, 버린 색과 모자란 대비는 쓰되 알린다(사람이 일부러 적은 색을 막지 않는다).
export const themesSetting = declareSettingFolder({
  key: "shell.themes",
  folder: "themes",
  type: z.record(z.string(), z.json()),
  description:
    "Color themes the person or an agent added. One entry is one theme for one mode: " +
    '{ "name"?: text, "mode"?: "light" | "dark", "extends"?: <theme id>, "colors": { "<color token>": "<hex>" } }. ' +
    "Give mode or extends (mode then follows the parent). Colors left out come from the parent, else from the default theme of that mode, so a few lines are a full theme. " +
    "Hex is #rgb, #rrggbb or #rrggbbaa. Setting an entry answers with notes for ignored colors and low contrast pairs; fix them and set it again. " +
    "To use a theme set shell.light_theme or shell.dark_theme to its id. " +
    `Built-in theme ids (usable in extends, not as an entry id): ${BUILT_IN_THEMES.map((theme) => `${theme.id} (${theme.mode})`).join(", ")}. ` +
    `Color tokens: ${THEME_PATHS.join(", ")}.`,
  check(_value, view, id): readonly SettingIssue[] {
    const themes = themesOf(view);
    const broken = themes.broken.find((one) => one.id === id);
    if (broken !== undefined) return [reject(BROKEN_THEME[broken.reason])];
    const theme = themes.list.find((one) => one.id === id);
    return (theme?.problems ?? []).map((problem) => note(problemText(problem)));
  },
});

function themesOf(view: SettingsView): Themes {
  return loadThemes(
    Object.entries(view.entries(themesSetting)).map(([id, value]) => ({
      id,
      text: JSON.stringify(value),
    })),
  );
}

// 고른 theme이 있고 그 모드의 것인지 본다. file을 손으로 지워 없어진 id는 shell이 기본 theme으로 그린다.
const themeCheck =
  (mode: Mode) =>
  (id: string, view: SettingsView): readonly SettingIssue[] => {
    const list = themesOf(view).list.filter((theme) => theme.mode === mode);
    return list.some((theme) => theme.id === id)
      ? []
      : [
          reject(
            `no ${mode} theme has the id ${id}. ${mode} themes: ${list.map((theme) => theme.id).join(", ")}`,
          ),
        ];
  };
const themeId = z.string().regex(SETTING_ENTRY_ID);
const lightThemeSetting = declareSetting({
  key: "shell.light_theme",
  type: themeId,
  default: "warm-light",
  description:
    "The color theme used in light mode: the id of a built-in light theme or of a shell.themes entry whose mode is light.",
  check: themeCheck("light"),
});
const darkThemeSetting = declareSetting({
  key: "shell.dark_theme",
  type: themeId,
  default: "warm-dark",
  description:
    "The color theme used in dark mode: the id of a built-in dark theme or of a shell.themes entry whose mode is dark.",
  check: themeCheck("dark"),
});

// `theme`이면 고른 theme의 accent, 아니면 사람이 고른 색 하나다. 나머지 색은 shell이 대비에 맞춰 만든다.
const accentSetting = declareSetting({
  key: "shell.accent",
  type: z.union([
    z.literal(ACCENT_FROM_THEME),
    z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ]),
  default: ACCENT_FROM_THEME,
  description:
    "The accent color (primary buttons, focus ring, selection). `theme` uses the accent of the chosen theme; a #rrggbb color overrides it, and lophn shifts its lightness to keep contrast.",
});

// Custom 글꼴 이름은 CSS 문자열에 들어간다. 빈 값은 "고르지 않음"이다.
const fontName = z.string().max(64);
const fontNameCheck = (name: string): readonly SettingIssue[] =>
  name === "" || isFontName(name)
    ? []
    : [
        reject(
          "a font family name is letters, digits, spaces, `-` and `_` (1 to 64)",
        ),
      ];
const CUSTOM_FONT =
  "An installed font family name. It is used when the matching font setting is `custom`; a name that is not installed falls back to the default font.";
const FONT_WEIGHT =
  "The body weight (CSS font-weight) of that font. Emphasis and headings stay bolder.";

const fontSetting = declareSetting({
  key: "shell.font",
  type: oneOf(FONTS),
  default: "pretendard",
  description:
    "The UI font. `custom` uses the family in shell.font_custom (set that first).",
});

const fontCustomSetting = declareSetting({
  key: "shell.font_custom",
  type: fontName,
  default: "",
  description: CUSTOM_FONT,
  check: fontNameCheck,
});

const fontWeightSetting = declareSetting({
  key: "shell.font_weight",
  type: oneOf(FONT_WEIGHTS),
  default: "400",
  description: FONT_WEIGHT,
});

const codeFontSetting = declareSetting({
  key: "shell.code_font",
  type: oneOf(CODE_FONTS),
  default: "jetbrains-mono",
  description:
    "The font of code, the editor and terminals. `custom` uses the family in shell.code_font_custom. An open terminal keeps its font; new terminals use the new one.",
});

const codeFontCustomSetting = declareSetting({
  key: "shell.code_font_custom",
  type: fontName,
  default: "",
  description: CUSTOM_FONT,
  check: fontNameCheck,
});

const codeFontWeightSetting = declareSetting({
  key: "shell.code_font_weight",
  type: oneOf(FONT_WEIGHTS),
  default: "400",
  description: FONT_WEIGHT,
});

const readingFontSetting = declareSetting({
  key: "shell.reading_font",
  type: oneOf(READING_FONTS),
  default: "ui",
  description:
    "The font of documents and agent conversations. `ui` follows shell.font, `serif` is the OS serif, `custom` uses the family in shell.reading_font_custom.",
});

const readingFontCustomSetting = declareSetting({
  key: "shell.reading_font_custom",
  type: fontName,
  default: "",
  description: CUSTOM_FONT,
  check: fontNameCheck,
});

const readingFontWeightSetting = declareSetting({
  key: "shell.reading_font_weight",
  type: oneOf(FONT_WEIGHTS),
  default: "400",
  description: FONT_WEIGHT,
});

const textSizeSetting = declareSetting({
  key: "shell.text_size",
  type: oneOf(TEXT_SIZES),
  default: "default",
  description: "The size of all text in lophn.",
});

const readingWidthSetting = declareSetting({
  key: "shell.reading_width",
  type: z.enum(["narrow", "default", "wide"]),
  default: "default",
  description: "The column width of documents and agent conversations.",
});

const densitySetting = declareSetting({
  key: "shell.density",
  type: oneOf(DENSITIES),
  default: "comfortable",
  description:
    "How tightly controls, rows and panes are spaced. `compact` fits more on screen.",
});

// key는 packages/core/terminal-agents/bridge/policy.ts와 packages/shell/main/desktop/terminal-link.ts의 LINK_SETTING_KEYS와
// 같은 글자여야 한다(shell은 core를 import하지 못해 사본을 둔다).
const LINKS =
  "`browser_tab` opens it in a lophn browser tab, `system_browser` in the OS browser.";
const webLinksSetting = declareSetting({
  key: "shell.browser.web_links",
  type: z.enum(["browser_tab", "system_browser"]),
  default: "browser_tab",
  description: `Where a web link clicked in a terminal opens. ${LINKS}`,
});

const localLinksSetting = declareSetting({
  key: "shell.browser.local_links",
  type: z.enum(["browser_tab", "system_browser"]),
  default: "browser_tab",
  description: `Where a localhost link clicked in a terminal opens. ${LINKS}`,
});

const searchEngineSetting = declareSetting({
  key: BROWSER_SEARCH_ENGINE_SETTING,
  type: oneOf(SEARCH_ENGINE_IDS),
  default: DEFAULT_SEARCH_ENGINE,
  description:
    "Search engine used when the person enters a search query in the browser tab address bar. `custom` uses shell.browser.search_engine_custom (falls back to google if empty or invalid).",
});

const searchEngineCustomSetting = declareSetting({
  key: BROWSER_SEARCH_ENGINE_CUSTOM_SETTING,
  type: z.string().max(CUSTOM_SEARCH_URL_MAX),
  default: "",
  description:
    "Custom search URL template used when shell.browser.search_engine is `custom`. Must be an http:// or https:// URL containing `%s` for the encoded query, or empty.",
  check: (value): readonly SettingIssue[] =>
    value === "" || isValidCustomSearchUrl(value)
      ? []
      : [
          reject(
            "a custom search URL must start with http:// or https:// and contain `%s`",
          ),
        ],
});

// 사람이 바꾼 작업대 단축키. OS마다 따로다(macOS는 Cmd, 다른 OS는 Ctrl). key 상한 160은
// 사람이 단 앱 단축키 id(`app.panel:<app>:<surface>`)가 들어가는 길이, 항목 수 256은 표(약 90줄)에 앱 단축키가 더해지는 수다.
// binding id와 chord 글자는 shell과 같은 규칙(parseBindingId, isChordText)으로 본다. shell은 읽을 때 모르는 것을 버린다.
const overrides = z
  .record(z.string().max(160), z.array(z.string().max(64)).max(4))
  .refine((value) => Object.keys(value).length <= 256);
const keybindingsSetting = declareSetting({
  key: "shell.keybindings",
  type: z.object({ mac: overrides, other: overrides }).partial(),
  default: {},
  description:
    "Keyboard shortcuts the person changed, per platform: `mac` is macOS, `other` is Linux and Windows. " +
    "Each is { <binding id>: [<chord>, up to 4] }; an empty list removes the default key and an id left out keeps it. " +
    "A value replaces the whole setting, so read it first and send back every changed id of both platforms. " +
    "A chord is modifiers (Ctrl, Cmd, Alt, Shift) and one key code joined by `+`, e.g. Ctrl+Shift+KeyT; two strokes separated by a space make a sequence (Ctrl+KeyK Ctrl+KeyS). " +
    "Key codes: KeyA..KeyZ, Digit0..Digit9, F1..F12, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home, End, Tab, Enter, Space, Escape, Backspace, Delete, Insert, " +
    "Backquote, Backslash, BracketLeft, BracketRight, Comma, Period, Slash, Semicolon, Quote, Minus, Equal. " +
    "Two bindings with the same key in the same place are not rejected here; the earlier one wins, so check the defaults below. " +
    `Binding ids and their default keys (other | mac): ${KEYBINDINGS.map((binding) => `${bindingId(binding)} (${binding.other.join(", ") || "none"} | ${binding.mac.join(", ") || "none"})`).join("; ")}.`,
  check(value) {
    const issues: SettingIssue[] = [];
    for (const [platform, table] of Object.entries(value)) {
      for (const [id, chords] of Object.entries(table ?? {})) {
        if (parseBindingId(id) === null) {
          issues.push(
            reject(`${platform}.${id}: there is no binding with this id`),
          );
        }
        const bad = chords.find((chord) => !isChordText(chord));
        if (bad !== undefined) {
          issues.push(reject(`${platform}.${id}: \`${bad}\` is not a chord`));
        }
      }
    }
    return issues;
  },
});

// 왼쪽 sidebar 빠른 실행의 전역 값. 모양은 workspace layout의 `quick`과 같고(packages/shell/main/workspace/workspace-layout.ts),
// workspace가 자기 `quick`을 두지 않으면 이 값을 쓴다. 모르는 id와 없어진 앱은 shell이 그릴 때 건너뛴다.
export const quickLaunchSetting = declareSetting({
  key: "shell.quick_launch",
  type: z.object({
    order: z.array(z.string().min(1).max(200)).max(64),
    apps: z
      .array(
        z.object({
          app: z.string().min(1).max(64),
          surface: z.string().min(1).max(128),
        }),
      )
      .max(20),
    // 끈 단추 id. 순서에는 남아 다시 켜면 그 자리로 돌아온다.
    hidden: z.array(z.string().min(1).max(200)).max(64).optional(),
  }),
  default: { order: [], apps: [] },
  description:
    "The quick launch buttons of the left sidebar, for workspaces that have no own list: `order` is the button ids in order, `apps` the app screens added as buttons, `hidden` the ids turned off. Unknown ids and removed apps are skipped.",
});

// 앱 panel 화면(`<app>:<surface>`)마다 여는 자리와 마지막 float 자리·크기(stage 기준 CSS px).
const floatRect = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export const appLaunchSetting = declareSetting({
  key: "shell.app_launch",
  type: z
    .record(
      z.string().min(1).max(200),
      z.object({ open: z.enum(["dock", "float"]), rect: floatRect.optional() }),
    )
    .refine((value) => Object.keys(value).length <= 200),
  default: {},
  description:
    "Per app panel screen (`<app>:<surface>`): whether it opens docked or as a float, and the last float position and size. lophn writes this when the person moves a float.",
});

// coding agent 즐겨찾기(빠른 실행 Terminal hover와 workspace +의 hover 목록에 나온다)와 사람이 바꾼 실행 명령어.
// harness id는 shell이 검사하고 모르는 것은 버린다. 실행 명령어는 사람의 터미널에서 도는 글이라 agent가 바꾸지 못한다.
export const codingAgentsSetting = declareSetting({
  key: "shell.coding_agents",
  type: z.object({
    favorites: z.array(z.string().min(1).max(64)).max(64),
    commands: z
      .record(z.string().min(1).max(64), z.string().min(1).max(500))
      .refine((value) => Object.keys(value).length <= 64),
  }),
  default: { favorites: ["claude", "codex", "opencode"], commands: {} },
  description:
    "Coding agents in the terminal: `favorites` is the harness ids shown in the quick launch and the new tab menu, `commands` replaces the command line that starts a harness (harness id to command). Unknown harness ids are skipped. It holds command lines the person's terminal runs, so only the person changes it.",
  locked: true,
});

// workspace 창 맨 아래 작업 표시줄. 끄면 float chip이 tab 줄 끝에 있다.
const taskbarSetting = declareSetting({
  key: "shell.taskbar",
  type: z.boolean(),
  default: true,
  description:
    "Show the taskbar at the bottom of a workspace window. When off, float chips sit at the end of the tab strip.",
});

// 사람이 등록한 기기. preview 탭이 이 크기·DPR로 emulation하고 `tab open --preview --device <name>`이 이름으로 찾는다.
// remote pairing이 등록한 폰도 같은 항목으로 든다. 그래서 항목 모양은 remote의 기기 schema에 `device`(기기 id)를 더한 것이다.
// remote는 `device`가 그 기기인 항목만 고치고 지운다. 사람이 넣은 항목(`device`가 없다)은 건드리지 않는다.
// 크기 범위는 shell main의 emulation 입력 검사(packages/shell/ipc/surface.ts)와 같아야 한다(shell은 core를 import하지 못한다).
export const devicesSetting = declareSetting({
  key: "shell.devices",
  type: z
    .array(remoteDeviceSchema.extend({ device: idSchema("dev").optional() }))
    .max(32)
    .refine((list) => new Set(list.map((d) => d.name)).size === list.length),
  default: [],
  description:
    "Devices for app previews: each has a name, a viewport size in CSS px, a pixel ratio and an OS. `lophn tab open --preview <app> --device <name>` and the preview tab use them. Names are unique. Entries added by phone pairing also carry `device`, the paired device id; renaming or removing that device changes only its entry.",
});

// browser profile 정의와 저장 login(값 포함)을 명단의 다른 컴퓨터와 link로 맞출지. 끄면 이 컴퓨터는 내주지도 받지도 않는다.
// 사람의 login 값이 기계를 떠나는 일이라 사람만 바꾼다.
export const browserShareSetting = declareSetting({
  key: BROWSER_SHARE_SETTING,
  type: z.boolean(),
  default: true,
  description:
    "Keep browser profiles (name, color) and saved site logins, passwords and TOTP seeds included, the same on the person's other paired computers. They travel only over the encrypted link between paired computers, never through a shared folder. Cookies and site data stay on each computer. When off, this computer neither sends nor receives them.",
  locked: true,
});

// 폰이 붙는 remote listener. 켜면 core가 모든 interface의 이 port에서 듣고, 켜 있는 동안 idle-exit로 끝나지 않는다.
// 집 밖 network에 port를 여는 일이라 사람만 바꾼다.
export const remoteEnabledSetting = declareSetting({
  key: "remote.enabled",
  type: z.boolean(),
  default: false,
  description:
    "Lets paired phones connect to this computer. When on, lophn listens on `remote.port` on every network interface and does not exit when idle.",
  locked: true,
});

export const remotePortSetting = declareSetting({
  key: "remote.port",
  type: z.number().int().min(1024).max(65535),
  default: 7432,
  description:
    "The port the phone connection listens on when `remote.enabled` is on.",
  locked: true,
});

// 사람이 적는 이 컴퓨터의 주소(domain이나 IP). interface에 붙지 않는 공인 주소(VM)나 이름으로 닿는 곳을 폰에 알린다.
// QR과 hello의 주소 후보에서 interface 주소 앞에 선다. 폰이 거는 곳이라 agent의 바꾸기는 사람의 승인이다(승인 카드가 줄을 그대로 보인다).
function describeAddresses(
  before: string[] | undefined,
  after: string[] | undefined,
): string[] {
  const was = before ?? [];
  const now = after ?? [];
  const lines = [
    ...now
      .filter((one) => !was.includes(one))
      .map((one) => `Add address ${one}`),
    ...was
      .filter((one) => !now.includes(one))
      .map((one) => `Remove address ${one}`),
  ];
  return lines.length > 0 || was.join() === now.join()
    ? lines
    : [`Reorder addresses: ${now.join(", ")}`];
}

export const remoteAddressesSetting = declareSetting({
  key: "remote.addresses",
  type: remoteAddressesSchema,
  default: [],
  description:
    "Extra addresses (host names or IP addresses, no port) where paired phones and other computers can reach this computer, such as a VM's public address or a Tailscale name. They are offered before this computer's own network addresses when `remote.enabled` is on. When you change it, the person is asked to allow that exact change.",
  approval: "person",
  describe: describeAddresses,
});

// 폰이 다른 network에서 붙는 relay. 기본은 lophn이 Fly.io에 띄운 relay다. 비우면 relay를 쓰지 않는다.
// 밖의 server에 core를 거는 일이라 사람만 바꾼다.
export const remoteRelaySetting = declareSetting({
  key: "remote.relay",
  type: z.union([
    z.literal(""),
    z
      .string()
      .url()
      .regex(/^wss?:\/\/.*[^/]$/),
  ]),
  default: "wss://lophn-relay.fly.dev",
  description:
    "The relay (`wss://host`, no trailing slash) that lets paired phones reach this computer from another network when `remote.enabled` is on. Empty means no relay.",
  locked: true,
});

export const remoteHubSetting = declareSetting({
  key: "remote.hub",
  type: z.boolean(),
  default: false,
  description:
    "When true, this computer embeds a relay endpoint on its remote port and holds encrypted/signed carry and custody traffic for offline roster computers and phones.",
  locked: true,
});

export const terminalOsc52ClipboardSetting = declareSetting({
  key: "shell.terminal.osc52_clipboard",
  type: z.boolean(),
  default: true,
  description:
    "Allow programs running inside a terminal tab to write to the local OS clipboard via OSC 52 escape sequences.",
});

export const syncAppPoliciesSetting = declareSetting({
  key: "sync.app_policies",
  type: z.record(z.string(), z.enum(["default", "computers", "local"])),
  default: {},
  description:
    "Per-app data sync policy override on this computer (`default` follows the app declaration, `computers` syncs between computers, `local` stays on this computer).",
});

// 폰 알림(push)을 보내는 Expo Push 주소. 비우면 push를 끈다. Expo가 아닌 곳을 가리키면 글(제목과 상태 문장)이
// 그곳으로 가므로 사람만 바꾼다. 영수증 주소는 끝의 `/send`를 `/getReceipts`로 바꿔 만든다.
export const remotePushSetting = declareSetting({
  key: "remote.push",
  type: z.union([
    z.literal(""),
    z
      .string()
      .url()
      .regex(/^https?:\/\//),
  ]),
  default: "https://exp.host/--/api/v2/push/send",
  description:
    "The Expo Push send URL that phone notifications go through. Empty turns push off. If you point it anywhere other than Expo, the notification text (the title and the status sentence) is sent there.",
  locked: true,
});

// 설치된 앱의 `sidebar` 자리 화면은 선언하면 오른쪽 sidebar에 panel로 나온다. 사람이 끈 것만 여기에 쌓인다.
export const sidebarPanelsOffSetting = declareSetting({
  key: "shell.sidebar_panels_off",
  type: z
    .array(
      z.object({
        app: z.string().min(1).max(64),
        screen: z.string().min(1).max(128),
      }),
    )
    .max(20),
  default: [],
  description:
    "App screens of the right sidebar that the person turned off. A screen not listed here is shown.",
});

// 설치된 앱의 `tray` 자리 화면은 선언하면 작업 표시줄 오른쪽 tray에 항목으로 나온다. 사람이 끈 것만 여기에 쌓인다.
export const trayOffSetting = declareSetting({
  key: "shell.tray_off",
  type: z
    .array(
      z.object({
        app: z.string().min(1).max(64),
        screen: z.string().min(1).max(128),
      }),
    )
    .max(20),
  default: [],
  description:
    "App tray items of the taskbar that the person turned off. An item not listed here is shown.",
});

// tray 항목의 순서. 여기 든 화면이 이 순서로 먼저 서고, 없는 화면은 그 뒤에 선언 순서로 선다.
export const trayOrderSetting = declareSetting({
  key: "shell.tray_order",
  type: z
    .array(
      z.object({
        app: z.string().min(1).max(64),
        screen: z.string().min(1).max(128),
      }),
    )
    .max(64),
  default: [],
  description:
    "The order of app tray items. Screens listed here come first in this order; the rest follow in declaration order.",
});

export const shellSettings = [
  modeSetting,
  lightThemeSetting,
  darkThemeSetting,
  accentSetting,
  fontSetting,
  fontCustomSetting,
  fontWeightSetting,
  codeFontSetting,
  codeFontCustomSetting,
  codeFontWeightSetting,
  readingFontSetting,
  readingFontCustomSetting,
  readingFontWeightSetting,
  textSizeSetting,
  readingWidthSetting,
  densitySetting,
  webLinksSetting,
  localLinksSetting,
  searchEngineSetting,
  searchEngineCustomSetting,
  keybindingsSetting,
  quickLaunchSetting,
  appLaunchSetting,
  codingAgentsSetting,
  taskbarSetting,
  devicesSetting,
  browserShareSetting,
  remoteEnabledSetting,
  remotePortSetting,
  remoteAddressesSetting,
  remoteRelaySetting,
  remoteHubSetting,
  remotePushSetting,
  terminalOsc52ClipboardSetting,
  syncAppPoliciesSetting,
  sidebarPanelsOffSetting,
  trayOffSetting,
  trayOrderSetting,
] as const;

// 항목마다 file 하나인 설정 묶음.
export const shellSettingFolders = [themesSetting] as const;
