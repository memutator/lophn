// 폰 화면(React Native)이 앱 bridge(`lophnApp`)를 쓰는 hook과 operation 단추다. hook은 desktop `@lophn/app-ui`의 DOM 없는
// file을 그대로 다시 내서(설치 사본에서는 vendor/로 담긴다) 두 SDK가 갈라지지 않는다. 폰의 guest runtime과 desktop preview가
// 같은 전역 `lophnApp`을 주므로 같은 hook이 둘 다에서 돈다.
// `useTabHead`·`useCommand`·`useProjects`·`useKeepAlive`·`AppErrorBoundary`는 폰에 그 bridge나 경계가 없어 내지 않는다.
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
} from "../app-ui/use-operation.ts";
export { type EventBridge, useEvent } from "../app-ui/use-event.ts";
export {
  type AppFileState,
  type FilesBridge,
  useAppFile,
} from "../app-ui/use-app-file.ts";
export {
  type Place,
  type PlaceValue,
  type PlaceWorkspace,
  usePlace,
} from "../app-ui/use-place.ts";
