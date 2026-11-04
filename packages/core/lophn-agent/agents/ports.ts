import type {
  McpTool,
  ModelChoice,
  Place,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { SharedFolder } from "../extensions/skills.ts";
import type { AvailableSkill } from "./resolve.ts";

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
  placeExists(place: Place): boolean;
  // 이 place의 session이 쓸 수 있는 skill 이름이다. 전역 층에 그릇 자리의 place-data 층을 더한 것이고
  // 발견·등록 순서다. home(place 없음)은 전역 층만이다. 그 place 종류에
  // 선언된 내장 skill과 켜진 skill만이다.
  skills(place: Place | null): readonly AvailableSkill[];
  // 할당한 앱(slug)이 내놓은 public skill이다. slug 순에 같은 이름은 앞의 것만이다.
  shared(apps: readonly string[]): readonly AvailableSkill[];
  mcp(place: Place | null): McpTool[];
  // 할당한 앱(slug)의 public command에서 deny로 뺀 것을 제외한 목록이다. 명함의 차이가 쓴다.
  sharedCommands(
    apps: readonly string[],
    deny: readonly string[],
  ): { slug: string; name: string }[];
  // model이 받는 입력 종류. catalog가 모르는 model이나 provider는 null이다.
  inputMedia(model: ModelChoice): readonly string[] | null;
  // 전역 기본 model. 없으면 null.
  modelDefault(): ModelChoice | null;
  // project place의 model. project 층이 없는 place(앱, lophn)나 값이 없으면 null.
  projectModel(place: Place | null): ModelChoice | null;
};

// project·앱 표를 가진 module이 내놓는 읽기다. 조립(core/main)이 그 module의 함수로 만들어 꽂는다.
export type PlaceLookups = {
  projectExists(sql: ReadSql, id: string): boolean;
  projectIds(sql: ReadSql): string[];
  appExists(sql: ReadSql, id: string): boolean;
  appIds(sql: ReadSql): string[];
  // project의 첫 등록 폴더나 앱의 source 폴더다. 폴더가 없으면 null이다. 그 폴더의 `.lophn/skills`가 skill 층이다.
  sourceFolder(sql: ReadSql, place: Place): string | null;
  // 할당한 앱(slug)의 active release bundle 사본과 선언의 public skill 이름이다. 공유 skill의 동기 목록 재료다.
  sharedSkills(
    sql: ReadSql,
    dataRoot: string,
    slugs: readonly string[],
  ): SharedFolder[];
  sharedCommands(
    sql: ReadSql,
    slugs: readonly string[],
    deny: readonly string[],
  ): { slug: string; name: string }[];
};

export type AgentDeps = {
  files: AgentFileSystem;
  lookups(sql: ReadSql): AgentLookups;
  // 없으면 ledger 파일이 있는 폴더가 data root다.
  dataRoot?: string;
};
