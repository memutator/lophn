// Agents 탭과 agent editor가 함께 쓰는 화면 값. 값의 정본은 protocol의 agents·approvals/assignment이고,
// 여기는 화면이 contract만으로 만들 수 없는 것(model 표시 이름, 이미지 주소, 켬·끔 줄, project 지침 글)만 더한다.
// renderer는 protocol을 type으로만 쓴다.
import type { AgentValueLayer } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type {
  McpAuthFailure,
  McpAuthStateName,
  McpOwnerWorkspace,
  McpTrust,
} from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";

/**
 * model 선택을 사람이 읽는 글로 바꾼다("Sonnet 5.5 · Medium"). model 이름과 option 표시 이름은 catalog가
 * 정하므로 화면 코드에 두지 않고 core source 쪽이 이 함수를 만들어 준다.
 */
export type ModelLabel = (choice: ModelChoice) => string;

/**
 * 올린 이미지 avatar의 주소(avatar-images/read). contract의 avatar는 파일 이름(`avatar.png`)만 가져서
 * 화면이 읽을 수 있는 주소는 연결 쪽이 풀어 준다.
 */
export type ImageSrc = (assignment: string, image: string) => string;

/** 지침 파일 하나의 글과 그 hash. 파일이 아직 없으면 text가 빈 글이고 hash가 null이다(첫 저장이 만든다). */
export interface InstructionsFile {
  readonly text: string;
  readonly hash: string | null;
}

/**
 * workspace 지침. project와 Home은 `LOPHN.md`, 앱은 source 폴더의 `AGENTS.md`다. 파일이 없거나 비면 text가 빈 글이다.
 * workspace는 그 지침이 속한 자리의 이름이고, 알 수 없으면 null이다.
 */
export interface WorkspaceInstructionsView extends InstructionsFile {
  readonly workspace: string | null;
  readonly file: "LOPHN.md" | "AGENTS.md";
  /** false면 파일이 놓일 곳이 없다(source를 잇지 않은 앱). 빈 글로 보이고 고치지 않는다. */
  readonly editable: boolean;
}

/** 어느 memory인가: workspace memory(Home이면 "home", 아니면 project·앱 id)이거나 사람이 만든 agent의 memory. */
export type MemoryTarget =
  | { readonly kind: "workspace"; readonly workspace: string }
  | { readonly kind: "agent"; readonly agent: string };

/** 값과 그 값이 어느 층에서 왔는지. */
export interface Sourced<T> {
  readonly value: T;
  readonly source: AgentValueLayer;
}

/** skill의 층. 내장은 workspace 종류가 가진 것이고 나머지는 전역, project·app, Home·project·앱 그릇 자리의 skills/(workspace-data)다. */
export type SkillLayer =
  | "builtin"
  | "global"
  | "project"
  | "app"
  | "workspace-data"
  | "shared";

/** skill 한 줄. 끈 skill도 줄로 남는다. 내장 skill은 끌 수 없어 builtIn이 참이다. */
export interface SkillRow {
  readonly name: string;
  readonly detail: string;
  readonly layer: SkillLayer;
  readonly on: boolean;
  readonly builtIn: boolean;
}

/** 배포할 수 있는 앱 skill 전부. 기록은 앱을 id로 가리키므로, 앱이 더는 skill을 내놓지 않는 기록에도 앱 이름을 보이도록 모든 앱의 이름(`appNames`)을 같이 든다. */
export interface DeployableList extends ReadonlyArray<DeployableSkill> {
  readonly appNames?: ReadonlyMap<string, string>;
}

/** 배포할 수 있는 앱 skill 하나: 앱(id와 이름)의 active release가 내놓은 public skill이다. 기록은 앱을 id로 가리킨다. */
export interface DeployableSkill {
  readonly app: string;
  readonly appName: string;
  readonly skill: string;
  readonly description: string;
}

/** MCP server의 층. workspace 층은 Home·project·앱의 `extensions.json`이고 agent 층은 그 agent의 정의가 가진 것이다. */
export type McpLayer = "global" | "workspace" | "agent";

/** 연결 상태. 지금 열려 있는지 읽는 길이 없으면 null이고 점은 중립 색이다. */
export type McpStatus = "connected" | "needs-sign-in" | null;

/**
 * OAuth server의 로그인 상태다. `workspace`·`agent`는 서버의 소유자이고(전역은 둘 다 null, Home 층은 `{kind: "home"}`) 로그인은 이 소유자로
 * 부른다. `client_id`·`scopes`는 등록한 설정값이라 화면이 begin에 그대로 넣는다.
 */
export interface McpLogin {
  readonly workspace: McpOwnerWorkspace | null;
  /** agent 정의 층 서버면 그 agent의 id다. 그 밖에는 null이다. */
  readonly agent: string | null;
  readonly client_id: string;
  readonly scopes: readonly string[];
  readonly state: McpAuthStateName;
  readonly reason: McpAuthFailure | null;
}

/** server가 가리키는 secret 한 자리. 값은 보호 입력 창이 받고 `name`은 `secrets.json`의 이름이다. */
export interface McpSecret {
  readonly name: string;
  /** 단추에 쓰는 말(value, client secret, 헤더 이름). */
  readonly label: string;
  /** 값이 들어 있는지. 읽지 않은 화면에서는 null이다. */
  readonly set: boolean | null;
}

/** MCP server 한 줄. */
export interface McpRow {
  readonly name: string;
  readonly detail: string;
  readonly layer: McpLayer;
  readonly on: boolean;
  readonly trust?: McpTrust;
  readonly status: McpStatus;
  /** OAuth server이고 화면이 로그인을 시작할 수 있으면 있다. agent 정의 층은 저장된 정의의 서버에만 있다. */
  readonly login?: McpLogin;
  /** http server가 secret을 가리키는 자리(bearer·API key credential, OAuth client secret, `{secret}` 헤더). 없으면 값 단추가 없다. */
  readonly secrets?: readonly McpSecret[];
}
