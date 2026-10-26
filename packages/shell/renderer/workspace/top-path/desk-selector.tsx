import type { LucideIcon } from "lucide-react";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import {
  commonIcons,
  conversationIcons,
  editorIcons,
} from "../../icons/mod.ts";
import styles from "./desk-selector.module.css";

export interface DeskOption {
  /** default 자리(`_default`) 또는 workflow 이름. */
  readonly key: string;
  /** 보일 이름. workflow는 `<name>`. */
  readonly label: string;
  /** 선언이 틀려 시작은 못 하지만 자리는 열 수 있는 workflow. */
  readonly invalid?: boolean;
}

export interface DeskSelectorProps {
  /** 첫 항목이 늘 기본 자리다. */
  readonly options: readonly DeskOption[];
  /** options의 key. */
  readonly active: string;
  readonly onSelect: (key: string) => void;
  /** menu가 열리고 닫힐 때. 열 때 목록을 다시 읽는 데 쓴다. */
  readonly onOpenChange?: (open: boolean) => void;
}

const pixels = iconPixels("small");

function InvalidMark() {
  const label = t("project-workspace.label.desk-invalid");
  return (
    <Tooltip content={label}>
      <span className={styles.invalid} role="img" aria-label={label}>
        <Icon icon={editorIcons.problem} pixels={pixels} />
      </span>
    </Tooltip>
  );
}

/** 상단 바 왼쪽 경로의 `/`. project 조각과 desk 조각 사이에 둔다. */
export function PathSep() {
  return <span className={styles.sep} aria-hidden="true">/</span>;
}

interface PathMenuProps {
  /** data 표식(`data-path-selector`)이자 좁을 때 양보 순서다: desk가 project보다 먼저 줄어든다. */
  readonly kind: "desk" | "project";
  readonly label: string;
  readonly icon: LucideIcon;
  readonly items: readonly {
    readonly id: string;
    readonly label: string;
    readonly invalid?: boolean;
  }[];
  readonly active: string;
  readonly onSelect: (id: string) => void;
  readonly onOpenChange?: (open: boolean) => void;
}

// project·desk selector가 같이 쓰는 경로 조각: 이름과 chevron 단추 하나, 누르면 목록 menu.
export function PathMenu(
  { kind, label, icon, items, active, onSelect, onOpenChange }: PathMenuProps,
) {
  const current = items.find((item) => item.id === active) ?? items[0];
  return (
    <Menu
      trigger={
        <button
          type="button"
          className={styles.trigger}
          aria-label={label}
          data-path-selector={kind}
        >
          <span className={styles.name}>{current?.label}</span>
          {current?.invalid === true ? <InvalidMark /> : null}
          <Icon icon={commonIcons.collapse} pixels={pixels} />
        </button>
      }
      items={items.map((item) => ({
        id: item.id,
        textValue: item.label,
        data: { "data-path-option": item.id },
        leading: <MenuIcon icon={icon} />,
        label: (
          <span className={styles.item}>
            <span className={styles.name}>{item.label}</span>
            {item.invalid === true ? <InvalidMark /> : null}
            {item.id === active
              ? <Icon icon={conversationIcons.current} pixels={pixels} />
              : null}
          </span>
        ),
      }))}
      onSelect={onSelect}
      onOpenChange={onOpenChange}
    />
  );
}

// 상단 바 왼쪽 경로의 자리(desk) 조각. 틀린 선언은 오류 표시가 붙지만 고를 수 있다(선언을 고치는 동안에도 자리는 열 수 있어야 한다).
export function DeskSelector(
  { options, active, onSelect, onOpenChange }: DeskSelectorProps,
) {
  return (
    <PathMenu
      kind="desk"
      label={t("project-workspace.label.desk-selector")}
      icon={commonIcons.series}
      items={options.map((option) => ({
        id: option.key,
        label: option.label,
        invalid: option.invalid,
      }))}
      active={active}
      onSelect={onSelect}
      onOpenChange={onOpenChange}
    />
  );
}
