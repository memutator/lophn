// _shared: 분류 component가 함께 쓰는 지원 export(시계, 크기 관찰, 표식). 앱 화면이 아니라 component와 test가 쓴다.
// 누가 쓰나: 모든 component. annotation이 읽는 "어느 component인가" 표식을 root에 단다.
export { componentMark } from "./shared.ts";
// 누가 쓰나: 크기를 받는 component. 같은 줄의 control 높이와 아이콘 크기를 맞춘다.
export { type ControlSize, iconPixels } from "./shared.ts";
// 누가 쓰나: Toast·Tooltip. 현재 시각(ms)을 인자로 받고 test가 바꿔 끼운다.
export { type Clock, systemClock } from "./shared.ts";
// 누가 쓰나: Toast·Tooltip·Loading. 지연을 재는 timer를 인자로 받고 test가 바꿔 끼운다.
export { systemTimer, type Timer } from "./shared.ts";
// 누가 쓰나: CopyButton·CodeBlock. OS clipboard를 인자로 받고 test가 바꿔 끼운다.
export { type Clipboard, systemClipboard } from "./shared.ts";
// 누가 쓰나: 칸 폭을 보는 frame과 Table. viewport가 아닌 자기 칸의 크기를 관찰한다.
export {
  domResizeSource,
  type ResizeSource,
  ResizeSourceProvider,
  type Size,
  useObservedSize,
} from "./resize.ts";
