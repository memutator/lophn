// 앱 icon과 화면 목록을 어느 기계에서 읽을지 고르는 순수 판정.
// `machine`을 주면 hub에서 그 기계의 묶음을 쓰고(이 컴퓨터는 null), 주지 않거나 hub가 없으면 지금 범위의 묶음을 쓴다.
import type { EventClient } from "../desktop/connection/events/client.ts";
import type { MachineHub } from "../desktop/machines/data.ts";
import type { MachineRef } from "../desktop/machines/scope.tsx";
import type { AppViewsDeps } from "./app-views.tsx";

/** 기계 지정(`machine`)이 있으면 hub에서 그 기계의 icon 통로를 고르고, 없거나 hub가 없으면 현재 범위의 통로를 쓴다. */
export function appIconReader(
  hub: Pick<MachineHub, "get"> | null,
  scope: Pick<AppViewsDeps, "icon"> | null,
  machine?: MachineRef,
): AppViewsDeps["icon"] {
  if (machine === undefined || hub === null) return scope?.icon;
  try {
    return hub.get(machine).appViews?.icon;
  } catch {
    return undefined;
  }
}

/** 기계 지정(`machine`)이 있으면 hub에서 그 기계의 앱 화면 목록과 event 통로를 고르고, 없거나 hub가 없으면 현재 범위의 것을 쓴다. */
export function screensSourceOf(
  hub: Pick<MachineHub, "get"> | null,
  scopeViews: AppViewsDeps | null,
  scopeEvents: EventClient | null,
  machine?: MachineRef,
): {
  readonly appViews: AppViewsDeps | null;
  readonly events: EventClient | null;
} {
  if (machine === undefined || hub === null) {
    return { appViews: scopeViews, events: scopeEvents };
  }
  try {
    const data = hub.get(machine);
    return { appViews: data.appViews, events: data.events };
  } catch {
    return { appViews: null, events: null };
  }
}
