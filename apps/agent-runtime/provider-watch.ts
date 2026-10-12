import { err, ok, type Result } from "../../packages/base/mod.ts";
import { eventsList } from "../../packages/protocol/platform/mod.ts";
import type { CoreRead } from "../../packages/lophn-agent/harness/run-loop/mod.ts";

// Disconnect한 provider로 진행 중인 run을 멈추게 하는 눈이다(lophn-agent/harness/provider#R4, R6).
// core의 ProviderDisconnected event를 cursor 뒤로 읽어 provider마다 회수를 알린다. runtime은 ledger를 읽기만
// 하므로 event가 유일한 신호이고, 늦게 읽어도 같은 event를 두 번 처리하지 않도록 훑은 위치를 옮긴다. 읽지
// 못하면 위치를 옮기지 않아 다음 훑기가 같은 event를 이어서 처리한다.

export type ProviderWatch = {
  poll(): Promise<Result<void>>;
};

export function createProviderWatch(deps: {
  read: CoreRead;
  // 기동 때 event head다. 그 앞의 Disconnect는 복구의 사용 가능 확인이 본다.
  cursor: string;
  revokeProvider(provider: string): Promise<void>;
}): ProviderWatch {
  let cursor = deps.cursor;
  let polling: Promise<Result<void>> | undefined;

  async function scan(): Promise<Result<void>> {
    for (;;) {
      const listed = await deps.read("/v1/events/list", {
        after_seq: cursor,
        types: ["ProviderDisconnected"],
      });
      if (!listed.ok) return listed;
      const parsed = eventsList.output.safeParse(listed.value);
      if (!parsed.success) {
        return err({
          code: "unavailable",
          message: "unexpected read shape",
        });
      }
      for (const event of parsed.data.events) {
        if (event.subject !== null) await deps.revokeProvider(event.subject);
      }
      const advanced = parsed.data.scanned_through_seq;
      if (BigInt(advanced) <= BigInt(cursor)) return ok(undefined);
      cursor = advanced;
      if (BigInt(cursor) >= BigInt(parsed.data.head_seq)) return ok(undefined);
    }
  }

  return {
    // 겹쳐 불러도 훑기는 하나다.
    poll() {
      polling ??= scan().finally(() => {
        polling = undefined;
      });
      return polling;
    },
  };
}
