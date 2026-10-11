// 여섯 형제의 이름과 아이콘. 이름은 wording catalog, 아이콘은 design이 고른다.
import { type IconProps, lophnSpaceIcons } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { LophnScreen } from "./model.ts";

const ICONS: Record<LophnScreen, IconProps["icon"]> = {
  projects: lophnSpaceIcons.projects,
  documents: lophnSpaceIcons.documents,
  apps: lophnSpaceIcons.apps,
  "things-to-confirm": lophnSpaceIcons.thingsToConfirm,
  roles: lophnSpaceIcons.roles,
  settings: lophnSpaceIcons.settings,
};

export function screenLabel(screen: LophnScreen): string {
  switch (screen) {
    case "projects":
      return t("projects.title.screen");
    case "documents":
      return t("documents.title.screen");
    case "apps":
      return t("apps.title.screen");
    case "things-to-confirm":
      return t("things-to-confirm.title.screen");
    case "roles":
      return t("roles.title.screen");
    case "settings":
      return t("settings.title.screen");
  }
}

export function screenIcon(screen: LophnScreen): IconProps["icon"] {
  return ICONS[screen];
}
