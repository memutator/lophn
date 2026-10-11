import type { LophnError, Result } from "../../base/mod.ts";
import type {
  AgentDefinition,
  AgentIssue,
  AgentPlace,
  AgentRole,
  AgentSettings,
  McpTool,
  ModelChoice,
  Profile,
  ResolvedAgent,
} from "../../contracts/lophn-agent/mod.ts";

// 설정 층을 합쳐 run마다 고정하는 resolved agent를 만든다(agent-I2). 읽은 값만 받는 순수 함수라 파일도
// 시각도 만지지 않는다: 정의 파일은 호출하는 쪽이 읽어 파싱해 넘기고, 같은 입력이면 같은 값과 hash가 나온다.

// 제품이 고정하거나 다른 concern이 정하는 값이다. 테스트가 작은 값으로 바꿔 끼운다.
export type ResolveEnvironment = {
  // 이 role의 RoleCaps 개별 동작. 결과 tools의 순서가 이 순서다.
  role_caps: readonly string[];
  // 정의에 profile이 없을 때의 기본 icon.
  default_profile: Profile;
  // 이 자리에 등록된 skill 이름과 MCP tool(등록 순서).
  skills: readonly string[];
  mcp: readonly McpTool[];
  // 자리 project의 active context(자리가 project가 아니면 빈 목록). 보관한 context는 들어 있지 않다.
  active_contexts: readonly string[];
};

export type ResolveInput = {
  assignment: string;
  role: AgentRole;
  // Operator는 assignment의 scope, built-in은 session의 작업 자리다.
  place: AgentPlace;
  // 정의 파일이 없으면 null(built-in 기본). Operator는 파일이 있어야 agent다.
  definition: AgentDefinition | null;
  // Workspace 층은 파일이 아니라 `agent-model-defaults`의 역할별 기본 model과 platform/settings의 기본 권한이다.
  // 호출하는 쪽이 그 값을 이 모양으로 모아 넘긴다.
  workspace: AgentSettings;
  place_settings: AgentSettings;
  // composer에서 이 session만 고른 model. 없으면 null.
  session_model: ModelChoice | null;
  environment: ResolveEnvironment;
};

// 값마다 가장 높은 층이 이긴다(session > 정의 > 자리 > Workspace > 기본값). 규칙:
// - model은 ModelChoice 하나를 통째로 쓴다(option을 층끼리 섞지 않는다). role 키는 `models[role]`이다.
//   어느 층에도 없으면 invalid_input(`model` required)이고 run을 시작하지 않는다.
// - tools는 role_caps ∩ Workspace ∩ 자리 ∩ 정의의 permissions(없는 층은 거르지 않는다)다. 위 층에 없는
//   동작은 정의에 있어도 빠지고, 정의에 적은 동작만 남으므로 role_caps에 동작이 늘어도 좁힌 정의는 늘지 않는다.
// - skills·mcp는 등록된 것 가운데 skills_off·mcp_off에 없는 것(등록 순서)이다. 등록에 없는 끈 기록은 무시한다.
// - contexts는 Operator면 정의가 고른 것 가운데 active인 것(정의 순서), built-in이면 active 전부(주어진 순서)다.
//   built-in이 앱 자리에서 열리면 []와 `contexts_reason: "no_project"`다. built-in은 정의의 name·contexts·
//   app_reads를 쓰지 않는다.
// - agent_instructions는 정의 본문의 sha256Hex(정의가 없으면 빈 글), hash는 hash를 뺀 값의 fingerprint다.
// - sources: 값마다 그 값을 준 층. 정의는 칸을 실제로 가질 때만(profile·model·permissions·본문·비어 있지 않은
//   목록) `definition`이고 아니면 `default`다. place와 definition 층은 resolved agent의 place를 싣는다.
//   tools는 permissions를 가진 가장 높은 층이다.
// 오류: Operator인데 정의가 없으면 not_found, role이 그 자리에 올 수 없으면(Context Engineer가 앱, App Engineer가
// project) invalid_input(`place` not_allowed), Operator 정의에 name이 없으면 invalid_input(`name` required).
export function resolveAgent(
  _input: ResolveInput,
): Promise<Result<ResolvedAgent, LophnError>> {
  throw new Error("not implemented: agent-I2");
}

// requested 가운데 allowed에 없는 동작마다 `<field>.<index>` 항목(`over_cap`)을 돌려준다(field 기본값은
// `permissions.tools`, index는 requested 안의 자리). 저장 때 정의의
// permissions를 자리 권한에, 자리 권한을 Workspace 기본에, 정의를 role 상한에 대 보는 데 쓴다(R20, R21).
export function permissionIssues(
  _requested: readonly string[],
  _allowed: readonly string[],
  _field?: string,
): AgentIssue[] {
  throw new Error("not implemented: agent-I2");
}
