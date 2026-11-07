// 앱 bridge(`lophnApp`)를 쓰는 UI. 버튼·hook은 선언의 operation 하나를 부르고, 경계는 앱 화면 root의 render 오류를 받는다.
// `useTabHead`는 화면의 머리 조작을 그 화면이 열린 lophn 탭의 머리 줄에 올린다.
// `usePlace`는 화면이 열린 자리·인자·workspace를 준다.
// 조작은 lophn 화면과 같은 component(`@lophn/ui`)로 그린다.
export {
  OperationButton,
  type OperationButtonProps,
} from "./operation-button.tsx";
export {
  type AppBridge,
  appBridge,
  type OperationInput,
  type OperationResult,
  type OperationSpec,
  type OperationState,
  type UseOperation,
  useOperation,
} from "./use-operation.ts";
export {
  AppErrorBoundary,
  type AppErrorBoundaryProps,
  RENDER_ERROR_EVENT,
} from "./app-error-boundary.tsx";
export {
  type TabHead,
  type TabHeadAction,
  type TabHeadBridge,
  type TabHeadEvent,
  type TabHeadHandlers,
  type TabHeadItem,
  useTabHead,
} from "./use-tab-head.ts";
export {
  type Place,
  type PlaceJson,
  type PlaceValue,
  type PlaceWorkspace,
  usePlace,
} from "./use-place.ts";
