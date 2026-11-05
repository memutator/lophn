// 앱 프로세스의 host가 설치하는 port 모양이다. host는 entrypoint고 SDK는 apps 구현을
// import하지 않으므로 두 쪽이 같은 symbol과 모양으로 맞춘다(cap-tool의 APP_TOOL_PORT와 같은
// 방식). 자식 credential·process nonce는 host 안에만 있고 앱 코드와 SDK는 보지 못한다.
// 필드가 바뀌면 cap-net·cap-notify·cap-secret·cap-store의 host.ts를 같이 바꾼다.

export const CAP_HOST = Symbol.for("lophn.cap-host");

export type RuntimeMode = "live" | "preview" | "test";

// 지금 실행 중인 tool 호출의 문맥이다(`command`는 tool 이름이다). 호출 밖(시작 코드 등)이면 null이다.
export type CallContext = {
  command: string;
  inputHash: string;
  release: string | null;
  invocation: string | null;
};

export type BrokerResponse = { status: number; body: unknown };

// host는 cap-store가 읽는 dataPath(앱 data 영역)도 같은 port에 둔다.
export type CapHost = {
  mode: RuntimeMode;
  // broker socket으로 POST한다. host가 process_nonce·mode·credential을 붙인다.
  post(
    path: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<BrokerResponse>;
  call(): CallContext | null;
};

export function readHost(): CapHost | undefined {
  const port = (globalThis as Record<symbol, unknown>)[CAP_HOST];
  if (!port || typeof port !== "object") return;
  const candidate = port as Partial<CapHost>;
  if (
    typeof candidate.post !== "function" ||
    typeof candidate.call !== "function" ||
    (candidate.mode !== "live" &&
      candidate.mode !== "preview" &&
      candidate.mode !== "test")
  )
    return;
  return candidate as CapHost;
}
