import type { Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import type {
  AgentRef,
  CallAgent,
  NamedAgent,
  Place,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type {
  AppDirectory,
  ProjectDirectory,
  SessionEndEffects,
} from "../ports.ts";

// Operator 정의가 어디에 있고 누구인지. 정의는 agent-definition이 가진 파일이라 wiring이 읽어 끼운다.
export type OperatorInfo = {
  id: Id<"agt">;
  name: string;
  place: Place;
  // 정의 file이 고른 domain id. 안 골랐으면 빈 목록이다.
  domains: readonly string[];
  // 정의의 skip 기본값. 없으면 false.
  skip: boolean;
};

export interface OperatorDirectory {
  operator(id: string): OperatorInfo | null;
  operators(): readonly OperatorInfo[];
}

// role마다 다른 규칙. agent-roles가 project·앱·Operator 조회를 쥐고 만들어 wiring이 꽂는다.
export type PlaceRoleRules = {
  // 목록에 보일 agent 이름. 못 찾으면 빈 글이다.
  nameOf(ref: AgentRef): string;
  // 이름으로 받은 agent 하나를 고른다. 이름을 짐작하지 않는다.
  resolveNamed(named: NamedAgent): Result<CallAgent>;
};

// session의 agent와 place를 확인하는 데 필요한 것. place 정보는 project와 앱 module의 port로 읽는다.
export type PlaceDeps = {
  projects: Pick<ProjectDirectory, "project" | "projectByName">;
  apps: Pick<AppDirectory, "app" | "appByName">;
  operators: OperatorDirectory;
  roles: PlaceRoleRules;
};

export type OpenDeps = PlaceDeps & {
  // Bus에 agent event를 낸다.
  publish(event: AgentEvent): void;
};

// session이 끝날 때(archive, 지움) 같은 tx 안에서 하는 일. 입력함과 Bus는 main thread에 있어서 비우기와 event는
// commit 뒤에 할 일로 모은다.
export type EndDeps = {
  effects: SessionEndEffects;
  // 도는 turn을 interrupted(session_ended)로 닫는다.
  interruptRunningTurns(tx: Tx, session: Id<"ses">): Result<void>;
  // 입력함을 commit 뒤에 비운다.
  clearInbox(tx: Tx, session: Id<"ses">): void;
  // Bus event를 commit 뒤에 낸다.
  publish(tx: Tx, event: AgentEvent): void;
};
