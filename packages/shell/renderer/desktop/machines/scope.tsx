// 화면이 "어느 기계"를 고르는 범위. 범위 안의 읽기·부르기·event는 그 기계로 간다: 범위가 그 기계 묶음의 store, 앱 view,
// project icon, 설정 허락 묻기를 context로 주므로 화면의 code는 core를 읽고 부르는 모양 그대로다(호출마다 기계를 넘기지 않는다).
import { createContext, type ReactNode, useContext } from "react";

import { AppViewsProvider } from "../../app-frame/app-views.tsx";
import { eventClientOf } from "../../app-frame/machine-app-source.ts";
import { ProjectIconsProvider } from "../../parts/project-icon/project-icon.tsx";
import type { EventClient } from "../connection/events/client.ts";
import {
  EventsProvider,
  useOptionalEventClient,
} from "../connection/events/hooks.tsx";
import { CodingPrefsProvider } from "../settings/connections/prefs-store.tsx";
import { ConnectProviderHost } from "../settings/providers/connect-host.tsx";
import {
  MachineGrantProvider,
  ScopeMachineProvider,
  useScopeMachine,
} from "./context.tsx";
import type { MachineData, MachineHub } from "./data.ts";

/** 기계를 가리키는 값. null이 이 컴퓨터다. 이 컴퓨터의 id는 넣지 않는다. */
export type MachineRef = string | null;

export { useScopeMachine };

const HubContext = createContext<MachineHub | null>(null);

export function MachineHubProvider({
  hub,
  children,
}: {
  hub: MachineHub;
  children: ReactNode;
}) {
  return <HubContext.Provider value={hub}>{children}</HubContext.Provider>;
}

/** hub가 없는 화면(entry의 조립 없이 그리는 gallery의 Desktop)은 null이다. */
export function useMachineHub(): MachineHub | null {
  return useContext(HubContext);
}

/** 그 기계의 묶음. 인자가 없으면 지금 범위의 기계다. `MachineHubProvider` 안에서만 쓴다. */
export function useMachineData(machine?: MachineRef): MachineData {
  const hub = useContext(HubContext);
  const scope = useScopeMachine();
  if (hub === null) throw new Error("MachineHubProvider is missing");
  return hub.get(machine === undefined ? scope : machine);
}

/** 그 기계의 범위를 준다. 폴더 목록 dialog(다른 기계의 폴더 고르기)와 provider·model 관리 창 자리도 여기 둔다. */
export function MachineScope({
  machine,
  children,
}: {
  machine: MachineRef;
  children: ReactNode;
}) {
  const outer = useScopeMachine();
  const data = useMachineData(machine);
  const Folders = data.folders?.Host;
  const providers = data.settingsPanels?.providers;
  const agents = data.settingsPanels?.agents;
  // 다른 기계 범위(또는 다른 기계 안에 들어온 이 컴퓨터 범위)는 그 기계의 provider·model 관리 host를 새로 감싼다.
  // root `MachineScope(null)`은 `Desktop`(`main.tsx`)과 gallery가 각자 감싸므로 겹치지 않는다.
  const body =
    (machine !== null || outer !== null) &&
    providers !== undefined &&
    agents !== undefined ? (
      <ConnectProviderHost
        key={machine ?? "here"}
        providers={providers}
        agents={agents}
      >
        {children}
      </ConnectProviderHost>
    ) : (
      children
    );
  return (
    <ScopeMachineProvider value={machine}>
      <EventsProvider stores={data.stores}>
        <CodingPrefsProvider store={data.codingPrefs}>
          <AppViewsProvider value={data.appViews}>
            <ProjectIconsProvider value={data.projectIcons}>
              <MachineGrantProvider check={data.grant}>
                {body}
                {Folders === undefined ? null : <Folders />}
              </MachineGrantProvider>
            </ProjectIconsProvider>
          </AppViewsProvider>
        </CodingPrefsProvider>
      </EventsProvider>
    </ScopeMachineProvider>
  );
}

/**
 * 다른 기계의 범위 안에서도 이 컴퓨터의 shell chrome(tray, 오른쪽 sidebar 앱 panel, 왼쪽 sidebar 등록/앱 만들기 dialog)을
 * 이 컴퓨터 범위(`machine = null`)로 고정한다. 이미 이 컴퓨터 범위이거나 hub가 없으면 그대로 그린다.
 */
export function LocalMachineScope({ children }: { children: ReactNode }) {
  const hub = useMachineHub();
  const scope = useScopeMachine();
  return hub === null || scope === null ? (
    <>{children}</>
  ) : (
    <MachineScope machine={null}>{children}</MachineScope>
  );
}

/** 지정한 기계(null은 이 컴퓨터)의 event client. 지정하지 않거나 hub가 없으면 지금 범위의 client다. */
export function useMachineEventClient(
  machine?: MachineRef,
): EventClient | null {
  return eventClientOf(useMachineHub(), useOptionalEventClient(), machine);
}

/**
 * 탭 host가 탭의 기계 묶음을 찾는 길(`TabHost`의 두 칸). kind의 hook 아닌 자리(`iconOf`, `dotOf`, `transfer`)가 쓴다.
 * `machine`은 지금 범위(workspace)의 기계다.
 */
export function useHostMachine(): {
  readonly machine: MachineRef;
  machineData(machine: MachineRef): MachineData;
} {
  const machine = useScopeMachine();
  const hub = useContext(HubContext);
  return {
    machine,
    machineData(target) {
      if (hub === null) throw new Error("MachineHubProvider is missing");
      return hub.get(target);
    },
  };
}
