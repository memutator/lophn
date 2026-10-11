import { listTools } from "../../harness/tools/mod.ts";
import { BUILTIN_TOOLS } from "../../harness/tools/mod.ts";
import type {
  CapabilityScope,
  ToolDefinition,
} from "../../harness/tools/mod.ts";
import { ROLE_CAPS } from "../../agents/mod.ts";

// lophn 역할의 tool 선택(roles/lophn#R1–R5). 목록은 lophn 상한(ROLE_CAPS 표)과
// lophn 기본 preset 선택의 교집합으로, 실제 정의는 내장 묶음에서 본다. 선택이
// 아직 고정되지 않은 기본 preset(null)은 빈 목록이고(fail closed), 목록 자체는
// 이 함수를 같은 입력으로 부르면 같다.
//
// 질문 draft를 싣는 길(T29에서 넘어온 것): `question.submit` tool은 선택지의
// action을 `null`로만 받는다. `recommendPlaces`·`settingChangeQuestion`이 만든
// draft의 고정 action은 이 모듈의 draft 제출 값으로 그대로 실리고, hash·CAS는
// draft 함수가 만든 것을 바꾸지 않는다. 모델이 고르는 것은 대상·값 후보뿐이다.

// lophn의 현재 제공 목록이다. person의 preset 선택이 고정돼 있으면 상한 교집합의
// 내장 tool이고, 아니면 빈 목록이다.
export function lophnTools(
  presetTools: readonly string[] | null,
): readonly ToolDefinition[] {
  const scope: CapabilityScope = {
    presetTools,
    roleTools: ROLE_CAPS.get("lophn")?.tools ?? null,
  };
  return listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    scope,
  );
}

// lophn 상한 통로와 지만 person의 preset 선택이 아직 없어 목록이 빈 상태다.
export function lophnToolNames(
  presetTools: readonly string[] | null,
): readonly string[] {
  return lophnTools(presetTools).map((tool) => tool.name);
}

// lophn 상한 어디에도 없어 역할이 부를 수 없는 tool인지. 목록 판정은 상한 이름
// 목록만으로 본다(fail closed: 상한이 없으면 모두 부를 수 없다).
export function lophnOffers(
  name: string,
  presetTools: readonly string[] | null = ROLE_CAPS.get("lophn")?.tools ??
    null,
): boolean {
  return lophnToolNames(presetTools).includes(name);
}
