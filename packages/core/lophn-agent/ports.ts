import type { Result } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";

// lophn-agent가 바깥에서 받는 것들이다. 다른 domain module은 직접 import할 수 없으므로
// main/daemon/wiring이 구현해 끼운다.

export type ProjectInfo = {
  id: string;
  name: string;
  purpose: string;
  archived: boolean;
  folders: readonly {
    path: string;
    description: string;
    found: boolean;
    subfolders: readonly { path: string; description: string }[];
  }[];
};

export interface ProjectDirectory {
  project(id: string): ProjectInfo | null;
  // 정확히 맞는 이름만.
  projectByName(name: string): ProjectInfo | null;
  list(): readonly ProjectInfo[];
  contextsOf(project: string): readonly {
    id: string;
    name: string;
    status: "active" | "archived" | "drafting";
  }[];
}

export type AppInfo = {
  id: string;
  name: string;
  purpose: string;
  archived: boolean;
  sourceFolder: string | null;
};

export interface AppDirectory {
  app(id: string): AppInfo | null;
  appByName(name: string): AppInfo | null;
  list(): readonly AppInfo[];
}

// session을 지우거나 archive할 때 같은 tx 안에서 부른다.
export interface SessionEndEffects {
  // 대기 권한 요청, 질문 -> cancelled
  cancelPendingRequests(tx: Tx, session: string): Result<void>;
  // "이 session 동안" 허락
  forgetSessionGrants(session: string): void;
  // 열린 call -> failed(receiver_ended)
  failReceivedCalls(tx: Tx, session: string): Result<void>;
}

// session rewind가 앱 rewind와 잇는 길(S5가 준다).
export interface AppWrites {
  writesAfter(
    session: string,
    checkpointSeq: string,
  ): readonly { app: string; invocation: string }[];
}
