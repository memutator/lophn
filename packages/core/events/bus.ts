// 메모리 pub/sub. topic을 미리 나누지 않고 저장하지 않는다.
import type { BusEvent, EventCondition } from "../../protocol/events/mod.ts";
import type { Bus, BusSink } from "./ports.ts";

// 조건 여럿은 OR이다. 조건이 없으면 어떤 event도 맞지 않는다.
// session을 건 조건은 session이 없는 event(domain, 남지 않는 event)와 맞지 않는다.
function eventMatches(
  conditions: readonly EventCondition[],
  event: BusEvent,
): boolean {
  const session = "session" in event ? event.session : undefined;
  return conditions.some((condition) =>
    (condition.session === undefined || condition.session === session) &&
    (condition.types === undefined || condition.types.includes(event.type))
  );
}

export function createBus(
  log: (message: string) => void = () => {},
): Bus {
  const subscriptions = new Set<
    { conditions: readonly EventCondition[]; sink: BusSink }
  >();
  return {
    publish(event) {
      // 순회 중에 해제되는 것을 견디려고 복사해 돈다.
      for (const subscription of [...subscriptions]) {
        if (!subscriptions.has(subscription)) continue;
        if (!eventMatches(subscription.conditions, event)) continue;
        try {
          subscription.sink.send(event);
        } catch {
          // 던진 sink는 close 없이 해제만 한다. 다른 sink는 계속 받는다.
          subscriptions.delete(subscription);
          log("bus sink threw; unsubscribed");
        }
      }
    },
    subscribe(conditions, sink) {
      const subscription = { conditions, sink };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
  };
}
