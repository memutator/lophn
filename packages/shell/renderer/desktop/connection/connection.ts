// main이 민 연결 상태만 본다. token·port는 이 쪽에 없다.
import {
  type ConnectionState,
  connectionStateSchema,
  type CoreCall,
  type CoreEventMessage,
  type CoreWatch,
} from "../../../ipc/core.ts";
import type { CoreApi, CoreReply } from "../../../ipc/core-api.ts";

export type { ConnectionState };

export interface CoreSource {
  subscribe(listener: (state: ConnectionState) => void): () => void;
  /**
   * 이 창이 지금까지 받은 마지막 상태. 앱 공간에서 런처로 돌아와 새로 마운트한 화면이
   * starting에서 시작하지 않게 한다. 아직 받은 것이 없으면 undefined다.
   */
  current?(): ConnectionState | undefined;
  call(input: CoreCall): Promise<CoreReply>;
  // 둘 다 없으면 event를 못 받는 source다(event를 쓰지 않는 mock). event client가 건너뛴다.
  /** 이 창의 구독 조건 전체를 통째로 바꾼다. */
  watch?(conditions: CoreWatch["conditions"]): Promise<void>;
  /** main이 중계한 Gateway 메시지(ready·event·closed)를 듣는다. */
  onEvent?(listener: (message: CoreEventMessage) => void): () => void;
}

const STARTING: ConnectionState = { state: "starting", confirmedAt: null };

function readBridge(): CoreApi | undefined {
  const bridge = (globalThis as { lophnCore?: CoreApi }).lophnCore;
  if (!bridge || typeof bridge.subscribe !== "function") return undefined;
  return bridge;
}

/** preload가 없으면 starting만 보고 call은 거절한다. 테스트는 source를 끼운다. */
export function windowCoreSource(): CoreSource {
  const bridge = readBridge();
  if (!bridge) {
    return {
      subscribe: () => () => {},
      watch: () => Promise.resolve(),
      onEvent: () => () => {},
      call: () =>
        Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "core bridge is missing" },
        }),
    };
  }
  // 창이 사는 동안 하나만 듣고 마지막 상태를 기억한다. main이 이미 지나간 상태를 다시 밀지
  // 않아도 새 화면이 지금 상태를 바로 읽는다.
  let last: ConnectionState | undefined;
  bridge.subscribe((payload) => {
    const parsed = connectionStateSchema.safeParse(payload);
    if (parsed.success) last = parsed.data;
  });
  return {
    subscribe(listener) {
      return bridge.subscribe((payload) => {
        const parsed = connectionStateSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      });
    },
    current: () => last,
    call: (input) => bridge.call(input),
    watch: (conditions) => bridge.watch(conditions),
    onEvent: (listener) => bridge.onEvent(listener),
  };
}

export const initialConnection: ConnectionState = STARTING;
