import { err, ok, type Result } from "../../../base/mod.ts";
import { providerList } from "../../../protocol/lophn-agent/mod.ts";
import type { CoreRead } from "../run-loop/mod.ts";

// Disconnect한 provider로 진행 중인 turn을 멈추게 하는 눈이다.
// provider 목록을 읽어 앞서 있던 provider가 사라졌으면 그 provider의 회수를 알린다. runtime은
// ledger를 읽기만 하므로 목록이 유일한 신호이고, 읽지 못하면 아는 목록을 바꾸지 않아 다음 훑기가
// 같은 차이를 이어서 처리한다. 처음 훑은 목록은 기준일 뿐 회수하지 않는다.

export type ProviderWatch = {
  poll(): Promise<Result<void>>;
};

export function createProviderWatch(deps: {
  read: CoreRead;
  revokeProvider(provider: string): Promise<void>;
}): ProviderWatch {
  let known: Set<string> | undefined;
  let polling: Promise<Result<void>> | undefined;

  async function listAll(): Promise<Result<Set<string>>> {
    const ids = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const listed = await deps.read(
        "/providers/list",
        cursor === undefined ? {} : { cursor },
      );
      if (!listed.ok) return listed;
      const parsed = providerList.output.safeParse(listed.value);
      if (!parsed.success) {
        return err({ code: "unavailable", message: "unexpected read shape" });
      }
      for (const provider of parsed.data.providers) ids.add(provider.id);
      if (parsed.data.next_cursor === null) return ok(ids);
      cursor = parsed.data.next_cursor;
    }
  }

  async function scan(): Promise<Result<void>> {
    const current = await listAll();
    if (!current.ok) return current;
    const before = known;
    known = current.value;
    if (before === undefined) return ok(undefined);
    for (const provider of before) {
      if (!current.value.has(provider)) await deps.revokeProvider(provider);
    }
    return ok(undefined);
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
