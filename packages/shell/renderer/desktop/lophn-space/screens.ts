// 형제의 이름과 아이콘. 이름은 wording catalog, 아이콘은 design이 고른다.
import type { IconProps } from "@lophn/ui/primitives";
import { lophnSpaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { LophnScreen } from "./model.ts";

const ICONS: Record<LophnScreen, IconProps["icon"]> = {
  projects: lophnSpaceIcons.projects,
  apps: lophnSpaceIcons.apps,
  settings: lophnSpaceIcons.settings,
};

export function screenLabel(screen: LophnScreen): string {
  switch (screen) {
    case "projects":
      return t("projects.title.screen");
    case "apps":
      return t("apps.title.screen");
    case "settings":
      return t("settings.title.screen");
  }
}

export function screenIcon(screen: LophnScreen): IconProps["icon"] {
  return ICONS[screen];
}
