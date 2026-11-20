// tray popup이 화면 내용에 맞춰 크기를 정하도록 앱 page가 자기 내용 크기를 알리는 통로. 살려 두기(app-keep-alive.ts)와
// 같은 길이다: 앱 preload가 `sendToHost`로 올리고 renderer는 그 `<webview>` element의 `ipc-message`로 받는다.
// preload가 `tray` 자리에서만 잰다. 앱 code는 하는 일이 없다.

/** guest → host. 값은 {overflow, height}(CSS px)이다. */
export const APP_CONTENT_SIZE_CHANNEL = "app:content-size";

export interface ContentSize {
  /** 문서가 가로로 넘치는 만큼(`scrollWidth - clientWidth`). 넘치지 않으면 0이다. guest 너비는 popup 테두리만큼
   *  좁으므로 너비 자체가 아니라 모자란 만큼을 올린다. */
  readonly overflow: number;
  /** body의 높이. html·body가 높이를 고정하지 않으면 내용 높이다. */
  readonly height: number;
}

/** 받은 값이 쓸 만한 크기인지. page가 보낸 값이라 모양을 믿지 않는다. */
export function readContentSize(value: unknown): ContentSize | null {
  if (value === null || typeof value !== "object") return null;
  const { overflow, height } = value as Record<string, unknown>;
  if (typeof overflow !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(overflow) || !Number.isFinite(height)) return null;
  // 아직 mount되지 않은 빈 body(height 0)는 실제 크기가 아니다. 받으면 popup이 min 높이로 줄었다 튄다.
  if (overflow < 0 || height <= 0) return null;
  return { overflow: Math.ceil(overflow), height: Math.ceil(height) };
}
