// Inbox 줄이 id 대신 쓸 사람이 보는 workspace 이름. workspace 창(workspace-window)이 알고 있는 것을 context로 내린다.
// 모르는 것(목록에 없는 앱)은 비어 있고 줄은 지금 글로 돌아간다. 터미널 탭 이름은 main이 runtime에 싣는다(`tab_name`).
import { createContext, useContext } from "react";

export interface InboxNames {
  readonly projects: ReadonlyMap<string, string>;
  readonly apps: ReadonlyMap<string, string>;
}

export const NO_NAMES: InboxNames = {
  projects: new Map(),
  apps: new Map(),
};

const NamesContext = createContext<InboxNames>(NO_NAMES);

export const InboxNamesProvider = NamesContext.Provider;

export function useInboxNames(): InboxNames {
  return useContext(NamesContext);
}
