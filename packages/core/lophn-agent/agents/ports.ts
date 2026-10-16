import type {
  McpTool,
  ModelChoice,
  Place,
  Role,
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
  // 폴더 안의 파일 이름들. 폴더가 없으면 빈 목록이다.
  list(path: string): string[];
}

export type ReadSql = Pick<Tx["sql"], "get" | "all">;

// 다른 concern의 값을 읽는 길. 정본은 각 concern이고 여기서는 읽기만 한다.
export type AgentLookups = {
  placeExists(place: Place): boolean;
  // 있는 project와 앱 전부. 목록과 Operator 찾기가 훑는다.
  places(): Place[];
  // 만드는 중(drafting)인 context와 보관한 context도 실제 context다. 없으면 null.
  contextStatus(id: string): "drafting" | "active" | "archived" | null;
  // context가 속한 project. 없으면 null. context는 project 안에만 있다.
  contextProject(id: string): string | null;
  // 이 place의 agent가 읽을 active context다. project place는 그 project의 active context 전부이고,
  // App Engineer는 그 앱을 app-data source로 읽는 active context 전부다. 그 밖에는 빈 목록이다.
  activeContexts(place: Place | null, role: Role): string[];
  // 이 place의 agent가 쓸 수 있는 skill 이름과 MCP tool이다. 전역 층에 project 층을 더한 것이고
  // 발견·등록 순서다. lophn(place 없음)은 전역 층만이다.
  skills(place: Place | null): string[];
  mcp(place: Place | null): McpTool[];
  // 전역 기본 model. 없으면 null.
  modelDefault(): ModelChoice | null;
};

export type AgentDeps = {
  files: AgentFileSystem;
  lookups(sql: ReadSql): AgentLookups;
  // 없으면 ledger 파일이 있는 폴더가 data root다.
  dataRoot?: string;
};
