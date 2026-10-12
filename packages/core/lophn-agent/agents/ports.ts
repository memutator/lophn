import type { Result } from "../../../base/mod.ts";
import type {
  AgentPlace,
  AgentRole,
  AgentSettings,
  McpTool,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

// agents가 바깥에서 받는 것들이다. 파일 IO와 다른 concern의 값은 모두 여기서 받아 시험이 바꿔 끼운다.
// 읽기(snapshot)와 쓰기(Tx)가 같은 `lookups`를 쓰도록 sql만 받는 factory로 둔다.

// 한 파일의 읽기·원자 쓰기·지우기. 없는 파일 읽기는 null이고 그 밖의 IO 실패는 던진다.
// writeAtomic은 임시 파일에 쓴 뒤 바꿔 끼워 실패하면 이전 파일이 그대로 남게 한다.
export interface AgentFileSystem {
  read(path: string): string | null;
  writeAtomic(path: string, text: string): void;
  remove(path: string): void;
}

export type AssignmentRef = {
  id: string;
  role: AgentRole;
  scope: { kind: "all" } | { kind: AgentPlace["kind"]; id: string };
  state: "enabled" | "paused" | "withdrawn";
  revision: number;
};

export type ReadSql = Pick<Tx["sql"], "get" | "all">;

// 다른 concern의 값을 읽는 길. 정본은 각 concern이고 여기서는 읽기만 한다.
export type AgentLookups = {
  placeExists(place: AgentPlace): boolean;
  // 거두지 않은 assignment 가운데 전역(all)이거나 이 자리가 범위인 것.
  assignments(place: AgentPlace): AssignmentRef[];
  // 거둔 것도 돌려준다. 없으면 null.
  assignment(id: string): AssignmentRef | null;
  // 만드는 중(drafting)인 context와 보관한 context도 실제 context다. 없으면 null.
  contextStatus(id: string): "drafting" | "active" | "archived" | null;
  // context가 속한 project. 없으면 null. context는 project 안에만 있다.
  contextProject(id: string): string | null;
  // 이 자리의 agent가 읽을 active context다. project 자리는 그 project의 active context 전부이고, App Engineer가
  // 앱 자리에 있으면 그 앱을 app-data source로 읽는 active context 전부다. 그 밖의 앱 자리는 빈 목록이다.
  activeContexts(place: AgentPlace, role: AgentRole): string[];
  // 이 자리의 agent가 쓸 수 있는 skill 이름과 MCP tool이다. 전역 층에 자리 층(그 자리에서 여는
  // agent에만 보인다)을
  // 더한 것이고 발견·등록 순서다.
  skills(place: AgentPlace): string[];
  mcp(place: AgentPlace): McpTool[];
  // Workspace 층: 역할별 기본 model(agent-model-defaults)과 기본 권한(platform/settings).
  workspace(): AgentSettings;
};

// Operator assignment를 같은 transaction에서 만들고 거둔다. 실패하면 command가 전체를 되돌린다.
export type AssignmentWriter = {
  createOperator(place: AgentPlace): Result<string>;
  withdraw(assignment: string): Result<void>;
};

export type AgentDeps = {
  files: AgentFileSystem;
  lookups(sql: ReadSql): AgentLookups;
  assignmentWriter(tx: Tx): AssignmentWriter;
  // 이 role의 RoleCaps 개별 동작.
  roleCaps(role: AgentRole): readonly string[];
  // 없으면 ledger 파일이 있는 폴더가 data root다.
  dataRoot?: string;
};
