// 출처: AGENT.md L5 (제안). project 안의 일은 그 project place의 lophn에게 넘기고 결과를 받는다
// (remove-role README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session").
import { callCount, fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { firstCallBody, LOPHN, LOPHN_hr, LOPHN_tax } from "./common.ts";

const REQUEST = "세무 프로젝트 문서에서 공제 한도 자료를 모아 기획에 써 줘";
const BODY = `세무 프로젝트 문서에서 공제 한도 자료를 모아 기획에 쓴다. 사람 요청: ${REQUEST}`;
const WHERE = { target: LOPHN_tax, reply: "result" } as const;

const scenario: Scenario = {
  id: "L5",
  n: 4,
  proposal: true,
  world: ["projects-home@1"],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-tax-result", { count: { min: 1 }, where: WHERE }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-tax-result"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(REQUEST, firstCallBody(trial, WHERE)),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN, [
          { call: { to: LOPHN_tax, reply: "result", body: BODY } },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            { call: { to: LOPHN_hr, reply: "result", body: BODY } },
          ]),
        ]),
        fails: ["call-to-tax-result"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [{ tool: "file.read", effect: "read" }]),
        ]),
        fails: ["call-to-tax-result"],
      },
    ],
  },
};
export default scenario;
