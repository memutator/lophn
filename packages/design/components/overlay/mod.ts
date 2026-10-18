// overlay: 화면 위에 뜨는 component.
// 요소 이름이나 짧은 설명을 hover·focus에 잠깐 보인다. 눌러서 고르는 것은 담지 않는다.
export { Tooltip, type TooltipProps } from "./tooltip/tooltip.tsx";
// 눌러서 여는 작은 면. 바깥을 누르면 닫히고 modal이 아니다. 행동 목록이면 Menu를 쓴다.
export { Popover, type PopoverProps } from "./popover/popover.tsx";
// Popover 안에서 고를 수 있는 한 줄.
export { PopoverRow, type PopoverRowProps } from "./popover/popover.tsx";
// 행동 목록을 여는 메뉴. 키보드 이동과 typeahead가 된다. 자유 내용은 Popover를 쓴다.
export { Menu, type MenuItem, type MenuProps } from "./menu/menu.tsx";
// Menu 항목 앞에 놓는 아이콘 칸. 아이콘이나 FileIcon 같은 요소를 칸에 맞춘다.
export { MenuIcon } from "./menu/menu.tsx";
// 작업을 멈추고 답을 받는 modal. 뒤 화면을 가리고 focus를 가둔다. 뒤를 보며 하면 Sheet다.
export {
  Dialog,
  type DialogProps,
  type DialogWidth,
} from "./dialog/dialog.tsx";
// backdrop 없이 뒤 화면을 두고 여는 면. 참고하며 입력할 때 쓴다. 답이 먼저면 Dialog다.
export { Sheet, type SheetProps } from "./sheet/sheet.tsx";
// 부모 안에서 옮기고 크기를 바꾸는 패널의 껍데기. 위치는 부모가 정하고 끌기 논리는 갖지 않는다. 뒤 화면을 막는 면은 Dialog나 Sheet다.
export {
  type FloatEdge,
  FloatPanel,
  type FloatPanelProps,
} from "./float-panel/float-panel.tsx";
// 검색해서 고르는 명령·이동 창. 목록이 길 때 쓰고 짧은 목록은 Select나 Menu다.
export {
  Palette,
  type PaletteItem,
  type PaletteProps,
} from "./palette/palette.tsx";
// 잠깐 뜨는 알림 하나. 조작 결과를 알리고 행동을 최대 3개 단다. 계속 보이는 상태는 StatusMark다.
export {
  Toast,
  type ToastAction,
  type ToastDuration,
  type ToastProps,
  type ToastTone,
} from "./toast/toast.tsx";
// Toast들을 오른쪽 아래 층에 쌓는다. 앱 root에 한 번 둔다.
export { ToastStack } from "./toast/toast.tsx";
// toast를 띄우는 queue를 앱 root에 둔다. useToast로 어디서든 띄우고, 직접 쌓으려면 Toast와 ToastStack이다.
export {
  type ToastOptions,
  ToastProvider,
  type ToastProviderProps,
  type ToastQueue,
  useToast,
} from "./toast/toast-queue.tsx";
