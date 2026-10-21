// 출처: roadmap eval "캘린더 단위". 일반 사용자가 일상의 말로 캘린더 앱을 청하면 App Engineer가 도메인과 화면을 스스로 잡아 알림 앱·date-range를 쓰며 만들어 켜는지 본다.
// 사람은 tool 이름도 입출력도 모른다. calendar-blank 재료는 앱 등록만 되살린다.
import { activeApp, say, type Scenario, untilIdle } from "../../types.ts";
import { AE, buildAppChecks, buildAppFixtures } from "./common.ts";
import { APP, CARD_USER, SAY_USER } from "./spec.ts";

const scenario: Scenario = {
  id: "calendar-user",
  n: 2,
  proposal: false,
  world: ["notify-app@3", "date-range@3", "calendar-blank@1"],
  real: [AE],
  limits: { idle_ms: 90 * 60_000 },
  human: { card: CARD_USER, approve: { activation: "allow" } },
  steps: [say(AE, SAY_USER), untilIdle()],
  save: { "calendar-app-user": activeApp(APP) },
  checks: buildAppChecks(CARD_USER, SAY_USER),
  fixtures: buildAppFixtures(
    "일정을 넣고 보고 지우고 시작 전에 알리는 캘린더 앱을 만든다",
  ),
};
export default scenario;
