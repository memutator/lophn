// composer 입력칸 안 줄의 권한 하나. 묻기·skip을 고른다. model option 축(effort·speed)은 model 메뉴 안에서 고른다.

import { t } from "@lophn/i18n";
import { Popover, PopoverRow } from "@lophn/ui/overlay";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { useState } from "react";
import { conversationIcons } from "../../icons/mod.ts";
import styles from "./session-controls.module.css";

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
