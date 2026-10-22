// gallery 틀이고 renderer로 옮기지 않는다. renderer에서는 `SETTINGS_GROUPS`의 System 묶음에 항목 하나를 더하면 된다
// (`SettingsPane`에 "jobs"와 `settingsIcons`에 CalendarClock, `SettingsScreen`의 switch에 본문 하나).
// Settings 틀(settings-space.tsx의 마크업)을 복사하고 sidebar만 항목 하나를 더한 draft로 바꾼다. 자리를 바꾸려면
// 이 파일만 다시 그리면 된다.
import type { ReactNode } from "react";
import { CalendarClock, type LucideIcon } from "lucide-react";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { TopBar } from "../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { SETTINGS_GROUPS } from "../../../../packages/shell/renderer/desktop/settings/model.ts";
import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import { Breadcrumbs } from "../../../../packages/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import { SIDEBAR_WIDTH } from "../../../../packages/shell/renderer/workspace/model.ts";
import { commonIcons } from "../../../../packages/shell/renderer/icons/mod.ts";
import space from "../../../../packages/shell/renderer/desktop/settings/settings-space.module.css";
import settings from "../../../../packages/shell/renderer/desktop/settings/settings.module.css";
import nav from "../../../../packages/shell/renderer/desktop/settings/sidebar/sidebar.module.css";

const JOBS = {
  id: "jobs",
  label: "Scheduled jobs",
  icon: CalendarClock,
};

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

// System 묶음의 맨 앞에 "Scheduled jobs"를 얹는다.
const GROUPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly panes: readonly Entry[];
}[] = SETTINGS_GROUPS.map((group) => ({
  id: group.id,
  label: t(group.label),
  panes: [
    ...(group.id === "system" ? [JOBS] : []),
    ...group.panes.map((pane) => ({
      id: pane.id,
      label: t(pane.label),
      icon: pane.icon,
    })),
  ],
}));

const noop = () => {};

function DraftSidebar() {
  return (
    <nav
      className={nav.sidebar}
      data-sidebar="open"
      style={{ width: `${SIDEBAR_WIDTH}px` }}
      aria-label={t("settings.title.screen")}
    >
      <div className={nav.header}>
        <span className={nav.headerContent}>
          <LauncherButton onLauncher={noop} />
          <span className={nav.title}>{t("settings.title.screen")}</span>
        </span>
      </div>
      <div className={`${nav.list} ${nav.groups}`}>
        {GROUPS.map((group) => (
          <section key={group.id}>
            <h3 className={nav.navGroup}>{group.label}</h3>
            <ul className={nav.navList} role="list">
              {group.panes.map((entry) => (
                <li key={entry.id} className={nav.li}>
                  <button
                    type="button"
                    data-settings-pane={entry.id}
                    className={`${nav.item} ${nav.navRow} ${
                      entry.id === JOBS.id ? nav.active : ""
                    }`}
                    aria-current={entry.id === JOBS.id ? "page" : undefined}
                  >
                    <Icon
                      icon={entry.icon}
                      pixels={iconPixels("base")}
                      className={nav.icon}
                    />
                    <span className={nav.label}>{entry.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}

export function JobsFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className={space.space}
      data-space="settings"
      data-settings-pane="jobs"
    >
      <DraftSidebar />
      <div className={space.main}>
        <div className={space.topBar}>
          <TopBar
            platform="linux"
            leading={
              <span className={space.leading}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={commonIcons.back}
                  onClick={noop}
                >
                  {t("common.button.back")}
                </Button>
                <Breadcrumbs
                  crumbs={[
                    { label: t("settings.title.screen") },
                    { label: JOBS.label },
                  ]}
                />
              </span>
            }
          />
        </div>
        <div className={space.content}>
          <section className={settings.screen} data-screen-body="settings">
            <div className={settings.column}>{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
