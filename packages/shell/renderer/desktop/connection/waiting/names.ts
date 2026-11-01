// Inbox 줄이 id·harness 이름 대신 쓸 사람이 보는 이름. place 창(place-window)이 알고 있는 것을 context로 내린다.
// 모르는 것(다른 창의 탭, 목록에 없는 앱)은 비어 있고 줄은 지금 글로 돌아간다.
import { createContext, useContext } from "react";

export interface InboxNames {
  readonly projects: ReadonlyMap<string, string>;
  readonly apps: ReadonlyMap<string, string>;
  /** terminal_ref → 탭 줄에 보이는 이름(사람이 붙인 이름 포함). */
  readonly terminals: ReadonlyMap<string, string>;
}

export const NO_NAMES: InboxNames = {
  projects: new Map(),
  apps: new Map(),
  terminals: new Map(),
};

const NamesContext = createContext<InboxNames>(NO_NAMES);

export const InboxNamesProvider = NamesContext.Provider;

export function useInboxNames(): InboxNames {
  return useContext(NamesContext);
}
