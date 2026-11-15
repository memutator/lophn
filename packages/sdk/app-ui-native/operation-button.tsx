import { View } from "react-native";
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
  Text,
} from "@lophn/ui-native";
import { t } from "@lophn/i18n";
import {
  type AppBridge,
  type OperationInput,
  type OperationSpec,
  useOperation,
} from "../app-ui/use-operation.ts";

export interface OperationButtonProps {
  operation: OperationSpec;
  // 입력, 또는 누를 때 입력을 만드는 함수. 없으면 null이다.
  input?: OperationInput | (() => OperationInput);
  // 버튼 글. 없으면 선언한 operation의 title이다.
  children?: string;
  // 앱 화면의 `lophnApp`. 없으면 전역의 것을 쓴다.
  app?: AppBridge;
  onDone?: (value: unknown) => void;
  onFailed?: (code: string) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
}

// 선언한 operation 하나의 단추. 실행 중에는 다시 누를 수 없고 실패는 단추 옆에 남는다.
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
  const label = children ?? operation.title;
  const press = async () => {
    const value = typeof input === "function" ? input() : input;
    const result = await run(value);
    if (result?.ok) onDone?.(result.value);
    else if (result) onFailed?.(result.code);
  };
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Button
        variant={variant}
        size={size}
        disabled={disabled || state.status === "pending"}
        onPress={() => void press()}
      >
        {label}
      </Button>
      {state.status === "failed" && (
        <Text variant="detail" tone="critical">
          {t("common.error.action-failed", { action: label })}
        </Text>
      )}
    </View>
  );
}
