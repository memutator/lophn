// 세 메뉴 진입점이 같이 쓰는 Project Commands 공용 목록.
// - `ProjectCommandsList`: Popover(Terminal hover, 사이드바 project + hover)
// - `projectCommandsMenuItems`: 탭 줄 + 메뉴의 Terminal 하위 메뉴
import { t } from "@lophn/i18n";
import {
  MenuIcon,
  type MenuItem,
  PopoverRow,
  Tooltip,
} from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { Fragment, type MouseEvent, type ReactNode } from "react";

import type {
  ProjectCommand,
  ProjectCommandRun,
} from "../../../../protocol/projects/project-commands.ts";
import {
  commonIcons,
  projectCommandActionIcons,
  projectCommandIcon,
  shellIcons,
} from "../../icons/mod.ts";
import styles from "./commands-menu.module.css";
import {
  isCommandActive,
  isCommandFailed,
  type ProjectCommandGroup,
  previewUrlOf,
} from "./use-project-commands.ts";

export interface ProjectCommandActions {
  onRun(group: ProjectCommandGroup, cmd: ProjectCommand): void;
  onStop(group: ProjectCommandGroup, cmd: ProjectCommand): void;
  onStopAll(group: ProjectCommandGroup): void;
  onRestart(group: ProjectCommandGroup, cmd: ProjectCommand): void;
  onDismiss?: (group: ProjectCommandGroup, cmd: ProjectCommand) => void;
  onViewTerminal(
    group: ProjectCommandGroup,
    cmd: ProjectCommand,
    run: ProjectCommandRun,
  ): void;
  onOpenPreview(group: ProjectCommandGroup, url: string): void;
  onManage?: () => void;
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return url;
  }
}

function CommandIconGlyph() {
  return <Icon icon={projectCommandIcon} pixels={14} />;
}

function stopBubble(event: MouseEvent) {
  event.stopPropagation();
  event.preventDefault();
}

function InlineActions({
  group,
  cmd,
  run,
  actions,
}: {
  group: ProjectCommandGroup;
  cmd: ProjectCommand;
  run: ProjectCommandRun | undefined;
  actions: ProjectCommandActions;
}) {
  const running = isCommandActive(run);
  const failed = isCommandFailed(run);
  const url = previewUrlOf(cmd, run);
  const hasTerminal = run?.terminal_id != null;
  const canDismiss = failed && actions.onDismiss !== undefined;
  if (!running && !hasTerminal && url === null && !canDismiss) return null;
  return (
    <span className={styles.actions}>
      {url !== null && running ? (
        <Tooltip
          content={`${t("project-commands.button.open-preview")} · ${url}`}
        >
          <button
            type="button"
            className={styles.urlChip}
            aria-label={url}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              stopBubble(e);
              actions.onOpenPreview(group, url);
            }}
          >
            {shortUrl(url)}
          </button>
        </Tooltip>
      ) : null}
      {running ? (
        <>
          <Tooltip content={t("project-commands.button.stop")}>
            <button
              type="button"
              className={styles.actionButton}
              aria-label={t("project-commands.button.stop")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                stopBubble(e);
                actions.onStop(group, cmd);
              }}
            >
              <Icon icon={projectCommandActionIcons.stop} pixels={12} />
            </button>
          </Tooltip>
          <Tooltip content={t("project-commands.button.restart")}>
            <button
              type="button"
              className={styles.actionButton}
              aria-label={t("project-commands.button.restart")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                stopBubble(e);
                actions.onRestart(group, cmd);
              }}
            >
              <Icon icon={projectCommandActionIcons.restart} pixels={12} />
            </button>
          </Tooltip>
        </>
      ) : null}
      {hasTerminal && run !== undefined ? (
        <Tooltip content={t("project-commands.button.view-terminal")}>
          <button
            type="button"
            className={styles.actionButton}
            aria-label={t("project-commands.button.view-terminal")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              stopBubble(e);
              actions.onViewTerminal(group, cmd, run);
            }}
          >
            <Icon icon={projectCommandActionIcons.terminal} pixels={12} />
          </button>
        </Tooltip>
      ) : null}
      {url !== null && !running ? (
        <Tooltip content={t("project-commands.button.open-preview")}>
          <button
            type="button"
            className={styles.actionButton}
            aria-label={t("project-commands.button.open-preview")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              stopBubble(e);
              actions.onOpenPreview(group, url);
            }}
          >
            <Icon icon={projectCommandActionIcons.preview} pixels={12} />
          </button>
        </Tooltip>
      ) : null}
      {canDismiss ? (
        <Tooltip content={t("project-commands.button.dismiss")}>
          <button
            type="button"
            className={styles.actionButton}
            aria-label={t("project-commands.button.dismiss")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              stopBubble(e);
              actions.onDismiss?.(group, cmd);
            }}
          >
            <Icon icon={shellIcons.close} pixels={12} />
          </button>
        </Tooltip>
      ) : null}
    </span>
  );
}

function StatusMark({ run }: { run: ProjectCommandRun | undefined }) {
  if (isCommandActive(run)) {
    return (
      <span
        className={`${styles.dot} ${styles.dotRunning}`}
        aria-label={t("project-commands.label.running")}
      />
    );
  }
  if (run?.status === "timed_out") {
    return (
      <>
        <span className={`${styles.dot} ${styles.dotFailed}`} />
        <span className={styles.statusText}>
          {t("project-commands.label.timed-out")}
        </span>
      </>
    );
  }
  if (isCommandFailed(run)) {
    return (
      <>
        <span className={`${styles.dot} ${styles.dotFailed}`} />
        {run?.exit_code != null ? (
          <span className={styles.statusText}>
            {t("project-commands.label.failed", { code: run.exit_code })}
          </span>
        ) : null}
      </>
    );
  }
  return null;
}

function runningCountOf(group: ProjectCommandGroup): number {
  let count = 0;
  for (const cmd of group.commands) {
    if (isCommandActive(group.runs.get(cmd.id))) count++;
  }
  return count;
}

/** Popover용 공용 목록(Terminal hover, 사이드바 project + hover, 사이드바 상태 표시 클릭). */
export function ProjectCommandsList({
  groups,
  actions,
  showEmpty = false,
  heading,
}: {
  groups: readonly ProjectCommandGroup[];
  actions: ProjectCommandActions;
  showEmpty?: boolean;
  heading?: ReactNode;
}) {
  const nonEmpty = groups.filter((g) => g.commands.length > 0);
  const totalRunning = nonEmpty.reduce((sum, g) => sum + runningCountOf(g), 0);

  return (
    <div className={styles.list} data-project-commands-list="">
      {heading === undefined ? null : (
        <div className={styles.groupHead}>{heading}</div>
      )}
      {nonEmpty.length === 0 && showEmpty ? (
        <div className={styles.empty}>{t("project-commands.label.empty")}</div>
      ) : null}
      {nonEmpty.map((group, groupIndex) => (
        <Fragment key={`${group.machine ?? "local"}:${group.projectId}`}>
          {groupIndex > 0 ? <div className={styles.divider} /> : null}
          {group.machine !== null && group.machineName !== undefined ? (
            <div className={styles.groupHead}>{group.machineName}</div>
          ) : null}
          {group.commands.map((cmd) => {
            const run = group.runs.get(cmd.id);
            const running = isCommandActive(run);
            return (
              <div
                key={cmd.id}
                className={styles.row}
                data-project-command={cmd.id}
                data-machine={group.machine ?? undefined}
              >
                <button
                  type="button"
                  className={styles.rowMain}
                  onClick={() => {
                    if (running && run?.terminal_id != null) {
                      actions.onViewTerminal(group, cmd, run);
                    } else if (!running) {
                      actions.onRun(group, cmd);
                    }
                  }}
                >
                  <span className={styles.rowIcon}>
                    <CommandIconGlyph />
                  </span>
                  <span className={styles.rowName}>{cmd.name}</span>
                  <StatusMark run={run} />
                </button>
                <InlineActions
                  group={group}
                  cmd={cmd}
                  run={run}
                  actions={actions}
                />
              </div>
            );
          })}
          {runningCountOf(group) >= 2 && nonEmpty.length > 1 ? (
            <PopoverRow onSelect={() => actions.onStopAll(group)}>
              <span className={styles.rowIcon}>
                <Icon icon={projectCommandActionIcons.stop} pixels={14} />
              </span>
              <span className={styles.rowName}>
                {t("project-commands.button.stop-all")}
              </span>
            </PopoverRow>
          ) : null}
        </Fragment>
      ))}
      {totalRunning >= 2 &&
      nonEmpty.length === 1 &&
      nonEmpty[0] !== undefined ? (
        <>
          <div className={styles.divider} />
          <PopoverRow onSelect={() => actions.onStopAll(nonEmpty[0]!)}>
            <span className={styles.rowIcon}>
              <Icon icon={projectCommandActionIcons.stop} pixels={14} />
            </span>
            <span className={styles.rowName}>
              {t("project-commands.button.stop-all")}
            </span>
          </PopoverRow>
        </>
      ) : null}
      {actions.onManage === undefined ? null : (
        <>
          <div className={styles.divider} />
          <PopoverRow onSelect={actions.onManage}>
            <span className={styles.rowIcon}>
              <Icon icon={commonIcons.settings} pixels={14} />
            </span>
            <span className={styles.rowName}>
              {t("project-commands.button.manage")}
            </span>
          </PopoverRow>
        </>
      )}
    </div>
  );
}

/** 탭 줄 + 메뉴의 Terminal 하위 메뉴 항목(같은 공용 데이터·행 구성). */
export function projectCommandsMenuItems(
  groups: readonly ProjectCommandGroup[],
  actions: ProjectCommandActions,
  register: (id: string, fn: () => void) => void,
): MenuItem[] {
  const nonEmpty = groups.filter((g) => g.commands.length > 0);
  const items: MenuItem[] = [];

  for (const group of nonEmpty) {
    const scope = `${group.machine ?? "local"}:${group.projectId}`;
    const groupRunning = runningCountOf(group);
    group.commands.forEach((cmd, index) => {
      const run = group.runs.get(cmd.id);
      const running = isCommandActive(run);
      const id = `pcmd:${scope}:${cmd.id}`;
      register(id, () => {
        if (running && run?.terminal_id != null) {
          actions.onViewTerminal(group, cmd, run);
        } else if (!running) {
          actions.onRun(group, cmd);
        }
      });
      items.push({
        id,
        textValue: cmd.name,
        leading: (
          <MenuIcon>
            <CommandIconGlyph />
          </MenuIcon>
        ),
        label: (
          <span className={styles.menuRowContent}>
            <span className={styles.rowName}>{cmd.name}</span>
            <StatusMark run={run} />
            <InlineActions
              group={group}
              cmd={cmd}
              run={run}
              actions={actions}
            />
          </span>
        ),
        ...(index === 0
          ? {
              ...(items.length > 0 ? { separatorBefore: true } : {}),
              heading:
                group.machine !== null && group.machineName !== undefined
                  ? group.machineName
                  : t("left-sidebar.heading.commands"),
            }
          : {}),
      });
    });

    if (groupRunning >= 2) {
      const stopAllId = `pcmd-stop-all:${scope}`;
      register(stopAllId, () => actions.onStopAll(group));
      items.push({
        id: stopAllId,
        label: t("project-commands.button.stop-all"),
        leading: <MenuIcon icon={projectCommandActionIcons.stop} />,
      });
    }
  }

  if (actions.onManage !== undefined) {
    const manageId = "pcmd-manage";
    const onManage = actions.onManage;
    register(manageId, () => onManage());
    items.push({
      id: manageId,
      label: t("project-commands.button.manage"),
      leading: <MenuIcon icon={commonIcons.settings} />,
      ...(items.length > 0 ? { separatorBefore: true } : {}),
    });
  }

  return items;
}
