// 앱 bridge(`lophnApp`)를 쓰는 UI. 버튼·hook은 blueprint app-api 하나를 부르고, 경계는 앱 화면 root의 render 오류를 받는다.
// 조작은 lophn 화면과 같은 component(`@lophn/ui`)로 그린다.
export { AppApiButton, type AppApiButtonProps } from "./app-api-button.tsx";
export {
  type AppApiInput,
  type AppApiResult,
  type AppApiSpec,
  type AppApiState,
  type AppBridge,
  appBridge,
  type UseAppApi,
  useAppApi,
} from "./use-app-api.ts";
export {
  AppErrorBoundary,
  type AppErrorBoundaryProps,
  RENDER_ERROR_EVENT,
} from "./app-error-boundary.tsx";
