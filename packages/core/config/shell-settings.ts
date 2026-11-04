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
// shell(packages/shell/ipc/keybindings.ts parseKeyOverrides)이 검사하고 모르는 것은 버린다.
const overrides = z
  .record(z.string().max(64), z.array(z.string().max(64)).max(4))
  .refine((value) => Object.keys(value).length <= 64);
const keybindingsSetting = declareSetting({
  key: "shell.keybindings",
  type: z.object({ mac: overrides, other: overrides }).partial(),
  default: {},
});

// 왼쪽 sidebar 빠른 실행의 전역 값. 모양은 place layout의 `quick`과 같고(packages/shell/main/workspace/place-layout.ts),
// place가 자기 `quick`을 두지 않으면 이 값을 쓴다. 모르는 id와 없어진 앱은 shell이 그릴 때 건너뛴다.
const quickLaunchSetting = declareSetting({
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
const appLaunchSetting = declareSetting({
  key: "shell.app_launch",
  type: z
    .record(
      z.string().min(1).max(200),
      z.object({ open: z.enum(["dock", "float"]), rect: floatRect.optional() }),
    )
    .refine((value) => Object.keys(value).length <= 200),
  default: {},
});

// coding agent 즐겨찾기(빠른 실행 Terminal hover와 place +의 hover 목록에 나온다)와 사람이 바꾼 실행 명령어.
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

// extension은 id마다 켜는 설정이 하나씩 정적으로 선언된다(core는 manifest를 읽지 못한다). 새 extension은 여기에 한 줄을 더하고
// shellSettings에 올린다. 선언이 없는 id는 shell의 registry가 켜지 않는다. 사람만 켠다(settings/update는 user만).
const extensionEnabled = (id: string) =>
  declareSetting({
    key: extensionSettingKey(id),
    type: z.boolean(),
    default: false,
  });
// harness agent(core의 harness session, 입력함, host route)도 이 설정 하나로 켠다.
export const harnessExtensionSetting = extensionEnabled("harness");

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
  harnessExtensionSetting,
] as const;
