// composer 입력칸 안 줄의 mode 하나와 켜고 끄는 chip들. source가 내는 mode 중 하나를 고른다. model option 축(effort·speed)은 model 메뉴 안에서 고른다.

import { type MessageKey, t } from "@lophn/i18n";
import { Popover, PopoverRow, Tooltip } from "@lophn/ui/overlay";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import type { AcpChoice, AcpToggle } from "../../../../protocol/acp/mod.ts";
import {
  PERMISSION_MODES,
  type PermissionMode,
} from "../../../../protocol/lophn-agent/turn-values.ts";
import { conversationIcons } from "../../icons/mod.ts";
import styles from "./session-controls.module.css";

const MODE_LABEL: Record<PermissionMode, MessageKey> = {
  read_only: "conversation.label.mode-read_only",
  ask: "conversation.label.mode-ask",
  workspace: "conversation.label.mode-workspace",
  full: "conversation.label.mode-full",
};

function isPermissionMode(
  value: string | null | undefined,
): value is PermissionMode {
  return (
    value !== null &&
    value !== undefined &&
    (PERMISSION_MODES as readonly string[]).includes(value)
  );
}

function choiceLabel(choice: AcpChoice): string {
  return isPermissionMode(choice.id) ? t(MODE_LABEL[choice.id]) : choice.label;
}

interface ModeMenuProps {
  current: string | null;
  choices: readonly AcpChoice[];
  onChange: (mode: string) => void;
  /** `/` 명령이 menu를 열 수 있게 부모가 쥔다. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 4단계 권한 모드. `full`(다 맡기기)일 때만 경고색(`data-on`)을 켠다.
export function ModeMenu({
  current,
  choices,
  onChange,
  open,
  onOpenChange,
}: ModeMenuProps) {
  const shown = choices.find((choice) => choice.id === current) ?? choices[0];
  const choose = (id: string) => {
    onOpenChange(false);
    if (id !== current) onChange(id);
  };
  return (
    <span
      className={styles.permission}
      data-on={shown?.id === "full" || undefined}
      data-mode={shown?.id}
    >
      <Popover
        open={open}
        onOpenChange={onOpenChange}
        trigger={
          <Button
            size="sm"
            variant="ghost"
            trailingIcon={conversationIcons.expand}
            data-composer-skip=""
          >
            {shown === undefined ? null : choiceLabel(shown)}
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
              {choiceLabel(choice)}
            </PopoverRow>
          ))}
        </div>
      </Popover>
    </span>
  );
}

/** 켜고 끄는 session 설정(Codex plan mode, omp fast/slow, OpenCode auto-accept) chip 하나씩. 누르면 반대로 바꾼다. */
export function ToggleChips({
  toggles,
  onToggle,
}: {
  toggles: readonly AcpToggle[];
  onToggle: (id: string, on: boolean) => void;
}) {
  return toggles.map((toggle) => {
    const chip = (
      <Button
        size="sm"
        variant={toggle.on ? "secondary" : "ghost"}
        aria-pressed={toggle.on}
        data-toggle={toggle.id}
        onClick={() => onToggle(toggle.id, !toggle.on)}
      >
        {toggle.label}
      </Button>
    );
    return toggle.description === null ? (
      <span key={toggle.id}>{chip}</span>
    ) : (
      <Tooltip key={toggle.id} content={toggle.description}>
        {chip}
      </Tooltip>
    );
  });
}
