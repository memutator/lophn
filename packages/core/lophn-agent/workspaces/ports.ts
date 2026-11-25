import type { Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import type {
  AgentAddress,
  AgentAtWorkspace,
  AgentId,
  PermissionMode,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { AgentDirectory } from "../agents/mod.ts";
import type {
  AppDirectory,
  ProjectDirectory,
  SessionEndEffects,
} from "../ports.ts";

// 이름 규칙. agent-workspaces가 project·앱·agent 조회를 쥐고 만들어 wiring이 꽂는다.
export type WorkspaceNameRules = {
  // 목록에 보일 agent의 handle과 보이는 이름. 정의를 못 읽으면 id다.
  describe(agent: AgentId): { handle: string; name: string };
  // agent handle과 workspace 이름으로 받을 session 하나를 고른다. workspace가 없으면 home이다.
  resolveAddress(address: AgentAddress): Result<AgentAtWorkspace>;
};

// session의 agent와 workspace를 확인하는 데 필요한 것. agent 정의와 workspace 정보는 project·앱 module의 port로 읽는다.
export type WorkspaceDeps = {
  projects: Pick<ProjectDirectory, "project" | "projectByName">;
  apps: Pick<AppDirectory, "app" | "appByName">;
  agents: AgentDirectory;
  names: WorkspaceNameRules;
  // 전역 기본 권한 단계(`approvals.default_mode`). 없으면 `workspace`다.
  defaultMode?(): PermissionMode;
};

export type OpenDeps = WorkspaceDeps & {
  // Bus에 agent event를 낸다.
  publish(event: AgentEvent): void;
};

// session이 끝날 때(archive, 지움) 같은 tx 안에서 하는 일. queue와 Bus는 main thread에 있어서 비우기와 event는
// commit 뒤에 할 일로 모은다.
export type EndDeps = {
  effects: SessionEndEffects;
  // 도는 turn을 interrupted(session_ended)로 닫는다.
  interruptRunningTurns(tx: Tx, session: Id<"ses">): Result<void>;
  // queue를 commit 뒤에 비운다.
  clearQueue(tx: Tx, session: Id<"ses">): void;
  // Bus event를 commit 뒤에 낸다.
  publish(tx: Tx, event: AgentEvent): void;
};
