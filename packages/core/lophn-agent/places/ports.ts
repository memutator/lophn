import type { Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import type { Place } from "../../../protocol/lophn-agent/mod.ts";
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
};

export interface OperatorDirectory {
  operator(id: string): OperatorInfo | null;
  operators(): readonly OperatorInfo[];
}

// session의 agent와 place를 확인하는 데 필요한 것. place 정보는 project와 앱 module의 port로 읽는다.
export type PlaceDeps = {
  projects: Pick<ProjectDirectory, "project" | "projectByName">;
  apps: Pick<AppDirectory, "app" | "appByName">;
  operators: OperatorDirectory;
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
