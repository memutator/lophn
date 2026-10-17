// agent 내장 tool의 이름 목록과 이름 규칙이다. 입력 schema는 tool 정의가 자기 옆에 둔다.
// 정본 이름은 `<자원>.<동사>`이고 call, reply, cancel, ask만 한 단어다.
// 효과(read, write, external)는 여기 없다. core registry와 Gate에만 있다.
// 앱 app-api tool과 외부 MCP tool은 이름이 동적이라 접두사와 길이 상수만 둔다.

export const TOOL_NAME_MAX = 64;
export const WIRE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const APP_API_TOOL_PREFIX = "app__"; // app__<앱>__<api>
export const MCP_TOOL_PREFIX = "mcp__"; // mcp__<server>__<tool>

// 정본 `context.get`은 model에 `context_get`으로 보낸다. provider API가 `.`을 받지 않기 때문이다.
// 거꾸로 찾기는 core registry 표가 한다. 이름을 parse하지 않는다.
export function toWireToolName(canonical: string): string {
  return canonical.replaceAll(".", "_");
}
