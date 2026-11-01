import { CircleX, Clock } from "lucide-react";
import { useLophnT } from "./locale.ts";
import { Button, type ButtonVariant, Icon } from "@lophn/ui/primitives";
import { componentMark, type ControlSize, iconPixels } from "@lophn/ui/shared";
import {
  type AppBridge,
  type OperationInput,
  type OperationSpec,
  useOperation,
} from "./use-operation.ts";
import styles from "./action.module.css";

export interface OperationButtonProps {
  operation: OperationSpec;
  // 입력, 또는 누를 때 입력을 만드는 함수. 없으면 null이다.
  input?: OperationInput | (() => OperationInput);
  // 버튼 글. 없으면 선언한 operation의 title이다.
  children?: string;
  // 앱 view의 `lophnApp`. 없으면 window의 것을 쓴다.
  app?: AppBridge;
  onDone?: (value: unknown) => void;
  onFailed?: (code: string) => void;
  variant?: ButtonVariant;
  size?: ControlSize;
  disabled?: boolean;
}

// 선언한 operation 하나의 버튼. 실행 중에는 다시 누를 수 없고 실패는 버튼 옆에 남는다.
export function OperationButton({
  operation,
  input = null,
  children,
  app,
  onDone,
  onFailed,
  variant = "secondary",
  size = "md",
  disabled = false,
}: OperationButtonProps) {
  const { state, run } = useOperation(operation, app);
  const t = useLophnT();
  const label = children ?? operation.title;
  const pending = state.status === "pending";
  const press = async () => {
    const value = typeof input === "function" ? input() : input;
    const result = await run(value);
    if (result?.ok) onDone?.(result.value);
    else if (result) onFailed?.(result.code);
  };
  return (
    <span
      className={styles.action}
      data-operation={operation.name}
      {...componentMark("OperationButton")}
    >
      <Button
        variant={variant}
        size={size}
        icon={pending ? Clock : undefined}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        onClick={() => void press()}
      >
        {label}
      </Button>
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
