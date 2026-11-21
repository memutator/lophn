// 앱 bridge(`lophnApp`)를 쓰는 UI. 버튼·hook은 선언의 operation 하나를 부르고, 경계는 앱 화면 root의 render 오류를 받는다.
// `useTabHead`는 화면의 머리 조작을 그 화면이 열린 lophn 프레임(탭, panel, sidebar, tray, 카드)의 머리 줄에 올린다.
// `usePlace`는 화면이 열린 자리·인자·workspace를 준다.
// `useProjects`는 lophn project 목록을 읽는다. 앱은 project를 따로 만들지 않는다.
// `useMachines`는 사람의 컴퓨터 명단과 이 화면의 backend가 도는 컴퓨터를 읽는다.
// `useAppFile`은 앱 file(사진, 고른 file)의 손잡이를 화면이 그릴 주소로 바꾼다.
// `useEvent`는 앱 event(다른 앱·lophn이 낸 일이 일어난 뒤의 알림)를 화면이 떠 있는 동안 받는다.
// `useKeepAlive`는 일이 도는 동안 workspace를 떠나도 page를 살려 두게 한다.
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
  type TabHeadIcon,
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
export {
  type Project,
  type ProjectsBridge,
  type ProjectsState,
  type UseProjects,
  useProjects,
} from "./use-projects.ts";
export {
  type Machine,
  type MachinesBridge,
  type MachinesState,
  type UseMachines,
  useMachines,
} from "./use-machines.ts";
export { type KeepAliveBridge, useKeepAlive } from "./use-keep-alive.ts";
export { type EventBridge, useEvent } from "./use-event.ts";
export {
  type AppFileState,
  type FilesBridge,
  useAppFile,
} from "./use-app-file.ts";
export {
  type CommandOptions,
  type CommandBridge,
  useCommand,
} from "./use-command.ts";
