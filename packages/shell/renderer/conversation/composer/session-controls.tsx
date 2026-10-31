// composer 아래 줄에 서는 session 실행 설정. model option 축(effort·speed)마다 작은 dropdown 하나와, 묻기·skip을 고르는
// 권한 하나다. 값은 catalog가 주고, 고른 값은 모두 source가 이 session에 저장한다. 좁은 폭에서는 축 단추를 감추고
// model 메뉴 안의 축으로 모은다(omp와 같은 규칙). 권한은 항상 남는다.

import { t } from "@lophn/i18n";
import { Popover, PopoverRow } from "@lophn/ui/overlay";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { useState } from "react";
import { conversationIcons } from "../../icons/mod.ts";
import type { PickerAxisView } from "../model-picker/types.ts";
import styles from "./session-controls.module.css";

interface ModelAxisMenusProps {
  axes: readonly PickerAxisView[];
  values: Readonly<Record<string, string>>;
  onChange: (axis: string, value: string) => void;
}

export function ModelAxisMenus({
  axes,
  values,
  onChange,
}: ModelAxisMenusProps) {
  return (
    <div className={styles.axes} data-composer-axes="">
      {axes.map((axis) => (
        <AxisMenu
          key={axis.id}
          axis={axis}
          value={values[axis.id]}
          onPick={(value) => onChange(axis.id, value)}
        />
      ))}
    </div>
  );
}

function AxisMenu({
  axis,
  value,
  onPick,
}: {
  axis: PickerAxisView;
  value: string | undefined;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = axis.values.find((item) => item.value === value);
  const label = chosen?.label ?? t("conversation.label.model-axis-default");
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          size="sm"
          variant="ghost"
          trailingIcon={conversationIcons.expand}
          data-model-axis={axis.id}
        >
          {t("conversation.label.model-axis", {
            axis: axis.label,
            value: label,
          })}
        </Button>
      }
    >
      <div className={styles.menu} role="group" aria-label={axis.label}>
        {axis.values.map((item) => (
          <PopoverRow
            key={item.value}
            onSelect={() => {
              setOpen(false);
              onPick(item.value);
            }}
          >
            <span className={styles.check}>
              {value === item.value ? (
                <Icon
                  icon={conversationIcons.current}
                  pixels={iconPixels("base")}
                />
              ) : null}
            </span>
            {item.label}
          </PopoverRow>
        ))}
      </div>
    </Popover>
  );
}

interface PermissionMenuProps {
  /** true면 묻지 않고 실행한다(skip). */
  on: boolean;
  onChange: (on: boolean) => void;
}

export function PermissionMenu({ on, onChange }: PermissionMenuProps) {
  const [open, setOpen] = useState(false);
  const choose = (next: boolean) => {
    setOpen(false);
    if (next !== on) onChange(next);
  };
  return (
    <span className={styles.permission} data-on={on || undefined}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button
            size="sm"
            variant="ghost"
            trailingIcon={conversationIcons.expand}
            data-composer-skip=""
          >
            {on
              ? t("conversation.label.skip-permissions")
              : t("conversation.label.permission-ask")}
          </Button>
        }
      >
        <div
          className={styles.menu}
          role="group"
          aria-label={t("conversation.label.permission-mode")}
        >
          <PopoverRow onSelect={() => choose(false)}>
            <span className={styles.check}>
              {on ? null : (
                <Icon
                  icon={conversationIcons.current}
                  pixels={iconPixels("base")}
                />
              )}
            </span>
            {t("conversation.label.permission-ask")}
          </PopoverRow>
          <PopoverRow onSelect={() => choose(true)}>
            <span className={styles.check}>
              {on ? (
                <Icon
                  icon={conversationIcons.current}
                  pixels={iconPixels("base")}
                />
              ) : null}
            </span>
            {t("conversation.label.skip-permissions")}
          </PopoverRow>
        </div>
      </Popover>
    </span>
  );
}
