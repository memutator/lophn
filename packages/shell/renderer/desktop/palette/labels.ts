// 팔레트 묶음 이름과 키 이름. 문구는 wording catalog에서, 키는 main과 같은 표에서 읽는다.
import { t } from "@lophn/wording";

import {
  type PaletteShortcut,
  WINDOW_SHORTCUTS,
} from "../../../ipc/shortcuts.ts";
import type { WindowPlatform } from "../top-bar/platform.ts";
import type { PaletteGroup } from "./model.ts";

export function groupLabel(group: PaletteGroup): string {
  switch (group) {
    case "tabs":
      return t("common.heading.palette-tabs");
    case "files":
      return t("common.heading.palette-files");
    case "bookmarks":
      return t("browser.heading.palette-bookmarks");
    case "actions":
      return t("common.heading.palette-actions");
    case "projects":
      return t("common.heading.palette-projects");
    case "apps":
      return t("common.heading.palette-apps");
  }
}

// macOS는 ⌘⇧ 기호를 붙여 쓰고 다른 OS는 Ctrl+Shift+처럼 +로 잇는다.
const MODIFIERS: readonly {
  name: string;
  mac: string;
  other: string;
}[] = [
  { name: "CommandOrControl", mac: "⌘", other: "Ctrl" },
  { name: "Alt", mac: "⌥", other: "Alt" },
  { name: "Shift", mac: "⇧", other: "Shift" },
];

/** accelerator를 사람이 읽는 키 이름으로 쓴다. 표에 없는 modifier는 이름 그대로 둔다. */
function shortcutLabel(accelerator: string, platform: WindowPlatform): string {
  const parts = accelerator.split("+");
  const key = parts.pop()!.toUpperCase();
  const mac = platform === "mac";
  const known = MODIFIERS.filter((modifier) =>
    parts.includes(modifier.name),
  ).map((modifier) => (mac ? modifier.mac : modifier.other));
  const rest = parts.filter(
    (part) => !MODIFIERS.some((modifier) => modifier.name === part),
  );
  if (mac && rest.length === 0) return `${known.join("")}${key}`;
  return [...known, ...rest, key].join("+");
}

export function windowShortcutLabel(
  shortcut: PaletteShortcut,
  platform: WindowPlatform,
): string {
  return shortcutLabel(WINDOW_SHORTCUTS[shortcut], platform);
}
