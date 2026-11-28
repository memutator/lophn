// tray popup이 화면 내용에 맞춰 크기를 정하도록 앱 page가 자기 내용 크기를 알리는 통로. 살려 두기(app-keep-alive.ts)와
// 같은 길이다: 앱 preload가 `sendToHost`로 올리고 renderer는 그 `<webview>` element의 `ipc-message`로 받는다.
// preload가 `tray` 자리에서만 잰다. 앱 code는 하는 일이 없다.

/** guest → host. 값은 {width, height}(CSS px)이다. */
export const APP_CONTENT_SIZE_CHANNEL = "app:content-size";

export interface ContentSize {
  /** 내용이 줄을 바꾸지 않고 다 보이는 데 필요한 문서 너비(max-content). 지금 popup 너비와 상관없는 값이라
   *  popup이 내용보다 넓으면 줄고 좁으면 는다. 세로 scrollbar가 자리를 차지하면 그 너비를 더한 값이다. */
  readonly width: number;
  /** body의 높이. html·body가 높이를 고정하지 않으면 내용 높이다. */
  readonly height: number;
}

/** 받은 값이 쓸 만한 크기인지. page가 보낸 값이라 모양을 믿지 않는다. */
export function readContentSize(value: unknown): ContentSize | null {
  if (value === null || typeof value !== "object") return null;
  const { width, height } = value as Record<string, unknown>;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  // 아직 mount되지 않은 빈 body(height 0)는 실제 크기가 아니다. 받으면 popup이 min 크기로 줄었다 튄다.
  if (width <= 0 || height <= 0) return null;
  return { width: Math.ceil(width), height: Math.ceil(height) };
}
