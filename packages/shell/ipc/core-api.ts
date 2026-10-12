// renderer가 보는 core 통로. token·port·channel 이름은 여기 없다.
import type { ConnectionState, CoreCall } from "./core.ts";

export interface CoreReply {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface CoreApi {
  /** 연결 상태를 듣고 지금 상태를 돌려받는다. 해제는 반환 함수다. */
  subscribe(listener: (state: ConnectionState) => void): () => void;
  /** allowlist의 read·command 하나를 부른다. */
  call(input: CoreCall): Promise<CoreReply>;
}
