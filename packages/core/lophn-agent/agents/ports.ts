import type { Result } from "../../../base/mod.ts";
import { definePort, type ErasedJobSpec } from "../../../protocol/base/mod.ts";
import type {
  AgentId,
  McpTool,
  ModelChoice,
  SkillDeployment,
  Workspace,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { SharedFolder } from "../extensions/skills.ts";
import type { AvailableSkill } from "./resolve.ts";

// agent.delete가 같은 Tx에서 다른 module의 기록(session, 이 agent가 만들었거나 부르는 job)을 지우는 길이다.
// core/main(wiring/agent-delete.ts)이 끼운다.
export interface AgentRemnantsEraser {
  erase(agent: {
    id: AgentId;
    handle: string;
    workspace: Workspace | null;
  }): Result<{ sessions: string[]; erased_jobs: ErasedJobSpec[] }>;
}

export const agentRemnantsEraser = definePort<AgentRemnantsEraser>(
  "agents.AgentRemnantsEraser",
);

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
  // 폴더를 만든다. 이미 있으면 그대로다.
  ensureFolder(path: string): void;
}

export type ReadSql = Pick<Tx["sql"], "get" | "all">;

// 다른 concern의 값을 읽는 길. 정본은 각 concern이고 여기서는 읽기만 한다.
export type AgentLookups = {
  // 있는 project와 앱 전부다(archived 앱도). workspace마다 lophn이 하나씩 있다.
  workspaces(): Workspace[];
  workspaceExists(workspace: Workspace): boolean;
  // archived 앱의 workspace다. agent에게는 없는 workspace로 다룬다.
  workspaceArchived(workspace: Workspace): boolean;
  // 이 workspace의 session이 쓸 수 있는 skill 이름이다. 전역 층에 그릇 자리의 workspace-data 층을 더한 것이고
  // 발견·등록 순서다. home(workspace 없음)은 전역 층만이다. 그 workspace 종류에
  // 선언된 내장 skill과 켜진 skill만이다.
  skills(workspace: Workspace | null): readonly AvailableSkill[];
  // 그 workspace의 session에 닿는 배포 기록이다: 전역과 workspace 층에 그 agent 층을 더해 합친다.
  reaching(
    workspace: Workspace | null,
    agent: readonly SkillDeployment[],
  ): readonly SkillDeployment[];
  // 배포 기록이 가리킨 앱 skill이다(그 앱의 active release가 내놓은 public skill 가운데 배포한 이름). slug 순에 같은 이름은 앞의 것만이다.
  shared(deployed: readonly SkillDeployment[]): readonly AvailableSkill[];
  mcp(workspace: Workspace | null): McpTool[];
  // 배포 기록이 가리킨 앱(slug)의 public command 목록이다. 명함의 차이가 쓴다.
  sharedCommands(
    deployed: readonly SkillDeployment[],
  ): { slug: string; name: string }[];
  // model의 provider 이름과 catalog 사실(받는 입력 종류, 가격 첫 요율). provider가 없으면 null이고 catalog가 모르는 model은 inputMedia·price가 null이다.
  modelInfo(model: ModelChoice): {
    provider: string;
    inputMedia: readonly string[] | null;
    price: { input: string | null; output: string | null } | null;
  } | null;
  // 전역 기본 model. 없으면 null.
  modelDefault(): ModelChoice | null;
  // workspace(null은 Home)의 model 층. 값이 없으면 null.
  workspaceModel(workspace: Workspace | null): ModelChoice | null;
};

// project·앱 표를 가진 module이 내놓는 읽기다. 조립(core/main)이 그 module의 함수로 만들어 꽂는다.
export type WorkspaceLookups = {
  projectExists(sql: ReadSql, id: string): boolean;
  projectIds(sql: ReadSql): string[];
  appExists(sql: ReadSql, id: string): boolean;
  appIds(sql: ReadSql): string[];
  appArchived(sql: ReadSql, id: string): boolean;
  // project의 첫 등록 폴더나 앱의 source 폴더다. 폴더가 없으면 null이다. 그 폴더의 `.lophn/skills`가 skill 층이다.
  sourceFolder(sql: ReadSql, workspace: Workspace): string | null;
  // 배포한 앱 skill의 active release bundle 사본과 선언의 public skill 이름이다. 공유 skill의 동기 목록 재료다.
  sharedSkills(
    sql: ReadSql,
    dataRoot: string,
    deployed: readonly SkillDeployment[],
  ): SharedFolder[];
  sharedCommands(
    sql: ReadSql,
    slugs: readonly string[],
  ): { slug: string; name: string }[];
};

export type AgentDeps = {
  files: AgentFileSystem;
  lookups(sql: ReadSql): AgentLookups;
  // 없으면 ledger 파일이 있는 폴더가 data root다.
  dataRoot?: string;
};
