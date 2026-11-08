// shell이 core에 선언하는 화면 설정 열. 이름과 설명 문구는 settingWordingKey가 key에서 만든다.
// 고르는 값의 목록은 packages/design의 appearance와 같아야 한다(core는 design을 import하지 못한다).
// Custom 글꼴 이름의 글자 규칙은 CSS를 만드는 main이 검사한다. 여기는 길이만 본다.
import { z } from "zod";
import { declareSetting } from "../../protocol/config/mod.ts";
import { extensionSettingKey } from "../../protocol/extensions/mod.ts";

const themeSetting = declareSetting({
  key: "shell.theme",
  type: z.enum(["light", "dark", "system"]),
  default: "system",
});

const accentSetting = declareSetting({
  key: "shell.accent",
  type: z.enum(["ink", "blue", "green", "purple", "orange"]),
  default: "ink",
});

const backgroundSetting = declareSetting({
  key: "shell.background",
  type: z.enum(["warm", "neutral", "cool"]),
  default: "warm",
});

const fontSetting = declareSetting({
  key: "shell.font",
  type: z.enum(["pretendard", "system", "custom"]),
  default: "pretendard",
});

const fontCustomSetting = declareSetting({
  key: "shell.font_custom",
  type: z.string().max(64),
  default: "",
});

// 글꼴마다 고르는 본문 굵기(CSS font-weight). 목록은 packages/design/appearance.ts의 FONT_WEIGHTS와 같다.
const FONT_WEIGHTS = [
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
] as const;

const fontWeightSetting = declareSetting({
  key: "shell.font_weight",
  type: z.enum(FONT_WEIGHTS),
  default: "400",
});

const codeFontSetting = declareSetting({
  key: "shell.code_font",
  type: z.enum(["jetbrains-mono", "system", "custom"]),
  default: "jetbrains-mono",
});

const codeFontCustomSetting = declareSetting({
  key: "shell.code_font_custom",
  type: z.string().max(64),
  default: "",
});

const codeFontWeightSetting = declareSetting({
  key: "shell.code_font_weight",
  type: z.enum(FONT_WEIGHTS),
  default: "400",
});

const readingFontSetting = declareSetting({
  key: "shell.reading_font",
  type: z.enum(["ui", "serif", "custom"]),
  default: "ui",
});

const readingFontCustomSetting = declareSetting({
  key: "shell.reading_font_custom",
  type: z.string().max(64),
  default: "",
});

const readingFontWeightSetting = declareSetting({
  key: "shell.reading_font_weight",
  type: z.enum(FONT_WEIGHTS),
  default: "400",
});

const textSizeSetting = declareSetting({
  key: "shell.text_size",
  type: z.enum(["small", "default", "large"]),
  default: "default",
});

const readingWidthSetting = declareSetting({
  key: "shell.reading_width",
  type: z.enum(["narrow", "default", "wide"]),
  default: "default",
});

const densitySetting = declareSetting({
  key: "shell.density",
  type: z.enum(["comfortable", "compact"]),
  default: "comfortable",
});

// key는 packages/shell/main/browser-bridge/policy.ts의 LINK_SETTING_KEYS와 같은 글자여야 한다
// (shell은 core를 import하지 못한다).
const webLinksSetting = declareSetting({
  key: "shell.browser.web_links",
  type: z.enum(["browser_tab", "system_browser"]),
  default: "browser_tab",
});

const localLinksSetting = declareSetting({
  key: "shell.browser.local_links",
  type: z.enum(["browser_tab", "system_browser"]),
  default: "browser_tab",
});

// 사람이 바꾼 작업대 단축키. OS마다 따로다(macOS는 Cmd, 다른 OS는 Ctrl). binding id와 chord 글자는
// shell(packages/shell/ipc/keybindings.ts parseKeyOverrides)이 검사하고 모르는 것은 버린다. key 상한 160은
// 사람이 단 앱 단축키 id(`app.panel:<app>:<surface>`)가 들어가는 길이, 항목 수 256은 표(약 90줄)에 앱 단축키가 더해지는 수다.
const overrides = z
  .record(z.string().max(160), z.array(z.string().max(64)).max(4))
  .refine((value) => Object.keys(value).length <= 256);
const keybindingsSetting = declareSetting({
  key: "shell.keybindings",
  type: z.object({ mac: overrides, other: overrides }).partial(),
  default: {},
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
});

// coding agent 즐겨찾기(빠른 실행 Terminal hover와 workspace +의 hover 목록에 나온다)와 사람이 바꾼 실행 명령어.
// harness id는 shell이 검사하고 모르는 것은 버린다.
const codingAgentsSetting = declareSetting({
  key: "shell.coding_agents",
  type: z.object({
    favorites: z.array(z.string().min(1).max(64)).max(64),
    commands: z
      .record(z.string().min(1).max(64), z.string().min(1).max(500))
      .refine((value) => Object.keys(value).length <= 64),
  }),
  default: { favorites: ["claude", "codex", "opencode"], commands: {} },
});

// workspace 창 맨 아래 작업 표시줄. 끄면 float chip이 tab 줄 끝에 있다.
const taskbarSetting = declareSetting({
  key: "shell.taskbar",
  type: z.boolean(),
  default: true,
});

// 사람이 등록한 기기. preview 탭이 이 크기·DPR로 emulation하고 `tab open --preview --device <name>`이 이름으로 찾는다.
// 크기 범위는 shell main의 emulation 입력 검사(packages/shell/ipc/surface.ts)와 같아야 한다(shell은 core를 import하지 못한다).
export const devicesSetting = declareSetting({
  key: "shell.devices",
  type: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        width: z.number().int().min(200).max(2000),
        height: z.number().int().min(200).max(3000),
        dpr: z.number().min(1).max(4),
        os: z.enum(["ios", "android"]),
      }),
    )
    .max(32)
    .refine((list) => new Set(list.map((d) => d.name)).size === list.length),
  default: [],
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
});

// extension은 id마다 켜는 설정이 하나씩 정적으로 선언된다(core는 manifest를 읽지 못한다). 새 extension은 여기에 한 줄을 더하고
// shellSettings에 올린다. 선언이 없는 id는 shell의 registry가 켜지 않는다. 사람만 켠다(settings/update는 user만).
const extensionEnabled = (id: string) =>
  declareSetting({
    key: extensionSettingKey(id),
    type: z.boolean(),
    default: false,
  });
// harness agent(core의 harness session, queue, host route)도 이 설정 하나로 켠다.
export const harnessExtensionSetting = extensionEnabled("harness");
// `claude gui` 같은 CLI 화면 대체 창. 본체와 따로 켠다.
const harnessGuiExtensionSetting = extensionEnabled("harness-gui");

export const shellSettings = [
  themeSetting,
  accentSetting,
  backgroundSetting,
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
  keybindingsSetting,
  quickLaunchSetting,
  appLaunchSetting,
  codingAgentsSetting,
  taskbarSetting,
  devicesSetting,
  sidebarPanelsOffSetting,
  trayOffSetting,
  trayOrderSetting,
  harnessExtensionSetting,
  harnessGuiExtensionSetting,
] as const;
