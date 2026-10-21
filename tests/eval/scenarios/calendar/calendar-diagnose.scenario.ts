// 출처: roadmap eval "캘린더 단위". 심은 bug가 연 problem을 App Engineer가 읽고 원인을 고쳐 다시 나지 않게 하는지 본다.
// 사람 자격 callApi가 bug를 터뜨리면 problem이 열리고 program이 App Engineer를 부른다.
import { diagnosisChecks } from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import { callApi, type Scenario, untilIdle } from "../../types.ts";
import { AE } from "./common.ts";
import { APP, BUG, CARD_DIAGNOSE } from "./spec.ts";

const scenario: Scenario = {
  id: "calendar-diagnose",
  n: 5,
  proposal: false,
  world: ["calendar-app-bug@2"],
  real: [AE],
  human: { card: CARD_DIAGNOSE, approve: { activation: "allow" } },
  steps: [callApi(APP, BUG.api, BUG.input), untilIdle()],
  checks: diagnosisChecks({ app: APP, bug: BUG }),
  fixtures: { right: [fixtureTrial([fixtureSession(AE, [])])], wrong: [] },
};
export default scenario;
