// renderer가 보는 core 통로. token·port·channel 이름은 여기 없다.
import type {
  ConnectionState,
  CoreCall,
  CoreEventMessage,
  CoreWatch,
} from "./core.ts";

export interface CoreReply {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

export interface CoreApi {
  /** 연결 상태를 듣고 지금 상태를 돌려받는다. 해제는 반환 함수다. */
  subscribe(listener: (state: ConnectionState) => void): () => void;
  /** allowlist의 read·command 하나를 부른다. */
  call(input: CoreCall): Promise<CoreReply>;
  /** 이 renderer의 구독 조건을 통째로 바꾼다. */
  watch(conditions: CoreWatch["conditions"]): Promise<void>;
  /** main이 중계한 Gateway 메시지를 듣는다. 해제는 반환 함수다. */
  onEvent(listener: (message: CoreEventMessage) => void): () => void;
}
