// Inbox 줄이 id 대신 쓸 사람이 보는 workspace 이름. workspace 창(workspace-window)이 알고 있는 것을 context로 내린다.
// 기계마다 따로 든다(키는 기계 id, 이 컴퓨터는 ""): project·앱 id는 기계를 건너 겹칠 수 있다.
// 모르는 것(목록에 없는 앱)은 비어 있고 줄은 지금 글로 돌아간다. 터미널 탭 이름은 main이 runtime에 싣는다(`tab_name`).
import { createContext, useCallback, useContext } from "react";

export interface InboxNames {
  readonly projects: ReadonlyMap<string, string>;
  readonly apps: ReadonlyMap<string, string>;
}

export const NO_NAMES: InboxNames = {
  projects: new Map(),
  apps: new Map(),
};

export type InboxNamesByMachine = ReadonlyMap<string, InboxNames>;

const NamesContext = createContext<InboxNamesByMachine>(new Map());

export const InboxNamesProvider = NamesContext.Provider;

/** 그 기계(null은 이 컴퓨터)의 이름. 함수는 이름 값이 바뀔 때만 바뀐다. */
export function useInboxNamesOf(): (machine: string | null) => InboxNames {
  const byMachine = useContext(NamesContext);
  return useCallback(
    (machine) => byMachine.get(machine ?? "") ?? NO_NAMES,
    [byMachine],
  );
}
