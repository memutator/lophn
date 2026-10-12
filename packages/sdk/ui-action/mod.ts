// blueprint command의 버튼과 확인 표시. 확인은 effect가 아니라 선언의 confirm을 따르고,
// 호출은 앱 view의 `lophnApp.call` 하나로만 한다. 사람 확인 창과 approval은 lophn이 그 호출 안에서 연다.
export { CommandButton, type CommandButtonProps } from "./command-button.tsx";
export {
  type AppBridge,
  appBridge,
  type CommandInput,
  type CommandResult,
  type CommandSpec,
  type CommandState,
  type UseCommand,
  useCommand,
} from "./use-command.ts";
export { systemTimer, type Timer } from "@lophn/design/components";
