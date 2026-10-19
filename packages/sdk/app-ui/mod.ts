// 앱 bridge(`lophnApp`)를 쓰는 UI. 버튼·hook은 blueprint tool 하나를 부르고, 경계는 앱 화면 root의 render 오류를 받는다.
// 조작은 lophn 화면과 같은 component(`@lophn/ui`)로 그린다.
export { ToolButton, type ToolButtonProps } from "./tool-button.tsx";
export {
  type AppBridge,
  appBridge,
  type ToolInput,
  type ToolResult,
  type ToolSpec,
  type ToolState,
  type UseTool,
  useTool,
} from "./use-tool.ts";
export {
  AppErrorBoundary,
  type AppErrorBoundaryProps,
  RENDER_ERROR_EVENT,
} from "./app-error-boundary.tsx";
