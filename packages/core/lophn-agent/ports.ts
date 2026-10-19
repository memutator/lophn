import type { Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { Seq } from "../../protocol/base/values.ts";
import type { Input, Output, Tx } from "../../protocol/server/mod.ts";
import type { SessionAppWrites } from "../../protocol/lophn-agent/session-rewinds.ts";
import type {
  callCancel,
  callReply,
  callSend,
  callSendable,
} from "../../protocol/lophn-agent/calls.ts";

// lophn-agent가 바깥에서 받는 것들이다. 다른 domain module은 직접 import할 수 없으므로
// main/daemon/wiring이 구현해 끼운다.

type ProjectInfo = {
  id: Id<"prj">;
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
  project(id: Id<"prj">): ProjectInfo | null;
  // 정확히 맞는 이름만.
  projectByName(name: string): ProjectInfo | null;
  list(): readonly ProjectInfo[];
}

type AppInfo = {
  id: Id<"app">;
  name: string;
  purpose: string;
  archived: boolean;
  sourceFolder: string | null;
};

export interface AppDirectory {
  app(id: Id<"app">): AppInfo | null;
  appByName(name: string): AppInfo | null;
  list(): readonly AppInfo[];
}

// session을 지우거나 archive할 때 같은 tx 안에서 부른다.
export interface SessionEndEffects {
  // 대기 권한 요청, 질문 -> cancelled
  cancelPendingRequests(tx: Tx, session: Id<"ses">): Result<void>;
  // "이 session 동안" 허락
  forgetSessionGrants(session: Id<"ses">): void;
  // 열린 call -> failed(receiver_ended)
  failReceivedCalls(tx: Tx, session: Id<"ses">): Result<void>;
}

// session rewind가 앱 rewind와 잇는 길(apps가 준다).
export interface AppWrites {
  writesAfter(session: Id<"ses">, checkpointSeq: Seq): SessionAppWrites;
}

// agent tool(call, reply, cancel, session.list)이 Router를 부르는 길이다.
// 구현은 core의 calls.* route를 부르는 CoreCall이다.
export interface CallRouting {
  send(
    input: Input<typeof callSend>,
  ): Promise<Result<Output<typeof callSend>>>;
  reply(
    input: Input<typeof callReply>,
  ): Promise<Result<Output<typeof callReply>>>;
  cancel(
    input: Input<typeof callCancel>,
  ): Promise<Result<Output<typeof callCancel>>>;
  sendable(): Promise<Result<Output<typeof callSendable>>>;
}
