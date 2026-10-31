// project settings의 App panels 구역. activity bar에 고정한 앱 패널을 순서·열기 자리·제거로 고치고 새로 고정한다.
// 순서가 activity bar 단추 순서다. 각 줄의 열기 자리(Dock·Float)는 같은 앱·화면 탭이 아직 없을 때 새 탭을 어디에 여는지다.
import { t } from "@lophn/i18n";
import { SegmentedControl } from "@lophn/ui/input";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { Button, IconButton } from "@lophn/ui/primitives";
import { useRef } from "react";

import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import type { AppScreens } from "../../app-frame/app-views.tsx";
import { actionIcons, workspaceIcons } from "../../icons/mod.ts";
import {
  panelChoices,
  railAppLabel,
  useScreensRead,
} from "../app-panel-tab.tsx";
import { RAIL_APPS_MAX, type RailApp } from "../model.ts";
import styles from "./project-settings-page.module.css";

export interface AppPanelsSectionProps {
  readonly items: readonly RailApp[];
  readonly onChange: (next: readonly RailApp[]) => void;
}

const same = (a: RailApp, b: RailApp) =>
  a.app === b.app && a.surface === b.surface;

export function AppPanelsSection({ items, onChange }: AppPanelsSectionProps) {
  const { read, retry } = useScreensRead();
  // 다시 읽는 동안에도 줄 이름과 + 목록이 비지 않게 마지막으로 읽은 값을 쓴다.
  const known = useRef<readonly AppScreens[]>([]);
  if (read?.ok) known.current = read.value;
  const apps = known.current;

  const addItems = panelChoices(apps)
    .filter(
      (choice) =>
        !items.some(
          (item) => item.app === choice.app && item.surface === choice.screen,
        ),
    )
    .map((choice) => ({
      id: `${choice.app}:${choice.screen}`,
      label: choice.label,
      textValue: choice.label,
      leading: <MenuIcon icon={workspaceIcons.appPanel} />,
    }));

  const move = (index: number, by: -1 | 1) => {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    onChange(next);
  };

  const addLabel = t("project-settings.button.add-app-panel");
  return (
    <section className={styles.section} data-section="app-panels">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          {t("project-settings.heading.app-panels")}
        </h2>
        <Menu
          trigger={
            <Button
              size="sm"
              icon={actionIcons.add}
              data-add-app-panel=""
              disabled={items.length >= RAIL_APPS_MAX}
            >
              {addLabel}
            </Button>
          }
          // 그 사이 새로 올린 앱도 고를 수 있게 열 때 다시 읽는다.
          onOpenChange={(open) => {
            if (open) retry();
          }}
          items={
            addItems.length > 0
              ? addItems
              : [
                  {
                    id: "none",
                    label: t("project-workspace.label.rail-app-none"),
                    disabled: true,
                  },
                ]
          }
          onSelect={(id) => {
            const choice = panelChoices(apps).find(
              (entry) => `${entry.app}:${entry.screen}` === id,
            );
            if (choice === undefined) return;
            onChange([
              ...items,
              { app: choice.app, surface: choice.screen, title: choice.title },
            ]);
          }}
        />
      </div>
      <p className={styles.lead}>
        {t("project-settings.notice.app-panels-lead")}
      </p>
      {items.length === 0 ? (
        <p className={styles.note}>
          {t("project-settings.notice.app-panels-empty")}
        </p>
      ) : (
        <ul className={styles.rows}>
          {items.map((item, index) => (
            <li
              key={`${item.app}:${item.surface}`}
              className={styles.row}
              data-app-panel-row={item.app}
              data-screen={item.surface}
            >
              <span className={styles.rowName}>
                <AppTabIcon app={item.app} />
                <span className={styles.rowLabel}>
                  {railAppLabel(apps, item)}
                </span>
              </span>
              <span className={styles.rowActions}>
                <SegmentedControl
                  size="sm"
                  label={t("project-settings.label.open-mode")}
                  value={item.open ?? "dock"}
                  options={[
                    {
                      value: "dock",
                      label: t("project-settings.label.open-dock"),
                    },
                    {
                      value: "float",
                      label: t("project-settings.label.open-float"),
                    },
                  ]}
                  onValueChange={(value) =>
                    onChange(
                      items.map((entry) =>
                        same(entry, item)
                          ? { ...entry, open: value as "dock" | "float" }
                          : entry,
                      ),
                    )
                  }
                />
                <Tooltip content={t("project-settings.button.move-up")}>
                  <IconButton
                    icon={actionIcons.moveUp}
                    label={t("project-settings.button.move-up")}
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                </Tooltip>
                <Tooltip content={t("project-settings.button.move-down")}>
                  <IconButton
                    icon={actionIcons.moveDown}
                    label={t("project-settings.button.move-down")}
                    size="sm"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  />
                </Tooltip>
                <Tooltip
                  content={t("project-settings.button.remove-app-panel")}
                >
                  <IconButton
                    icon={actionIcons.remove}
                    label={t("project-settings.button.remove-app-panel")}
                    size="sm"
                    data-remove-app-panel=""
                    onClick={() =>
                      onChange(items.filter((entry) => !same(entry, item)))
                    }
                  />
                </Tooltip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
