// 이 컴퓨터의 job과 앱이 다른 컴퓨터의 앱 event를 받게 하는 구독의 두 쪽.
// 부르는 기계: core가 구독을 모아 그 컴퓨터의 link에 구독자 하나로 건다(`createRemoteSubscriptions`). 온 event는 apps가 읽어 이 기계에서 낸다(`receivedAppEvent`).
// 받는 기계: 컴퓨터의 Gateway session에 내주는 event를 가린다(`sharesAppEvent`).
// 구독은 선언(job의 trigger, 앱 release의 `subscriptions[].machine`)에서 온다: 저장하지 않고 때마다 다시 계산해 건다.
import type { Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import {
  type BusEvent,
  type EventCondition,
} from "../../protocol/events/mod.ts";
import type { Workspace } from "../../protocol/lophn-agent/workspaces.ts";
import type { MachineCandidate } from "../../protocol/machine/requester.ts";
import type { MachineSubscriber } from "./links.ts";

// core가 그 기계의 link에 거는 구독자. 화면의 구독자(capability가 있다)와 key가 달라 서로 덮지 않는다.
export const CORE_APP_EVENTS: MachineSubscriber = {
  capability: null,
  watcher: "core:app-events",
};
const CORE_CONDITIONS: EventCondition[] = [{ types: ["AppEventPublished"] }];

// 받는 기계가 다른 컴퓨터에 내주는 앱 event인가. 앱이 선언해 낸 것(subject가 앱이고 audience가 없다)이고 그 앱의 workspace가 이 기계의 call
// 정책에서 private이 아니고 이 기계가 낸 것이어야 한다: `lophn`이 낸 core event, 앱 화면만 받는 event, 다른 기계에서 와 이 기계가 낸 event(되돌려
// 나르지 않는다)는 가지 않는다.
export function sharesAppEvent(
  event: BusEvent,
  privateApp: (app: Id<"app">) => boolean,
): boolean {
  if (event.type !== "AppEventPublished") return false;
  const { subject, payload } = event;
  return (
    subject !== null &&
    payload.audience === null &&
    payload.machine === undefined &&
    !privateApp(subject as Id<"app">)
  );
}

export type RemoteSubscriptionsDeps = {
  // 이 기계가 주인이고 승인되고 켜진 event job 가운데 다른 컴퓨터의 event를 때로 가진 것(기계와 그 job을 만든 workspace).
  jobs(): Promise<
    Result<readonly { machine: Id<"mch">; workspace: Workspace | null }[]>
  >;
  // active 앱의 active release가 `subscriptions[].machine`으로 적은 컴퓨터 이름.
  apps(): readonly { app: Id<"app">; machines: readonly string[] }[];
  // 명단의 컴퓨터(이 컴퓨터 포함)와 이름 풀기.
  computers(): MachineCandidate[];
  resolve(ref: string): Result<MachineCandidate>;
  // 이 기계의 call 정책에서 그 workspace가 private인가.
  isPrivate(workspace: Workspace | null): boolean;
  // `Links.watch`. 구독자의 조건을 통째로 바꾼다(빈 조건은 뺀다).
  watch(
    subscriber: MachineSubscriber,
    machine: string,
    conditions: EventCondition[],
  ): Result<object>;
  warn(event: string, fields: Record<string, string>): void;
};

export function createRemoteSubscriptions(deps: RemoteSubscriptionsDeps) {
  // 지금 core 구독자를 건 기계와 그때 그 기계의 기기 id. 명단에서 기기가 바뀌면(link가 새로 열린다) 다시 건다.
  const applied = new Map<Id<"mch">, string>();
  // 이미 log한 풀지 못한 구독(refresh마다 되풀이하지 않는다).
  let warned = new Set<string>();
  let running = false;
  let again = false;

  const deviceOf = (machine: Id<"mch">) =>
    deps.computers().find((each) => each.machine === machine && !each.self)
      ?.device;

  async function compute(): Promise<Set<Id<"mch">>> {
    const wanted = new Set<Id<"mch">>();
    const round = new Set<string>();
    const warn = (
      key: string,
      event: string,
      fields: Record<string, string>,
    ) => {
      round.add(key);
      if (!warned.has(key)) deps.warn(event, fields);
    };
    const jobs = await deps.jobs();
    if (jobs.ok) {
      for (const job of jobs.value) {
        // private인 workspace의 job은 다른 컴퓨터에 구독을 걸지 않는다.
        if (!deps.isPrivate(job.workspace)) wanted.add(job.machine);
      }
    }
    for (const { app, machines } of deps.apps()) {
      if (deps.isPrivate({ kind: "app", id: app })) continue;
      for (const name of machines) {
        const found = deps.resolve(name);
        if (!found.ok || found.value.self) {
          warn(`${app} ${name}`, "app_subscription_machine_unresolved", {
            app,
            machine: name,
            reason: found.ok ? "self" : found.error.code,
          });
          continue;
        }
        wanted.add(found.value.machine as Id<"mch">);
      }
    }
    warned = round;
    return wanted;
  }

  async function apply() {
    const wanted = await compute();
    for (const machine of [...applied.keys()]) {
      if (wanted.has(machine)) continue;
      applied.delete(machine);
      // 이미 명단에서 빠진 컴퓨터면 거둘 것이 없다.
      deps.watch(CORE_APP_EVENTS, machine, []);
    }
    for (const machine of wanted) {
      const device = deviceOf(machine);
      if (device === undefined) {
        applied.delete(machine);
        continue;
      }
      if (applied.get(machine) === device) continue;
      if (deps.watch(CORE_APP_EVENTS, machine, CORE_CONDITIONS).ok) {
        applied.set(machine, device);
      }
    }
  }

  return {
    // 원하는 기계를 다시 계산해 건 것과 맞춘다. 겹쳐 불리면 끝난 뒤 한 번 더 돈다.
    async refresh(): Promise<void> {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await apply();
        } while (again);
      } finally {
        running = false;
      }
    },
  };
}
