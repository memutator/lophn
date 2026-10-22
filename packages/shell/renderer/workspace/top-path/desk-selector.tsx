import { Menu, MenuIcon } from "@lophn/ui/overlay";
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
}

const pixels = iconPixels("small");

function InvalidMark() {
  return (
    <span
      className={styles.invalid}
      title={t("project-workspace.label.desk-invalid")}
    >
      <Icon icon={editorIcons.problem} pixels={pixels} />
    </span>
  );
}

// 상단 바 가운데의 자리 selector. 이름과 chevron 단추 하나이고 누르면 자리 목록이 열린다.
// 틀린 선언은 오류 표시가 붙지만 고를 수 있다(선언을 고치는 동안에도 자리는 열 수 있어야 한다).
export function DeskSelector({ options, active, onSelect }: DeskSelectorProps) {
  const current = options.find((option) => option.key === active) ?? options[0];
  return (
    <Menu
      trigger={
        <button
          type="button"
          className={styles.trigger}
          aria-label={t("project-workspace.label.desk-selector")}
          data-desk-selector=""
        >
          <span className={styles.name}>{current?.label}</span>
          {current?.invalid === true ? <InvalidMark /> : null}
          <Icon icon={commonIcons.collapse} pixels={pixels} />
        </button>
      }
      items={options.map((option) => ({
        id: option.key,
        textValue: option.label,
        data: { "data-desk-option": option.key },
        leading: <MenuIcon icon={commonIcons.series} />,
        label: (
          <span className={styles.item}>
            <span className={styles.name}>{option.label}</span>
            {option.invalid === true ? <InvalidMark /> : null}
            {option.key === active
              ? <Icon icon={conversationIcons.current} pixels={pixels} />
              : null}
          </span>
        ),
      }))}
      onSelect={onSelect}
    />
  );
}
