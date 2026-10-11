import type { LophnError, Result } from "../../base/mod.ts";
import type {
  AgentDefinition,
  AgentIssue,
  AgentPlaceKind,
  AgentRole,
  AgentSettings,
} from "../../contracts/lophn-agent/mod.ts";

// 정의 파일과 자리 설정 파일의 Markdown 읽기·쓰기다(agent-I1). 순수 함수이고 파일 IO도 hash도 없다.
//
// 파일 모양:
// - 첫 줄이 `---`이면 그 다음 `---` 줄까지가 frontmatter(YAML map)이고 나머지가 본문이다. 닫는 줄이 없거나
//   YAML이 깨졌거나 map이 아니면 `frontmatter`가 `malformed`다. 첫 줄이 `---`가 아니면 파일 전체가 본문이다.
// - 본문은 앞쪽 빈 줄과 뒤쪽 공백을 뺀 글이다. 쓸 때는 끝에 줄바꿈 하나를 붙인다. 본문 안의 `---` 줄은 본문이다.
// - 쓸 때는 있는 칸만 쓴다. 비운 칸과 빈 기본 목록(contexts, app_reads, skills_off, mcp_off, safe_tools)은 쓰지 않고,
//   칸이 하나도 없으면 frontmatter 줄 없이 본문만 쓴다. 칸 순서는 입력 순서와 상관없이 고정이다.
// - 쓴 글을 다시 읽으면 처음 값이 나온다. 숫자·불리언처럼 보이는 문자열도 문자열로 돌아온다.
//
// 검사는 읽을 때와 쓸 때 같다(R24): 모양 전체를 한 번에 보고 틀린 칸을 모두 `issues`에 담는다. 하나라도 틀리면
// 값도 글도 돌려주지 않는다. 칸 경로는 점 표기(`contexts.1`, `model.api_key`)이고 모르는 칸은 부모 경로 뒤에
// 그 이름을 붙인다. 존재 여부가 필요한 참조(context, 앱 command, provider, 권한 상한)와 같은 자리 Operator 사이의
// 이름 중복은 파일만으로 알 수 없으므로 여기서 보지 않는다.

export type AgentFileTarget = { role: AgentRole; place: AgentPlaceKind };

export type AgentFileError = LophnError & {
  code: "invalid_input";
  details: { issues: AgentIssue[] };
};

export function parseAgentFile(
  _text: string,
  _target: AgentFileTarget,
): Result<AgentDefinition, AgentFileError> {
  throw new Error("not implemented: agent-I1");
}

export function serializeAgentFile(
  _definition: AgentDefinition,
  _target: AgentFileTarget,
): Result<string, AgentFileError> {
  throw new Error("not implemented: agent-I1");
}

// `settings.md`. 본문이 없는 frontmatter만의 파일이다.
export function parseSettingsFile(
  _text: string,
): Result<AgentSettings, AgentFileError> {
  throw new Error("not implemented: agent-I1");
}

export function serializeSettingsFile(
  _settings: AgentSettings,
): Result<string, AgentFileError> {
  throw new Error("not implemented: agent-I1");
}
