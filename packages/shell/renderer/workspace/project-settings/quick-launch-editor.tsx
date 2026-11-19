// 빠른 실행을 고치는 목록. 단추 순서와 켜고 끄기(QuickOrderList), 고정할 앱 panel(AppPanelList), 오른쪽 sidebar에 나올 앱 화면(SidebarPanelList)이다.
// Settings › Quick launch(전역 값)와 Project settings(이 project만의 값)가 같이 쓴다.
import { useRef, useState } from "react";
import { t } from "@lophn/i18n";
import { Skeleton, useDelayedLoading } from "@lophn/ui/feedback";
import { Field, Input, SegmentedControl, Switch } from "@lophn/ui/input";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";

import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import type { AppScreens } from "../../app-frame/app-views.tsx";
import {
  type AppLaunch,
  type AppLaunchMap,
  launchKey,
  type SidebarPanelPick,
} from "../../desktop/settings/quick-launch/source.ts";
import {
  actionIcons,
  browserIcons,
  shellIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import type { QuickCommand, WorkspaceQuick } from "../../shell/desk-model.ts";
import { newId } from "../../prefixed-id.ts";
import { panelChoices, useScreensRead } from "../app-panel-tab.tsx";
import {
  isPinned,
  isQuickHidden,
  moveQuick,
  pinId,
  quickOrder,
  setPinned,
  setQuickHidden,
} from "./quick-launch.ts";
import styles from "./quick-launch-editor.module.css";

const BUILTIN_LABEL = {
  terminal: "left-sidebar.button.quick-terminal",
  browser: "left-sidebar.button.quick-browser",
  app: "left-sidebar.button.quick-app",
  search: "left-sidebar.button.quick-search",
} as const;

const BUILTIN_ICON = {
  terminal: workspaceIcons.terminal,
  browser: browserIcons.globe,
  app: workspaceIcons.appPanel,
  search: shellIcons.search,
} as const;

// main schema의 상한과 같다.
const COMMANDS_MAX = 20;

/** 줄 하나. 글자를 치는 동안은 로컬이고, 포커스가 나갈 때 비지 않았으면 저장한다(저장은 layout 파일을 쓴다). */
function CommandRow({
  command,
  onChange,
  onRemove,
}: {
  command: QuickCommand;
  onChange: (next: QuickCommand) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(command.label);
  const [line, setLine] = useState(command.command);
  const save = () => {
    const next = { ...command, label: label.trim(), command: line.trim() };
    if (next.label === "" || next.command === "") {
      setLabel(command.label);
      setLine(command.command);
    } else if (
      next.label !== command.label ||
      next.command !== command.command
    ) {
      onChange(next);
    }
  };
  return (
    <li className={styles.row} data-command-row={command.id}>
      <span className={styles.cell}>
        <Field label={t("project-settings.label.command-name")}>
          <Input
            size="sm"
            value={label}
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={save}
          />
        </Field>
      </span>
      <span className={styles.cell}>
        <Field label={t("project-settings.label.command-line")}>
          <Input
            size="sm"
            value={line}
            maxLength={1000}
            spellCheck={false}
            onChange={(event) => setLine(event.target.value)}
            onBlur={save}
          />
        </Field>
      </span>
      <IconButton
        icon={actionIcons.remove}
        label={t("project-settings.button.remove-command")}
        size="sm"
        onClick={onRemove}
      />
    </li>
  );
}

/** 이 project만의 터미널 명령 목록과 더하는 줄. 전역 값을 따르는지와 상관없이 고칠 수 있다. */
export function QuickCommandList({
  commands,
  onCommands,
}: {
  commands: readonly QuickCommand[];
  onCommands: (next: readonly QuickCommand[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [line, setLine] = useState("");
  const ready = label.trim() !== "" && line.trim() !== "";
  const add = () => {
    if (!ready || commands.length >= COMMANDS_MAX) return;
    onCommands([
      ...commands,
      {
        id: newId("cmd", Date.now()),
        label: label.trim(),
        command: line.trim(),
      },
    ]);
    setLabel("");
    setLine("");
  };
  const onEnter = (event: { key: string }) => {
    if (event.key === "Enter") add();
  };
  return (
    <ul className={styles.rows} data-command-rows="">
      {commands.map((command) => (
        <CommandRow
          key={command.id}
          command={command}
          onChange={(next) =>
            onCommands(
              commands.map((item) => (item.id === next.id ? next : item)),
            )
          }
          onRemove={() =>
            onCommands(commands.filter((item) => item.id !== command.id))
          }
        />
      ))}
      <li className={styles.row} data-command-add="">
        <span className={styles.cell}>
          <Field label={t("project-settings.label.command-name")}>
            <Input
              size="sm"
              placeholder={t("project-settings.label.command-name")}
              value={label}
              maxLength={60}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={onEnter}
            />
          </Field>
        </span>
        <span className={styles.cell}>
          <Field label={t("project-settings.label.command-line")}>
            <Input
              size="sm"
              placeholder={t("project-settings.label.command-line")}
              value={line}
              maxLength={1000}
              spellCheck={false}
              onChange={(event) => setLine(event.target.value)}
              onKeyDown={onEnter}
            />
          </Field>
        </span>
        <Button
          size="sm"
          icon={actionIcons.add}
          disabled={!ready || commands.length >= COMMANDS_MAX}
          onClick={add}
        >
          {t("project-settings.button.add-command")}
        </Button>
      </li>
    </ul>
  );
}

/** 설치된 앱의 panel 화면 목록. 다시 읽는 동안에도 목록이 비지 않게 마지막으로 읽은 값을 쓴다. */
export function useAppPanelApps(): {
  apps: readonly AppScreens[];
  loading: boolean;
  failed: boolean;
} {
  const { read } = useScreensRead();
  const known = useRef<readonly AppScreens[]>([]);
  if (read?.ok) known.current = read.value;
  const apps = known.current;
  return {
    apps,
    loading: read === null && apps.length === 0,
    failed: read !== null && !read.ok && apps.length === 0,
  };
}

export function QuickOrderList({
  quick,
  onQuick,
  apps,
}: {
  quick: WorkspaceQuick;
  onQuick: (next: WorkspaceQuick) => void;
  apps: readonly AppScreens[];
}) {
  const order = quickOrder(quick);
  const labelOf = (app: string, surface: string) =>
    panelChoices(apps).find(
      (choice) => choice.app === app && choice.screen === surface,
    )?.label ?? t("project-workspace.label.kind-app-panel");
  return (
    <ul className={styles.rows} data-quick-rows="">
      {order.map((id, index) => {
        const builtin =
          id in BUILTIN_LABEL ? (id as keyof typeof BUILTIN_LABEL) : null;
        const pin = quick.apps.find((item) => pinId(item) === id);
        const label =
          builtin !== null
            ? t(BUILTIN_LABEL[builtin])
            : labelOf(pin?.app ?? "", pin?.surface ?? "");
        const hidden = isQuickHidden(quick, id);
        return (
          <li
            key={id}
            className={styles.row}
            data-quick-row={id}
            data-hidden={hidden || undefined}
          >
            <span className={styles.rowName}>
              {builtin === null ? (
                <AppTabIcon app={pin?.app} />
              ) : (
                <Icon icon={BUILTIN_ICON[builtin]} pixels={16} />
              )}
              <span className={styles.rowLabel}>{label}</span>
            </span>
            <IconButton
              icon={actionIcons.moveUp}
              label={t("project-settings.button.move-up")}
              size="sm"
              disabled={index === 0}
              onClick={() => onQuick(moveQuick(quick, id, -1))}
            />
            <IconButton
              icon={actionIcons.moveDown}
              label={t("project-settings.button.move-down")}
              size="sm"
              disabled={index === order.length - 1}
              onClick={() => onQuick(moveQuick(quick, id, 1))}
            />
            {pin === undefined ? null : (
              // 없어진 앱의 고정도 여기서 풀 수 있다.
              <IconButton
                icon={actionIcons.remove}
                label={t("project-settings.button.unpin")}
                size="sm"
                onClick={() => onQuick(setPinned(quick, pin, false))}
              />
            )}
            <span className={styles.toggle}>
              <Switch
                size="sm"
                label={t("settings.label.quick-show", { name: label })}
                checked={!hidden}
                onCheckedChange={(on) =>
                  onQuick(setQuickHidden(quick, id, !on))
                }
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 앱 panel 화면마다 고정 단추. `launch`를 주면 그 줄에 여는 자리(Tab·Float)를 고르는 칸도 둔다(전역 값이라
 * Settings에만 둔다).
 */
export function AppPanelList({
  apps,
  loading,
  failed,
  quick,
  onQuick,
  launch,
  onLaunch,
}: {
  apps: readonly AppScreens[];
  loading: boolean;
  failed: boolean;
  quick: WorkspaceQuick;
  onQuick: (next: WorkspaceQuick) => void;
  launch?: AppLaunchMap;
  onLaunch?: (key: string, next: AppLaunch) => void;
}) {
  const showLoading = useDelayedLoading(loading);
  const choices = panelChoices(apps);
  if (loading) return showLoading ? <Skeleton lines={3} /> : null;
  if (failed) {
    return (
      <p className={styles.note}>{t("project-settings.notice.apps-failed")}</p>
    );
  }
  if (choices.length === 0) {
    return (
      <p className={styles.note}>
        {t("project-settings.notice.no-app-panels")}
      </p>
    );
  }
  return (
    <ul className={styles.rows} data-app-panel-rows="">
      {choices.map((choice) => {
        const pin = { app: choice.app, surface: choice.screen };
        const on = isPinned(quick, pin);
        const key = launchKey(choice.app, choice.screen);
        const now = launch?.[key];
        return (
          <li key={key} className={styles.row} data-app-panel-row={choice.app}>
            <span className={styles.rowName}>
              <AppTabIcon app={choice.app} />
              <span className={styles.rowLabel}>{choice.label}</span>
            </span>
            {launch === undefined || onLaunch === undefined ? null : (
              <SegmentedControl
                size="sm"
                label={t("settings.label.quick-open-as")}
                options={[
                  { value: "dock", label: t("settings.label.quick-open-tab") },
                  {
                    value: "float",
                    label: t("settings.label.quick-open-float"),
                  },
                ]}
                value={now?.open ?? "dock"}
                onValueChange={(value) =>
                  onLaunch(key, {
                    ...now,
                    open: value === "float" ? "float" : "dock",
                  })
                }
              />
            )}
            <Button
              size="sm"
              onClick={() => onQuick(setPinned(quick, pin, !on))}
            >
              {on
                ? t("project-settings.button.unpin")
                : t("project-settings.button.pin")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** `sidebar` 자리를 가진 앱 화면마다 줄 하나와 Switch. 켜 둔 것이 오른쪽 sidebar의 panel이 된다. 기본은 켜짐이고 끈 것만 전역 값에 쌓인다. */
export function SidebarPanelList({
  apps,
  loading,
  failed,
  off,
  onOff,
}: {
  apps: readonly AppScreens[];
  loading: boolean;
  failed: boolean;
  off: readonly SidebarPanelPick[];
  onOff: (next: readonly SidebarPanelPick[]) => void;
}) {
  const showLoading = useDelayedLoading(loading);
  const choices = apps.flatMap((app) =>
    app.screens
      .filter((screen) => screen.places.includes("sidebar"))
      .map((screen) => ({
        app: app.app,
        screen: screen.key,
        label: t("app-panel.label.screen", {
          app: app.name,
          screen: screen.label,
        }),
      })),
  );
  if (loading) return showLoading ? <Skeleton lines={3} /> : null;
  if (failed) {
    return (
      <p className={styles.note}>{t("project-settings.notice.apps-failed")}</p>
    );
  }
  if (choices.length === 0) {
    return (
      <p className={styles.note}>
        {t("project-settings.notice.no-sidebar-panels")}
      </p>
    );
  }
  const same = (a: SidebarPanelPick, b: SidebarPanelPick) =>
    a.app === b.app && a.screen === b.screen;
  return (
    <ul className={styles.rows} data-sidebar-panel-rows="">
      {choices.map((choice) => {
        const pick = { app: choice.app, screen: choice.screen };
        return (
          <li
            key={`${choice.app}:${choice.screen}`}
            className={styles.row}
            data-sidebar-panel-row={choice.app}
          >
            <span className={styles.rowName}>
              <AppTabIcon app={choice.app} />
              <span className={styles.rowLabel}>{choice.label}</span>
            </span>
            <span className={styles.toggle}>
              <Switch
                size="sm"
                label={t("settings.label.quick-sidebar-show", {
                  name: choice.label,
                })}
                checked={!off.some((item) => same(item, pick))}
                onCheckedChange={(on) =>
                  onOff(
                    on
                      ? off.filter((item) => !same(item, pick))
                      : [...off, pick],
                  )
                }
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
