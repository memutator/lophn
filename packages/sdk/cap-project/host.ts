// 앱 프로세스의 host가 설치하는 port 모양이다(cap-net·cap-secret의 host.ts와 같은 symbol·모양).
// 필드가 바뀌면 그쪽 host.ts도 같이 바꾼다.

export const CAP_HOST = Symbol.for("lophn.cap-host");

export type BrokerResponse = { status: number; body: unknown };

export type CapHost = {
  // broker socket으로 POST한다. host가 process_nonce·mode·credential을 붙인다.
  post(path: string, body: Record<string, unknown>): Promise<BrokerResponse>;
  // 지금 실행 중인 app-api 호출의 문맥이다. 호출 밖(시작 코드 등)이면 null이다.
  call(): { project: string | null } | null;
};

export function readHost(): CapHost | undefined {
  const port = (globalThis as Record<symbol, unknown>)[CAP_HOST];
  if (!port || typeof port !== "object") return;
  const candidate = port as Partial<CapHost>;
  if (
    typeof candidate.post !== "function" || typeof candidate.call !== "function"
  ) return;
  return candidate as CapHost;
}
