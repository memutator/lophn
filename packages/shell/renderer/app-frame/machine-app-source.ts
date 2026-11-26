// 앱 icon, 화면 목록, event client, 앱 workspace context, 로컬 탭 기계를 어느 기계 범위로 풀지 정하는 순수 판정.
// `machine`을 주면 hub에서 그 기계의 묶음을 쓰고(이 컴퓨터는 null), 주지 않거나 hub가 없으면 지금 범위의 묶음을 쓴다.
import type { AppViewOpen } from "../../ipc/app-frame.ts";
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

/** 기계 지정(`machine`)이 있으면 hub에서 그 기계의 event client를 고르고, 없거나 hub가 없으면 현재 범위의 것을 쓴다. */
export function eventClientOf(
  hub: Pick<MachineHub, "get"> | null,
  scopeEvents: EventClient | null,
  machine?: MachineRef,
): EventClient | null {
  if (machine === undefined || hub === null) return scopeEvents;
  try {
    return hub.get(machine).events;
  } catch {
    return null;
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

/**
 * 앱 화면이 받을 `workspace` context. 앱의 기계 범위(`scopeMachine`)가 열린 workspace의 기계와 같을 때만 넘긴다.
 * 다른 기계의 workspace에서 열린 이 컴퓨터의 tray·sidebar·앱 panel은 원격 id와 OS 폴더 경로를 받지 않는다.
 */
export function appWorkspaceForScope(
  entry: {
    readonly machine: MachineRef;
    readonly value: AppViewOpen["workspace"];
  } | null,
  scopeMachine: MachineRef,
): AppViewOpen["workspace"] {
  return entry !== null && entry.machine === scopeMachine
    ? entry.value
    : undefined;
}

/**
 * 다른 기계의 workspace에서 이 컴퓨터의 탭(browser, 로컬 app panel 등)을 열 때 탭에 찍을 기계 id.
 * 이 컴퓨터의 workspace거나 이 컴퓨터 id를 아직 모르면 undefined다.
 */
export function localTabMachine(host: {
  readonly machine: MachineRef;
  readonly thisComputer?: string | null;
}): string | undefined {
  return host.machine !== null &&
    host.thisComputer !== null &&
    host.thisComputer !== undefined
    ? host.thisComputer
    : undefined;
}

/**
 * 이미 열린 app_panel 탭 가운데 같은 (기계, 앱, 화면)을 가리키는 탭을 찾는다.
 * 원격 workspace에 원격 앱 탭과 이 컴퓨터의 빠른 실행 고정 탭이 같은 앱 id로 공존해도 서로 섞지 않는다.
 */
export function findMatchingAppPanelTab<
  T extends {
    readonly kind: string;
    readonly app?: string;
    readonly screen?: string;
    readonly machine?: string;
  },
>(
  tabs: readonly T[],
  pin: { readonly app: string; readonly surface: string },
  machine: string | undefined,
  workspaceMachine: MachineRef,
  thisComputer: string | null,
): T | undefined {
  const resolve = (tabMachine: string | undefined): MachineRef => {
    const raw = tabMachine ?? workspaceMachine;
    return raw === thisComputer ? null : raw;
  };
  const target = resolve(machine);
  return tabs.find(
    (tab) =>
      tab.kind === "app_panel" &&
      tab.app === pin.app &&
      tab.screen === pin.surface &&
      resolve(tab.machine) === target,
  );
}
