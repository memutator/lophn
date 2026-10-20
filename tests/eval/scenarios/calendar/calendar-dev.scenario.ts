// 출처: roadmap eval "캘린더 단위". 개발자가 Event와 Schedule(RRULE 반복 정의, occurrence는 가상) 모델을 개발자의 말로 정해 주면 App Engineer가 그 모델대로 앱을 만들어 켜는지 본다.
// calendar-user와 달리 사람이 모델을 정확히 준다. 도구 이름과 입출력은 여전히 주지 않는다.
import { activeApp, say, type Scenario, untilIdle } from "../../types.ts";
import { AE, buildAppChecks, buildAppFixtures, CODING } from "./common.ts";
import { APP, CARD_DEV, SAY_DEV } from "./spec.ts";

const scenario: Scenario = {
  id: "calendar-dev",
  n: 1,
  proposal: false,
  world: ["notify-app@2", "date-range@2", "calendar-call@3"],
  real: [AE, CODING],
  human: { card: CARD_DEV, approve: { activation: "allow" } },
  steps: [say(AE, SAY_DEV), untilIdle()],
  save: { "calendar-app-dev": activeApp(APP) },
  checks: buildAppChecks(CARD_DEV, SAY_DEV),
  fixtures: buildAppFixtures(
    "Event와 Schedule을 나누고 RRULE 반복을 가상 occurrence로 그리는 캘린더 앱을 만든다",
  ),
};
export default scenario;
