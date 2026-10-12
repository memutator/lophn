// 팀 module이 event 공개 정책을 내놓은 event 이름 목록. 사람(user) token의 operation에 이 이름이
// 들어 있어야 owner의 공개 정책이 사람에게 event를 보일 수 있다(identity: operation 이름이 scope다).
// events/list의 registry와 같은 출처(module의 createEventRegistration)에서 모은다.
import type { EventRegistration } from "../storage/ledger/mod.ts";

export async function eventOperations(
  modules: readonly string[],
): Promise<string[]> {
  const names = new Set<string>();
  for (const url of modules) {
    const module = (await import(url)) as {
      createEventRegistration?: () => EventRegistration;
    };
    if (typeof module.createEventRegistration !== "function") continue;
    for (const policy of module.createEventRegistration().visibility ?? []) {
      names.add(policy.event.type);
    }
  }
  return [...names].sort();
}
