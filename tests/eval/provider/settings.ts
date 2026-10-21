import type { Scenario } from "../types.ts";

// model 호출 한 turn의 제품 기본 한도는 판단 case에 너무 넉넉하다. 판단 case는 turn 하나에 호출이 4~6번이라
// 15는 도는 turn이 돈을 계속 쓰는 것을 막는 상한이다. 앱을 짓는 시나리오(`limits`가 있는 것)는 App Engineer가 한 turn에서
// 설계, 코드, test, release까지 하므로 제품 기본 한도로 돈다. 돈은 trial 비용 상한이 막는다.
export const EVAL_MODEL_ATTEMPTS = 15;

// core의 TURN_LIMIT_SETTING_KEYS를 import하지 않는다. variant checkout의 core 코드에 eval이 기대지 않게 한다.
export function evalCoreSettings(
  scenario: Pick<Scenario, "limits">,
): Record<string, unknown> {
  return scenario.limits === undefined
    ? { "lophn-agent.run.model_attempts": EVAL_MODEL_ATTEMPTS }
    : {};
}
