// KeyboardSource를 선언 설정 `shell.keybindings`의 읽기·쓰기로 만든다.
import { parseKeyOverrides } from "../../../../../protocol/shell/keybindings.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import type { KeyboardSource, StoredKeybindings } from "./source.ts";

// packages/core/config/shell-settings.ts의 key와 같은 글자다(shell은 core를 import하지 못한다).
const SETTING_KEY = "shell.keybindings";

/** core가 준 값에서 OS 하나의 키. 모양이 틀리면 비운다. */
function platformValue(value: unknown, platform: "mac" | "other"): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return platform === "mac"
    ? "mac" in value
      ? value.mac
      : undefined
    : "other" in value
      ? value.other
      : undefined;
}

export function coreKeyboardSource(core: CoreSource): KeyboardSource {
  return {
    watch: (listener) => core.subscribe(listener),
    async read() {
      const read = await readEffective(core, [SETTING_KEY]);
      if (!read.ok) return read;
      const value = read.value.get(SETTING_KEY);
      const stored: StoredKeybindings = {
        mac: parseKeyOverrides(platformValue(value, "mac")),
        other: parseKeyOverrides(platformValue(value, "other")),
      };
      return { ok: true, value: stored };
    },
    write: (value) => chooseSetting(core, SETTING_KEY, value),
  };
}
