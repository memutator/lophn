// main이 민 연결 상태만 본다. token·port는 이 쪽에 없다.
import {
  type ConnectionState,
  connectionStateSchema,
  type CoreCall,
} from "../../../ipc/core.ts";
import type { CoreApi, CoreReply } from "../../../ipc/core-api.ts";

export type { ConnectionState };

export interface CoreSource {
  subscribe(listener: (state: ConnectionState) => void): () => void;
  call(input: CoreCall): Promise<CoreReply>;
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
      call: () =>
        Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "core bridge is missing" },
        }),
    };
  }
  return {
    subscribe(listener) {
      return bridge.subscribe((payload) => {
        const parsed = connectionStateSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      });
    },
    call: (input) => bridge.call(input),
  };
}

export const initialConnection: ConnectionState = STARTING;
