// Agents 탭과 agent editor가 함께 쓰는 화면 값. 값의 정본은 protocol의 agents·approvals/assignment이고,
// 여기는 화면이 contract만으로 만들 수 없는 것(model 표시 이름, 이미지 주소, 켬·끔 줄, project 지침 글)만 더한다.
// renderer는 protocol을 type으로만 쓴다.
import type { AgentValueLayer } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type {
  McpAuthFailure,
  McpAuthStateName,
} from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import type { Place } from "../../../../protocol/lophn-agent/places.ts";

/**
 * model 선택을 사람이 읽는 글로 바꾼다("Sonnet 5.5 · Medium"). model 이름과 option 표시 이름은 catalog가
 * 정하므로 화면 코드에 두지 않고 core source 쪽이 이 함수를 만들어 준다.
 */
export type ModelLabel = (choice: ModelChoice) => string;

/**
 * 올린 이미지 avatar의 주소(profile-images/read). contract의 profile은 파일 이름(`avatar.png`)만 가져서
 * 화면이 읽을 수 있는 주소는 연결 쪽이 풀어 준다.
 */
export type ImageSrc = (assignment: string, image: string) => string;

/** 지침 파일 하나의 글과 그 hash. 파일이 아직 없으면 text가 빈 글이고 hash가 null이다(첫 저장이 만든다). */
export interface InstructionsFile {
  readonly text: string;
  readonly hash: string | null;
}

/**
 * project 지침 `LOPHN.md`. 파일이 없거나 비면 text가 빈 글이다. project는 그 지침이 속한 project의 이름이고,
 * 알 수 없으면 null이다(앱 자리 agent의 project 폴더를 모를 때).
 */
export interface ProjectInstructionsView extends InstructionsFile {
  readonly project: string | null;
}

/** 값과 그 값이 어느 층에서 왔는지. */
export interface Sourced<T> {
  readonly value: T;
  readonly source: AgentValueLayer;
}

/** skill의 층. 내장은 place 종류가 가진 것이고 나머지는 전역, project·app, 그릇 자리의 skills/(place-data)다. */
export type SkillLayer =
  | "builtin"
  | "global"
  | "project"
  | "app"
  | "place-data"
  | "shared";

/** skill 한 줄. 끈 skill도 줄로 남는다. 내장 skill은 끌 수 없어 builtIn이 참이다. */
export interface SkillRow {
  readonly name: string;
  readonly detail: string;
  readonly layer: SkillLayer;
  readonly on: boolean;
  readonly builtIn: boolean;
}

/** MCP server의 층. agent 층은 그 agent의 정의가 가진 것이다. */
export type McpLayer = "global" | "project" | "agent";

/** 연결 상태. 지금 열려 있는지 읽는 길이 없으면 null이고 점은 중립 색이다. */
export type McpStatus = "connected" | "needs-sign-in" | null;

/**
 * OAuth server의 로그인 상태다. `place`·`agent`는 서버의 소유자이고(전역은 둘 다 null) 로그인은 이 소유자로
 * 부른다. `client_id`·`scopes`는 등록한 설정값이라 화면이 begin에 그대로 넣는다.
 */
export interface McpLogin {
  readonly place: Place | null;
  /** agent 정의 층 서버면 그 agent의 id다. 그 밖에는 null이다. */
  readonly agent: string | null;
  readonly client_id: string;
  readonly scopes: readonly string[];
  readonly state: McpAuthStateName;
  readonly reason: McpAuthFailure | null;
}

/** MCP server 한 줄. */
export interface McpRow {
  readonly name: string;
  readonly detail: string;
  readonly layer: McpLayer;
  readonly on: boolean;
  readonly status: McpStatus;
  /** OAuth server이고 화면이 로그인을 시작할 수 있으면 있다. agent 정의 층은 저장된 정의의 서버에만 있다. */
  readonly login?: McpLogin;
}
