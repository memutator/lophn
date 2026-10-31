// activity bar 아래쪽에 고정한 앱 패널 단추 묶음과 끝의 + 단추. 단추를 누르면 그 화면을 연다(탭이 이미 있으면 그 탭으로
// 간다). 오른쪽 클릭은 고정 해제, +는 고를 수 있는 화면 목록을 열어 고정만 한다(열지는 않는다).

import { t } from "@lophn/i18n";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { useRef, useState } from "react";
import { commonIcons, workspaceIcons } from "../../icons/mod.ts";

import { useAppIcon } from "../../app-frame/app-icon.tsx";
import type { AppScreens } from "../../app-frame/app-views.tsx";

import {
  panelChoices,
  railAppLabel,
  useScreensRead,
} from "../app-panel-tab.tsx";
import type { RailApp } from "../model.ts";
import styles from "./project-sidebar.module.css";

export interface RailAppsProps {
  readonly items: readonly RailApp[];
  readonly onOpen: (item: RailApp) => void;
  readonly onPin: (item: RailApp) => void;
  readonly onUnpin: (item: RailApp) => void;
}

type OpenMenu =
  | { readonly kind: "item"; readonly item: RailApp; x: number; y: number }
  | { readonly kind: "add"; x: number; y: number };

function RailAppButton({
  item,
  label,
  onOpen,
  onMenu,
}: {
  item: RailApp;
  label: string;
  onOpen: () => void;
  onMenu: (at: { x: number; y: number }) => void;
}) {
  // 앱이 선언한 icon이 없으면 기본 앱 패널 아이콘이다.
  const icon = useAppIcon(item.app);
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={styles.activityButton}
        aria-label={label}
        data-rail-app={item.app}
        data-screen={item.surface}
        onClick={onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {icon === undefined ? (
          <Icon icon={workspaceIcons.appPanel} pixels={18} />
        ) : (
          <img src={icon} alt="" width={18} height={18} />
        )}
      </button>
    </Tooltip>
  );
}

export function RailApps({ items, onOpen, onPin, onUnpin }: RailAppsProps) {
  const { read, retry } = useScreensRead();
  // + menu를 열 때 다시 읽는 동안에도 tooltip과 목록이 비지 않게 마지막으로 읽은 값을 쓴다.
  const known = useRef<readonly AppScreens[]>([]);
  if (read?.ok) known.current = read.value;
  const apps = known.current;
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  const labelOf = (item: RailApp): string => railAppLabel(apps, item);

  const choices = panelChoices(apps);
  const addItems = choices
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
  const menuItems =
    menu === null
      ? []
      : menu.kind === "item"
        ? [
            {
              id: "unpin",
              label: t("project-workspace.button.rail-app-unpin"),
            },
          ]
        : addItems.length > 0
          ? addItems
          : [
              {
                id: "none",
                label: t("project-workspace.label.rail-app-none"),
                disabled: true,
              },
            ];

  const choose = (id: string) => {
    if (menu === null) return;
    if (menu.kind === "item") {
      if (id === "unpin") onUnpin(menu.item);
      return;
    }
    const choice = choices.find(
      (entry) => `${entry.app}:${entry.screen}` === id,
    );
    if (choice !== undefined) {
      onPin({ app: choice.app, surface: choice.screen, title: choice.title });
    }
  };

  const addLabel = t("project-workspace.label.rail-app-add");
  return (
    <div
      className={styles.railApps}
      role="group"
      aria-label={t("project-workspace.label.rail-apps")}
    >
      {items.map((item) => (
        <RailAppButton
          key={`${item.app}:${item.surface}`}
          item={item}
          label={labelOf(item)}
          onOpen={() => onOpen(item)}
          onMenu={(at) => setMenu({ kind: "item", item, ...at })}
        />
      ))}
      <Tooltip content={addLabel}>
        <button
          type="button"
          className={styles.activityButton}
          aria-label={addLabel}
          data-rail-app-add=""
          onClick={(event) => {
            // 그 사이 새로 올린 앱도 고를 수 있게 다시 읽는다.
            retry();
            const box = event.currentTarget.getBoundingClientRect();
            setMenu({ kind: "add", x: box.right, y: box.top });
          }}
        >
          <Icon icon={commonIcons.add} pixels={18} />
        </button>
      </Tooltip>
      {menu === null ? null : (
        <Menu
          open
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
          trigger={
            <span
              className={styles.railMenuAnchor}
              style={{ left: menu.x, top: menu.y }}
            />
          }
          items={menuItems}
          onSelect={(id) => {
            choose(id);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}
