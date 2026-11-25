// title bar 왼쪽의 desk 단추와 목록. desk 하나가 tab 줄·split·float을 통째로 가지므로 고르면 tab 줄이 통째로 바뀐다.
// workflow desk는 이름까지 강조해 보이고, 사람이 만든 desk는 아이콘과 이름만 보인다. 목록은 줄 안에 단추(이름 바꾸기,
// 지우기)를 두어야 해서 Menu가 아니라 Popover다.

import { t } from "@lophn/i18n";
import { Popover, Tooltip } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { Fragment, useEffect, useRef, useState } from "react";

import { useKeyLabel } from "../commands/react.tsx";
import { actionIcons, shellIcons } from "../icons/mod.ts";
import styles from "./desk-switcher.module.css";

export type DeskStatusTone = "working" | "needs_you" | "blocked";

export interface DeskOption {
  readonly key: string;
  readonly label: string;
  /** 목록 구역. Desks(divider 위, Main·사용자 desk·실행 중/열린 workflow instance desk)와 Workflows(divider 아래, workflow 정의). */
  readonly section?: "desks" | "workflows";
  /** workflow 아이콘과 강조 스타일을 쓴다(workflow instance desk와 workflow 정의 desk 모두). */
  readonly workflow?: boolean;
  /** tooltip 등에 보일 보조 이름(예: instance가 속한 workflow 이름). */
  readonly subtitle?: string;
  /** workflow instance desk 이름 옆의 상태 글(예: "execute · Running"). */
  readonly status?: string;
  /** workflow instance desk의 진행 상태 색/점(working | needs_you | blocked). */
  readonly tone?: DeskStatusTone;
  /** 줄 오른쪽에 이름 바꾸기 단추를 둔다(사람이 만든 desk와 workflow instance desk). */
  readonly renameable?: boolean;
  /** 줄 오른쪽에 지우기/닫기 단추를 둔다(사람이 만든 desk와 끝난 workflow instance desk). */
  readonly deletable?: boolean;
  /** 줄 오른쪽에 이름 바꾸기·지우기 단추를 둘 다 둔다(renameable·deletable의 축약). */
  readonly manageable?: boolean;
}

const TONE_PRIORITY: Record<DeskStatusTone, number> = {
  needs_you: 3,
  blocked: 2,
  working: 1,
};

/**
 * 현재 workspace의 활성 workflow desk 요약(점 색과 수).
 * needs_you > blocked > working 순으로 앞세워, Main에 있을 때도 title bar에서 진행 상태를 보게 한다.
 */
export function summarizeWorkflowDesks(
  desks: readonly DeskOption[],
): { readonly tone: DeskStatusTone; readonly count: number } | null {
  let count = 0;
  let top: DeskStatusTone | null = null;
  for (const desk of desks) {
    if (!desk.workflow || desk.tone === undefined) continue;
    count += 1;
    if (top === null || TONE_PRIORITY[desk.tone] > TONE_PRIORITY[top]) {
      top = desk.tone;
    }
  }
  return top === null ? null : { tone: top, count };
}

export interface DeskSwitcherProps {
  /** 사람이 만든 desk(Main 포함)가 먼저, workflow desk가 뒤다. 순서는 호출자가 정한다. */
  desks: readonly DeskOption[];
  /** 지금 desk의 key. */
  current: string;
  onSelect: (key: string) => void;
  onNewDesk: () => void;
  /** 이름을 확정했다. 빈 이름은 부르지 않는다. */
  onRename: (key: string, label: string) => void;
  onDelete: (key: string) => void;
  /** 올라가면 목록을 열고 지금 desk를 이름 바꾸기 상태로 둔다(desk.rename). 부르는 쪽은 바꿀 수 있는 desk일 때만 올린다. */
  renameAsk?: number;
}

export function DeskSwitcher({
  desks,
  current,
  onSelect,
  onNewDesk,
  onRename,
  onDelete,
  renameAsk,
}: DeskSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const keyLabel = useKeyLabel();
  const newDeskKey = keyLabel("desk.new");
  useEffect(() => {
    if (renameAsk === undefined || renameAsk === 0) return;
    setOpen(true);
    setRenaming(current);
  }, [renameAsk]);
  const now = desks.find((desk) => desk.key === current) ?? desks[0];
  if (now === undefined) return null;
  const sectionOf = (desk: DeskOption): "desks" | "workflows" =>
    desk.section ?? (desk.workflow ? "workflows" : "desks");
  const own = desks.filter((desk) => sectionOf(desk) === "desks");
  const flows = desks.filter((desk) => sectionOf(desk) === "workflows");
  const workflowSummary = summarizeWorkflowDesks(desks);
  // 현재 보고 있는 workflow instance가 유일한 활성 workflow면 숫자(1)는 중복이라 점만 보인다.
  const showSummaryCount =
    workflowSummary !== null &&
    (now.tone === undefined || workflowSummary.count > 1);
  const triggerTooltip =
    now.subtitle !== undefined && now.subtitle !== now.label
      ? `${now.label} / ${now.subtitle}`
      : now.label;
  const pick = (key: string) => {
    setOpen(false);
    onSelect(key);
  };
  const row = (desk: DeskOption) => {
    const canRename = desk.renameable ?? desk.manageable ?? false;
    const canDelete = desk.deletable ?? desk.manageable ?? false;
    const hasStatus = desk.status !== undefined || desk.tone !== undefined;
    return (
      <div
        key={desk.key}
        className={styles.row}
        data-current={desk.key === now.key || undefined}
        data-desk-row={desk.key}
        data-tone={desk.tone}
        data-has-status={hasStatus || undefined}
      >
        {desk.key === renaming ? (
          <>
            <span className={styles.lead}>
              <Icon
                icon={desk.workflow ? shellIcons.workflow : shellIcons.desk}
                pixels={16}
              />
            </span>
            <RenameInput
              label={desk.label}
              onDone={(name) => {
                if (name !== undefined && name !== desk.label) {
                  onRename(desk.key, name);
                }
                setRenaming(null);
              }}
            />
          </>
        ) : (
          <button
            type="button"
            className={styles.pick}
            onClick={() => pick(desk.key)}
          >
            <span className={styles.lead}>
              <Icon
                icon={
                  desk.key === now.key
                    ? shellIcons.current
                    : desk.workflow
                      ? shellIcons.workflow
                      : shellIcons.desk
                }
                pixels={16}
              />
            </span>
            <span className={styles.name}>{desk.label}</span>
            {!hasStatus ? null : (
              <span className={styles.status} data-tone={desk.tone}>
                {desk.tone === undefined ? null : (
                  <span
                    className={styles.dot}
                    data-tone={desk.tone}
                    aria-hidden="true"
                  />
                )}
                {desk.status === undefined ? null : <span>{desk.status}</span>}
              </span>
            )}
          </button>
        )}
        {desk.key !== renaming && (canRename || canDelete) ? (
          <span className={styles.actions}>
            {canRename ? (
              <button
                type="button"
                className={styles.action}
                aria-label={t("shell.button.desk-rename", { name: desk.label })}
                onClick={() => setRenaming(desk.key)}
              >
                <Icon icon={actionIcons.edit} pixels={14} />
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className={styles.action}
                aria-label={t("shell.button.desk-delete", { name: desk.label })}
                onClick={() => onDelete(desk.key)}
              >
                <Icon icon={shellIcons.close} pixels={14} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    );
  };
  return (
    <Tooltip
      content={triggerTooltip}
      open={open ? false : undefined}
      placement="corner"
    >
      <span className={styles.slot}>
        <Popover
          placement="corner"
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setRenaming(null);
          }}
          // 이름을 바꾸는 중의 Escape는 입력만 취소한다.
          onEscapeKeyDown={(event) => {
            if (renaming !== null) event.preventDefault();
          }}
          trigger={
            <button
              type="button"
              className={styles.button}
              data-workflow={now.workflow || undefined}
              data-desk-button=""
              aria-label={t("shell.button.desk", { name: now.label })}
            >
              <Icon
                icon={now.workflow ? shellIcons.workflow : shellIcons.desk}
                pixels={14}
              />
              <span className={styles.label}>{now.label}</span>
              {workflowSummary === null ? null : (
                <span
                  className={styles.summary}
                  data-tone={workflowSummary.tone}
                  data-desk-summary=""
                  aria-label={t("workflow.label.desk-summary", {
                    count: workflowSummary.count,
                  })}
                >
                  <span
                    className={styles.dot}
                    data-tone={workflowSummary.tone}
                    aria-hidden="true"
                  />
                  {showSummaryCount ? (
                    <span className={styles.summaryCount}>
                      {workflowSummary.count}
                    </span>
                  ) : null}
                </span>
              )}
              <Icon icon={shellIcons.expand} pixels={12} />
            </button>
          }
        >
          <div className={styles.list}>
            <p className={styles.heading}>{t("shell.heading.desks")}</p>
            {own.map(row)}
            {flows.length === 0 ? null : (
              <Fragment>
                <div className={styles.separator} />
                <p className={styles.heading}>{t("shell.heading.workflows")}</p>
                {flows.map(row)}
              </Fragment>
            )}
            <div className={styles.separator} />
            <button
              type="button"
              className={styles.pick}
              onClick={() => {
                setOpen(false);
                onNewDesk();
              }}
            >
              <span className={styles.lead}>
                <Icon icon={shellIcons.add} pixels={16} />
              </span>
              <span className={styles.name}>{t("shell.button.new-desk")}</span>
              {newDeskKey === null ? null : (
                <span className={styles.status}>{newDeskKey}</span>
              )}
            </button>
          </div>
        </Popover>
      </span>
    </Tooltip>
  );
}

// Enter는 확정, Escape는 취소(undefined), 빈 이름은 원래 이름이다. unmount 때 blur가 한 번 더 와도 두 번 확정하지 않는다.
function RenameInput({
  label,
  onDone,
}: {
  label: string;
  onDone: (name: string | undefined) => void;
}) {
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (name: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  const typed = (element: HTMLInputElement) => element.value.trim() || label;
  return (
    <input
      ref={input}
      className={styles.rename}
      aria-label={t("shell.label.desk-name")}
      defaultValue={label}
      onBlur={(event) => finish(typed(event.currentTarget))}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(typed(event.currentTarget));
        else if (event.key === "Escape") finish(undefined);
      }}
    />
  );
}
