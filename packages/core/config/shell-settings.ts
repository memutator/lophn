// shell이 core에 선언하는 화면 설정 열. 이름과 설명 wording은 settingWordingKey가 key에서 만든다.
// 고르는 값의 목록은 packages/design의 appearance와 같아야 한다(core는 design을 import하지 못한다).
// Custom 글꼴 이름의 글자 규칙은 CSS를 만드는 main이 검사한다. 여기는 길이만 본다.
import { z } from "zod";
import { declareSetting } from "../../protocol/config/mod.ts";

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

export const shellSettings = [
  themeSetting,
  accentSetting,
  backgroundSetting,
  fontSetting,
  fontCustomSetting,
  codeFontSetting,
  codeFontCustomSetting,
  textSizeSetting,
  readingWidthSetting,
  densitySetting,
  webLinksSetting,
  localLinksSetting,
] as const;
