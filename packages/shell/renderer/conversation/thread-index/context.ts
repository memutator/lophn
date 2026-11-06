// 대화 줄(ThreadScroll)이 thread index를 그리는 데 필요한 값. AgentView가 주 대화에만 이 provider를 두므로 자식
// 대화와 다른 곳의 ThreadScroll에는 rail이 없다.
import { createContext } from "react";

import type { Bookmarks } from "./bookmarks.ts";
import type { IndexItem } from "./model.ts";

export interface ThreadIndexValue {
  readonly items: readonly IndexItem[];
  /** null이면 bookmark 단추가 없다. */
  readonly bookmarks: Bookmarks | null;
}

export const ThreadIndexContext = createContext<ThreadIndexValue | null>(null);
