import { CircleX, Clock, ShieldCheck } from "lucide-react";
import { t } from "@lophn/wording";
import {
  Button,
  type ButtonVariant,
  componentMark,
  type ControlSize,
  Icon,
  iconPixels,
  type Timer,
  Tooltip,
} from "@lophn/design/components";
import {
  type AppBridge,
  type CommandInput,
  type CommandSpec,
  useCommand,
} from "./use-command.ts";
import styles from "./action.module.css";

export interface CommandButtonProps {
  command: CommandSpec;
  // 입력, 또는 누를 때 입력을 만드는 함수. 없으면 null이다.
  input?: CommandInput | (() => CommandInput);
  // 버튼 글. 없으면 blueprint의 command label이다.
  children?: string;
  // 앱 view의 `lophnApp`. 없으면 window의 것을 쓴다.
  app?: AppBridge;
  onDone?: (value: unknown) => void;
  onFailed?: (code: string) => void;
  variant?: ButtonVariant;
  size?: ControlSize;
  disabled?: boolean;
  timer?: Timer;
}

// blueprint command 하나의 버튼. confirm으로 선언한 command는 방패 표시가 있고, 누르면 lophn 확인 창이
// 사람의 결정을 받는 동안 기다림을 보인다. 실행 중에는 다시 누를 수 없고 실패는 버튼 옆에 남는다.
export function CommandButton(
  {
    command,
    input = null,
    children,
    app,
    onDone,
    onFailed,
    variant = "secondary",
    size = "md",
    disabled = false,
    timer,
  }: CommandButtonProps,
) {
  const { state, run } = useCommand(command, app);
  const label = children ?? command.label;
  const pending = state.status === "pending";
  const press = async () => {
    const value = typeof input === "function" ? input() : input;
    const result = await run(value);
    if (result?.ok) onDone?.(result.value);
    else if (result) onFailed?.(result.code);
  };
  const button = (
    <Button
      variant={variant}
      size={size}
      icon={pending ? Clock : command.confirm ? ShieldCheck : undefined}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-confirm={command.confirm || undefined}
      onClick={() => void press()}
    >
      {label}
    </Button>
  );
  return (
    <span
      className={styles.action}
      data-command={command.key}
      {...componentMark("CommandButton")}
    >
      {command.confirm
        ? (
          <Tooltip content={t("common.notice.asks-first")} timer={timer}>
            {button}
          </Tooltip>
        )
        : button}
      {pending && command.confirm && (
        <span className={styles.note} role="status">
          {t("common.notice.waiting-confirmation")}
        </span>
      )}
      {state.status === "failed" && (
        <span className={styles.note} role="status" data-failed="">
          <Icon
            icon={CircleX}
            pixels={iconPixels("base")}
            className={styles.critical}
          />
          {t("common.error.action-failed", { action: label })}
        </span>
      )}
    </span>
  );
}
