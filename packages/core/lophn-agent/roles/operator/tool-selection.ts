import { BUILTIN_TOOLS, listTools } from "../../tools/mod.ts";
import type { CapabilityScope, ToolDefinition } from "../../tools/mod.ts";
import { ROLE_CAPS } from "../../agents/mod.ts";

// operator 역할의 tool 선택(roles/operator#R5). 목록은 Operator 상한(ROLE_CAPS 표)과
// Operator 기본 preset 선택의 교집합으로, 실제 정의는 내장 묶음에서 본다. 선택이
// 아직 고정되지 않은 기본 preset(null)은 빈 목록이고(fail closed), 목록 자체는
// 이 함수를 같은 입력으로 부르면 같다.
//
// 승인된 앱 read command(`app.call_read_command`·`app.command_metadata`)는 이름 목록이
// 아니라 blueprint 정의와 AgentAppScope(harness/run-loop/scope.ts)의 교집합이라
// 여기에 없다(R4, R5). 노출 상한은 APP_COMMAND_EXPOSURE 표가 둔다(agents/role-caps.ts).
//
// 문서 새 version(`document.save_version`)은 정의의 권한에 있을 때만 제공되는 내장 tool이다.
// 어느 문서에 쓸 수 있는지(담당 자리)와 되돌림·ask 판정은 쓰기마다 harness/tool-judgment가
// 하고 이 모듈은 그 규칙을 다시 만들지 않는다(R5, R7).

// operator의 현재 제공 목록이다. Operator의 preset 선택이 고정돼 있으면 상한
// 교집합의 내장 tool이고, 아니면 빈 목록이다.
export function operatorTools(
  presetTools: readonly string[] | null,
): readonly ToolDefinition[] {
  const scope: CapabilityScope = {
    presetTools,
    roleTools: ROLE_CAPS.get("operator")?.tools ?? null,
  };
  return listTools({ builtin: BUILTIN_TOOLS, app: [], external: [] }, scope);
}

// operator 상한 통로와 지만 Operator의 preset 선택이 아직 없어 목록이 빈 상태다(R5).
export function operatorToolNames(
  presetTools: readonly string[] | null,
): readonly string[] {
  return operatorTools(presetTools).map((tool) => tool.name);
}

// operator 상한 어디에도 없어 역할이 부를 수 없는 tool인지. 목록 판정은 상한 이름
// 목록만으로 본다(fail closed: 상한이 없으면 모두 부를 수 없다).
export function operatorOffers(
  name: string,
  presetTools: readonly string[] | null = ROLE_CAPS.get("operator")?.tools ??
    null,
): boolean {
  return operatorToolNames(presetTools).includes(name);
}
