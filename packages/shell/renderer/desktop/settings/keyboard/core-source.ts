// KeyboardSource를 선언 설정 `shell.keybindings`의 읽기·쓰기로 만든다. 화면은 `settings/list`를 useCoreRead로 읽고
// storedOf로 푼다. read는 창에 덮는 쪽(main.tsx)이 쓴다.
import { parseKeyOverrides } from "../../../../../protocol/shell/keybindings.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import type { KeyboardSource, StoredKeybindings } from "./source.ts";

// packages/core/config/shell-settings.ts의 key와 같은 글자다(shell은 core를 import하지 못한다).
export const KEYBINDINGS_KEY = "shell.keybindings";

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

/** key마다의 지금 값에서 저장된 키. */
export function storedOf(
  read: ReadonlyMap<string, unknown>,
): StoredKeybindings {
  const value = read.get(KEYBINDINGS_KEY);
  return {
    mac: parseKeyOverrides(platformValue(value, "mac")),
    other: parseKeyOverrides(platformValue(value, "other")),
  };
}

export function coreKeyboardSource(core: CoreSource): KeyboardSource {
  return {
    async read() {
      const read = await readEffective(core, [KEYBINDINGS_KEY]);
      return read.ok ? { ok: true, value: storedOf(read.value) } : read;
    },
    write: (value) => chooseSetting(core, KEYBINDINGS_KEY, value),
  };
}
