// title bar 왼쪽의 desk 단추와 목록. desk 하나가 tab 줄·split·float을 통째로 가지므로 고르면 tab 줄이 통째로 바뀐다.
// workflow desk는 이름까지 강조해 보이고, 사람이 만든 desk는 아이콘과 이름만 보인다. 목록은 줄 안에 단추(이름 바꾸기,
// 지우기)를 두어야 해서 Menu가 아니라 Popover다.
import { Fragment, useEffect, useRef, useState } from "react";
import { t } from "@lophn/i18n";
import { Icon } from "@lophn/ui/primitives";
import { Popover } from "@lophn/ui/overlay";

import { actionIcons, shellIcons } from "../icons/mod.ts";
import styles from "./desk-switcher.module.css";

export interface DeskOption {
  readonly key: string;
  readonly label: string;
  /** workflow desk. Workflows 묶음에 들어간다. */
  readonly workflow?: boolean;
  /** workflow desk 이름 옆의 상태 글(예: "step 2/4 · your turn"). */
  readonly status?: string;
  /** 줄 오른쪽에 이름 바꾸기·지우기 단추를 둔다. Main과 workflow desk는 아니다. */
  readonly manageable?: boolean;
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
}

export function DeskSwitcher({
  desks,
  current,
  onSelect,
  onNewDesk,
  onRename,
  onDelete,
}: DeskSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const now = desks.find((desk) => desk.key === current) ?? desks[0];
  if (now === undefined) return null;
  const own = desks.filter((desk) => !desk.workflow);
  const flows = desks.filter((desk) => desk.workflow);
  const pick = (key: string) => {
    setOpen(false);
    onSelect(key);
  };
  const row = (desk: DeskOption) => (
    <div
      key={desk.key}
      className={styles.row}
      data-current={desk.key === now.key || undefined}
      data-desk-row={desk.key}
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
          {desk.status === undefined ? null : (
            <span className={styles.status}>{desk.status}</span>
          )}
        </button>
      )}
      {desk.manageable ? (
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            aria-label={t("shell.button.desk-rename", { name: desk.label })}
            onClick={() => setRenaming(desk.key)}
          >
            <Icon icon={actionIcons.edit} pixels={14} />
          </button>
          <button
            type="button"
            className={styles.action}
            aria-label={t("shell.button.desk-delete", { name: desk.label })}
            onClick={() => onDelete(desk.key)}
          >
            <Icon icon={shellIcons.close} pixels={14} />
          </button>
        </span>
      ) : null}
    </div>
  );
  return (
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
          </button>
        </div>
      </Popover>
    </span>
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
