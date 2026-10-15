// 앱 프로세스의 host가 설치하는 port 중 cap-store가 읽는 부분이다. 같은 port를 cap-net·
// cap-secret도 읽으므로 symbol과 필드 이름이 같아야 한다(그쪽 host.ts와 함께 바꾼다).

export const CAP_HOST = Symbol.for("lophn.cap-host");

export type RuntimeMode = "live" | "preview" | "test";

export type StoreHost = {
  mode: RuntimeMode;
  // 앱 전용 data 영역이다. 앱의 SQLite DB는 이 안에 있다.
  dataPath: string;
};

export function readHost(): StoreHost | undefined {
  const port = (globalThis as Record<symbol, unknown>)[CAP_HOST];
  if (!port || typeof port !== "object") return;
  const candidate = port as Partial<StoreHost>;
  if (
    typeof candidate.dataPath !== "string" || candidate.dataPath.length === 0 ||
    (candidate.mode !== "live" && candidate.mode !== "preview" &&
      candidate.mode !== "test")
  ) return;
  return candidate as StoreHost;
}
