// 못 본 turn 끝(finished 점). 메모리뿐이다. 서는 때와 꺼지는 때의 규칙은 한 곳(이 file)이다.
import type { Clock } from "../../base/mod.ts";
import { anyLooking, type PresenceTable } from "./presence.ts";

export type UnseenItem = {
  session: string;
  kind: "finished" | "failed";
  at: string;
};

export function createUnseen(deps: {
  clock: Clock;
  presence: PresenceTable;
  // 서거나 꺼질 때마다 부른다(StateChanged{unseen}).
  changed(session: string): void;
}) {
  const items = new Map<string, UnseenItem>();

  function clear(session: string): boolean {
    if (!items.delete(session)) return false;
    deps.changed(session);
    return true;
  }

  return {
    // turn이 끝났다. 앞에 있는 host가 그 session을 보고 있으면 못 본 것이 아니다.
    ended(session: string, kind: UnseenItem["kind"]): void {
      if (anyLooking(deps.presence, session, deps.clock.nowMs())) return;
      items.set(session, { session, kind, at: deps.clock.now() });
      deps.changed(session);
    },
    // 앞에 있는 host가 보고 있다고 알렸다.
    seen(sessions: readonly string[]): void {
      for (const session of sessions) clear(session);
    },
    // 다음 turn이 시작했거나 session이 끝났거나 사람이 지웠다.
    clear,
    list: (): UnseenItem[] => [...items.values()],
  };
}
