// 팔레트 묶음 이름과 키 이름. 문구는 i18n catalog에서, 키는 main과 같은 표에서 읽는다.
import { t } from "@lophn/i18n";

import {
  type BindingCommand,
  commandLabel,
  type KeyOverrides,
} from "../../../ipc/keybindings.ts";
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
      return t("common.heading.projects");
    case "apps":
      return t("common.heading.apps");
  }
}

/** 표의 command 하나의 키 이름. 사람이 바꾼 키가 있으면 그것을 보인다. 키가 없으면 null이다. */
export function windowShortcutLabel(
  command: BindingCommand,
  platform: WindowPlatform,
  overrides: KeyOverrides = {},
): string | null {
  return commandLabel(
    command,
    platform === "mac" ? "mac" : "other",
    undefined,
    overrides,
  );
}
