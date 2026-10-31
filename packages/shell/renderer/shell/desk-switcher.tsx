// title bar 왼쪽의 desk 단추와 메뉴. desk 하나가 tab 줄·split·float을 통째로 가지므로 고르면 tab 줄이 통째로 바뀐다.
// workflow desk는 이름까지 강조해 보이고, 사람이 만든 desk는 아이콘과 이름만 보인다.
import { t } from "@lophn/i18n";
import { Icon } from "@lophn/ui/primitives";
import { Menu, MenuIcon } from "@lophn/ui/overlay";

import { shellIcons } from "../icons/mod.ts";
import styles from "./desk-switcher.module.css";

export interface DeskOption {
  readonly key: string;
  readonly label: string;
  /** workflow desk. Workflows 묶음에 들어간다. */
  readonly workflow?: boolean;
  /** workflow desk 이름 옆의 상태 글(예: "step 2/4 · your turn"). */
  readonly status?: string;
}

export interface DeskSwitcherProps {
  /** 사람이 만든 desk(Main 포함)가 먼저, workflow desk가 뒤다. 순서는 호출자가 정한다. */
  desks: readonly DeskOption[];
  /** 지금 desk의 key. */
  current: string;
  onSelect: (key: string) => void;
  onNewDesk: () => void;
}

const NEW_DESK = "__new-desk";

export function DeskSwitcher({
  desks,
  current,
  onSelect,
  onNewDesk,
}: DeskSwitcherProps) {
  const now = desks.find((desk) => desk.key === current) ?? desks[0];
  if (now === undefined) return null;
  const own = desks.filter((desk) => !desk.workflow);
  const flows = desks.filter((desk) => desk.workflow);
  const row = (desk: DeskOption, index: number, heading: string) => ({
    id: desk.key,
    heading: index === 0 ? heading : undefined,
    separatorBefore: index === 0 && desk.workflow === true,
    textValue: desk.label,
    leading: (
      <MenuIcon
        icon={
          desk.key === now.key
            ? shellIcons.current
            : desk.workflow
              ? shellIcons.workflow
              : shellIcons.desk
        }
      />
    ),
    label: (
      <span className={styles.item}>
        <span>{desk.label}</span>
        {desk.status === undefined ? null : (
          <span className={styles.status}>{desk.status}</span>
        )}
      </span>
    ),
  });
  return (
    <span className={styles.slot}>
      <Menu
        placement="corner"
        onSelect={(id) => (id === NEW_DESK ? onNewDesk() : onSelect(id))}
        items={[
          ...own.map((desk, index) =>
            row(desk, index, t("shell.heading.desks")),
          ),
          ...flows.map((desk, index) =>
            row(desk, index, t("shell.heading.workflows")),
          ),
          {
            id: NEW_DESK,
            label: t("shell.button.new-desk"),
            separatorBefore: true,
            leading: <MenuIcon icon={shellIcons.add} />,
          },
        ]}
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
      />
    </span>
  );
}
