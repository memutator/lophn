// float chip 묶음. 전역 float이 먼저이고 그 뒤가 지금 desk의 float이다. 작업 표시줄(아이콘과 이름)과 꺼졌을 때의
// tab 줄 끝(아이콘만)이 같이 쓴다. 바깥을 누를 때 float이 접히지 않도록 `data-float-chips`를 단다(float-layer.tsx NOT_OUTSIDE).
import { t } from "@lophn/i18n";
import { Icon } from "@lophn/ui/primitives";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import type { ReactNode } from "react";

import { browserIcons } from "../../icons/mod.ts";
import styles from "./float-chips.module.css";

export interface FloatChip {
  readonly key: string;
  /** tooltip과 접근성 이름. */
  readonly title: string;
  readonly icon: ReactNode;
  /** 이름을 보이는 chip의 글. 없으면 title이다. */
  readonly label?: string;
}

// chip이 이만큼을 넘으면 나머지는 +N 메뉴로 들어간다. tab이 쓸 폭을 지킨다.
const SHOWN = 4;

export function FloatChips({
  global,
  desk,
  pressed,
  named = false,
  className,
  onToggleGlobal,
  onToggleDesk,
}: {
  readonly global: readonly FloatChip[];
  readonly desk: readonly FloatChip[];
  /** 지금 펴져 있는 chip의 key. 눌린 모양이다. */
  readonly pressed: readonly string[];
  /** 이름을 chip에 보인다. */
  readonly named?: boolean;
  readonly className?: string;
  readonly onToggleGlobal?: (key: string) => void;
  readonly onToggleDesk: (key: string) => void;
}) {
  const chips = [...global, ...desk];
  if (chips.length === 0) return null;
  // key가 겹치지 않아 누른 key로 어느 쪽인지 가린다.
  const globalKeys = new Set(global.map((chip) => chip.key));
  const toggle = (key: string) =>
    globalKeys.has(key) ? onToggleGlobal?.(key) : onToggleDesk(key);
  const hidden = chips.slice(SHOWN);
  return (
    <div
      className={className}
      data-float-chips=""
      role="group"
      aria-label={t("shell.label.minimized")}
    >
      {chips.slice(0, SHOWN).map((chip) => (
        <Tooltip key={chip.key} content={chip.title}>
          <button
            type="button"
            className={styles.chip}
            data-named={named || undefined}
            aria-label={chip.title}
            aria-pressed={pressed.includes(chip.key)}
            onClick={() => toggle(chip.key)}
          >
            {chip.icon}
            {globalKeys.has(chip.key) ? (
              <Icon
                icon={browserIcons.globe}
                pixels={8}
                className={styles.globalMark}
              />
            ) : null}
            {named ? (
              <span className={styles.name}>{chip.label ?? chip.title}</span>
            ) : null}
          </button>
        </Tooltip>
      ))}
      {hidden.length === 0 ? null : (
        <Menu
          placement="corner"
          onSelect={toggle}
          items={hidden.map((chip) => ({
            id: chip.key,
            label: chip.title,
            leading: <MenuIcon>{chip.icon}</MenuIcon>,
          }))}
          trigger={
            <button
              type="button"
              className={styles.chip}
              data-minimized-more=""
              aria-label={t("shell.button.minimized-more", {
                count: hidden.length,
              })}
            >
              +{hidden.length}
            </button>
          }
        />
      )}
    </div>
  );
}
