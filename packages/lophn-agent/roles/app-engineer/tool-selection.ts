import { listTools } from "../../harness/tools/mod.ts";
import { BUILTIN_TOOLS } from "../../harness/tools/mod.ts";
import type {
  CapabilityScope,
  ToolDefinition,
} from "../../harness/tools/mod.ts";
import { ROLE_CAPS } from "../../agents/mod.ts";

// app_engineer 역할의 tool 선택(roles/app-engineer#R5, R6, R21). 목록은 AE 상한
// (ROLE_CAPS 표)과 AE 기본 preset 선택의 교집합으로, 실제 정의는 내장 묶음에서
// 본다. 선택이 아직 고정되지 않은 기본 preset(null)은 빈 목록이고(fail closed),
// 목록 자체는 이 함수를 같은 입력으로 부르면 같다.
//
// 담당 앱 command tool은 이름 목록이 아니라 blueprint 정의와 AgentAppScope
// (harness/run-loop/scope.ts)의 교집합이라 여기에 없다(R21). 앱 command 노출
// 상한은 APP_COMMAND_EXPOSURE 표가 둔다(agents/role-caps.ts).
//
// ticket 읽기·생성·전환(`ticket.list`·`ticket.read`·`ticket.create`·`ticket.make_ready`)은
// harness/tools의 ticket 묶음이 정의하고 준비 검사는 ./ticket.ts가 둔다(R6, R16, R17). 문제 해석
// 참조 설정(problem.set_interpretation)의 정의는 내장 묶음 `bundles/problem-interpretation.ts`가 둔다.

// app_engineer의 현재 제공 목록이다. AE의 preset 선택이 고정돼 있으면 상한
// 교집합의 내장 tool이고, 아니면 빈 목록이다.
export function appEngineerTools(
  presetTools: readonly string[] | null,
): readonly ToolDefinition[] {
  const scope: CapabilityScope = {
    presetTools,
    roleTools: ROLE_CAPS.get("app_engineer")?.tools ?? null,
  };
  return listTools({ builtin: BUILTIN_TOOLS, app: [], external: [] }, scope);
}

// app_engineer 상한에는 있지만 해석 참조 정의가 아직 없어 그 이름은 목록에 없다(T50).
export function appEngineerToolNames(
  presetTools: readonly string[] | null,
): readonly string[] {
  return appEngineerTools(presetTools).map((tool) => tool.name);
}

// app_engineer 상한이 제공하지 않는 tool인지. 목록 판정은 상한 이름 목록만으로
// 본다(fail closed: 상한이 없으면 모두 제공하지 않는다).
export function appEngineerOffers(
  name: string,
  presetTools: readonly string[] | null = ROLE_CAPS.get("app_engineer")
    ?.tools ?? null,
): boolean {
  return appEngineerToolNames(presetTools).includes(name);
}
