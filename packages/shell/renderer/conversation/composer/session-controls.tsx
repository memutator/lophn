// composer 입력칸 안 줄의 mode 하나. source가 내는 mode 중 하나를 고른다. model option 축(effort·speed)은 model 메뉴 안에서 고른다.

import { t } from "@lophn/i18n";
import { Popover, PopoverRow } from "@lophn/ui/overlay";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { useState } from "react";
import type { AcpChoice } from "../../../../protocol/acp/mod.ts";
import { conversationIcons } from "../../icons/mod.ts";
import styles from "./session-controls.module.css";

interface ModeMenuProps {
  current: string | null;
  choices: readonly AcpChoice[];
  onChange: (mode: string) => void;
}

// 첫 mode가 기본(묻기)이다. 다른 mode는 묻지 않고 실행하는 등 값이 달라서 켜져 있으면 경고색으로 알린다.
export function ModeMenu({ current, choices, onChange }: ModeMenuProps) {
  const [open, setOpen] = useState(false);
  const shown = choices.find((choice) => choice.id === current) ?? choices[0];
  const choose = (id: string) => {
    setOpen(false);
    if (id !== current) onChange(id);
  };
  return (
    <span
      className={styles.permission}
      data-on={shown !== choices[0] || undefined}
    >
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
            {shown?.label}
          </Button>
        }
      >
        <div
          className={styles.menu}
          role="group"
          aria-label={t("conversation.label.permission-mode")}
        >
          {choices.map((choice) => (
            <PopoverRow key={choice.id} onSelect={() => choose(choice.id)}>
              <span className={styles.check}>
                {choice.id === shown?.id ? (
                  <Icon
                    icon={conversationIcons.current}
                    pixels={iconPixels("base")}
                  />
                ) : null}
              </span>
              {choice.label}
            </PopoverRow>
          ))}
        </div>
      </Popover>
    </span>
  );
}
