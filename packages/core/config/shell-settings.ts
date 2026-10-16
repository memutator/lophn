// shell이 core에 선언하는 화면 설정 넷. 이름과 설명 wording은 settingWordingKey가 key에서 만든다.
import { z } from "zod";
import { declareSetting } from "../../protocol/config/mod.ts";

export const themeSetting = declareSetting({
  key: "shell.theme",
  type: z.enum(["light", "dark", "system"]),
  default: "system",
});

export const textSizeSetting = declareSetting({
  key: "shell.text_size",
  type: z.enum(["small", "default", "large"]),
  default: "default",
});

export const readingWidthSetting = declareSetting({
  key: "shell.reading_width",
  type: z.enum(["narrow", "default", "wide"]),
  default: "default",
});

export const densitySetting = declareSetting({
  key: "shell.density",
  type: z.enum(["comfortable", "compact"]),
  default: "comfortable",
});

export const shellSettings = [
  themeSetting,
  textSizeSetting,
  readingWidthSetting,
  densitySetting,
] as const;
