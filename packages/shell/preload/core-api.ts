// renderer가 보는 `lophnCore`. 연결 상태는 구독을 시작하는 순간 main에서 지금 값을 한 번 받고
// 이후 변화는 main이 민 것을 따른다. 앱 공간에서 런처로 돌아오거나 창을 다시 읽어 renderer가 새로
// 구독해도 main이 이미 보낸 상태를 놓치지 않는다. token·port는 이 통로에 없다.
import {
  type ConnectionState,
  connectionStateSchema,
  CORE_CALL_CHANNEL,
  CORE_STATE_CHANNEL,
  CORE_STATE_GET_CHANNEL,
  type CoreCall,
  coreCallSchema,
} from "../ipc/core.ts";
import type { CoreApi, CoreReply } from "../ipc/core-api.ts";

export interface CoreTransport {
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

const unavailable: CoreReply = {
  ok: false,
  error: { code: "unavailable", message: "Core transport is unavailable" },
};

// 상태는 schema로 거르고, call은 이름 모양만 맞을 때 넘긴다.
export function createCoreApi(transport: CoreTransport): CoreApi {
  return Object.freeze({
    subscribe(listener: (state: ConnectionState) => void) {
      let pushed = false;
      let released = false;
      const callback = (_event: unknown, payload: unknown) => {
        const parsed = connectionStateSchema.safeParse(payload);
        if (!parsed.success) return;
        pushed = true;
        listener(parsed.data);
      };
      transport.on(CORE_STATE_CHANNEL, callback);
      // 지금 상태. 답이 오기 전에 main이 더 새 상태를 밀었으면 그 쪽이 맞다.
      void transport.invoke(CORE_STATE_GET_CHANNEL).then((payload) => {
        if (released || pushed) return;
        const parsed = connectionStateSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      }, () => {});
      return () => {
        released = true;
        transport.removeListener(CORE_STATE_CHANNEL, callback);
      };
    },
    async call(input: CoreCall): Promise<CoreReply> {
      if (!coreCallSchema.safeParse(input).success) return unavailable;
      try {
        return await transport.invoke(CORE_CALL_CHANNEL, input) as CoreReply;
      } catch {
        return unavailable;
      }
    },
  });
}
