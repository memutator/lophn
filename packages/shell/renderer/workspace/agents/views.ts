// Agents 탭과 Operator editor가 함께 쓰는 화면 값(shell/workspace#R36~R44). 값의 정본은 lophn-agent/agents
// contract(AgentListRow·ReadAgent·ReadPlaceAgentSettings)이고, 여기는 화면이 contract만으로 만들 수 없는 것
// (model 표시 이름, 이미지 주소, 켬·끔 줄)만 더한다. renderer는 contracts를 type으로만 쓴다.
import type {
  AgentPermissions,
  Profile,
  ValueSource,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";

/**
 * model 선택을 사람이 읽는 글로 바꾼다("Sonnet 5.5 · Medium"). model 이름과 option 표시 이름은 catalog가
 * 정하므로 화면 코드에 두지 않고 core source 쪽이 이 함수를 만들어 준다.
 */
export type ModelLabel = (choice: ModelChoice) => string;

/**
 * 올린 이미지 avatar의 주소(agent-profiles/read). contract의 profile은 파일 이름(`avatar.png`)만 가져서
 * 화면이 읽을 수 있는 주소는 연결 쪽이 풀어 준다.
 */
export type ImageSrc = (assignment: string, image: string) => string;

/** project 폴더의 LOPHN.md. 파일이 없거나 비면 text가 빈 글이다. */
export interface ProjectInstructionsView {
  readonly text: string;
}

/** 이름과 켬·끔을 가진 줄. project에 등록한 skill과 MCP server가 쓴다. */
export interface ToggleRow {
  readonly name: string;
  readonly on: boolean;
}

/** 권한 한 줄. tool은 개별 동작 이름(`documents.edit`)이고 label은 사람이 읽는 글이다. */
export interface PermissionRow {
  readonly tool: string;
  readonly label: string;
  readonly on: boolean;
}

/** 값과 그 값이 어느 층에서 왔는지(ReadAgent.effective의 칸). */
export interface Sourced<T> {
  readonly value: T;
  readonly source: ValueSource;
}

/** ReadAgent의 effective 중 editor가 쓰는 칸. 정의에 칸이 없을 때 보일 상속 값이다. */
export interface AgentEffective {
  readonly name: Sourced<string>;
  readonly profile: Sourced<Profile>;
  /** 어느 층에도 model이 없으면 null이다. */
  readonly model: Sourced<ModelChoice> | null;
  readonly permissions: Sourced<AgentPermissions>;
}
