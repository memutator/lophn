// Settings › Keyboard의 순수 규칙. 표(ipc/keybindings.ts)의 바인딩마다 한 줄이고 줄의 이름은 wording이다.
// 키를 바꾸면 이 기기 OS의 것만 바꾸고 다른 OS의 값은 그대로 다시 쓴다.
import { type MessageKey, t } from "@lophn/wording";

import {
  type Binding,
  bindingId,
  type Command,
  KEYBINDINGS,
  type KeyOverrides,
  type KeyPlatform,
  resolveBindings,
} from "../../../../ipc/keybindings.ts";
import type { StoredKeybindings } from "./source.ts";

const NAMES: Readonly<Record<Command, MessageKey>> = {
  "tab.next": "settings.label.key-tab-next",
  "tab.prev": "settings.label.key-tab-prev",
  "tab.nth": "settings.label.key-tab-nth",
  "tab.close": "settings.label.key-tab-close",
  "tab.reopen": "settings.label.key-tab-reopen",
  "tab.move-left": "settings.label.key-tab-move-left",
  "tab.move-right": "settings.label.key-tab-move-right",
  "tab.to-prev-pane": "settings.label.key-tab-to-prev-pane",
  "tab.to-next-pane": "settings.label.key-tab-to-next-pane",
  "pane.focus": "settings.label.key-pane-focus",
  "pane.split": "settings.label.key-pane-split",
  "sidebar.toggle": "settings.label.key-sidebar-toggle",
  "explorer.focus": "settings.label.key-explorer-focus",
  "search.open": "settings.label.key-search-open",
  "terminal.focus": "settings.label.key-terminal-focus",
  "files.quick-open": "settings.label.key-files-quick-open",
};

/** 줄 이름. 번호가 있는 것(n번째 탭, n번째 칸)은 번호를 넣는다. 0번 탭은 마지막 탭이다. */
export function bindingName(binding: Binding): string {
  if (binding.command === "tab.nth") {
    return binding.arg === 0
      ? t("settings.label.key-tab-last")
      : t("settings.label.key-tab-nth", { n: binding.arg ?? 1 });
  }
  if (binding.command === "pane.focus") {
    return t("settings.label.key-pane-focus", { n: binding.arg ?? 1 });
  }
  return t(NAMES[binding.command]);
}

export interface KeyRow {
  readonly id: string;
  readonly name: string;
  /** 지금 듣는 키. 비었으면 키가 없다. */
  readonly chords: readonly string[];
  /** 사람이 바꿨다. [Reset]이 보인다. */
  readonly changed: boolean;
}

export function keyRows(
  platform: KeyPlatform,
  overrides: KeyOverrides,
): readonly KeyRow[] {
  return resolveBindings(platform, overrides).map((binding) => ({
    id: bindingId(binding),
    name: bindingName(binding),
    chords: binding[platform],
    changed: overrides[bindingId(binding)] !== undefined,
  }));
}

/** 줄 하나를 바꾼다. chords가 null이면 표의 키로 돌린다. 표와 같아지면 저장에서 뺀다. */
export function withChords(
  stored: StoredKeybindings,
  platform: KeyPlatform,
  id: string,
  chords: readonly string[] | null,
): StoredKeybindings {
  const { [id]: _old, ...rest } = stored[platform] ?? {};
  const base = KEYBINDINGS.find((binding) => bindingId(binding) === id);
  const same =
    chords === null ||
    (base !== undefined &&
      base[platform].length === chords.length &&
      base[platform].every((chord, at) => chord === chords[at]));
  return { ...stored, [platform]: same ? rest : { ...rest, [id]: chords } };
}

/** 이 기기 OS의 모든 줄을 표의 키로. 다른 OS의 값은 남긴다. */
export function withoutPlatform(
  stored: StoredKeybindings,
  platform: KeyPlatform,
): StoredKeybindings {
  const { [platform]: _drop, ...rest } = stored;
  return rest;
}
