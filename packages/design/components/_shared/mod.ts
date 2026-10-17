// component가 함께 쓰는 보조(시계, 크기 관찰, 표식).
export {
  type Clipboard,
  type Clock,
  componentMark,
  type ControlSize,
  iconPixels,
  systemClipboard,
  systemClock,
  systemTimer,
  type Timer,
} from "./shared.ts";
export {
  domResizeSource,
  type ResizeSource,
  ResizeSourceProvider,
  type Size,
  useObservedSize,
} from "./resize.ts";
