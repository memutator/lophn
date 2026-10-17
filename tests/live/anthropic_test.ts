// 세 질문
// - contract: boundary `models`(받나, 잘리나, tool 인자가 JSON인가, token 수)와 `agent-tools`(실제 role tool 묶음).
// - 현실적 회귀: API 필드·한도·stream 모양이 바뀌어 fixture는 통과하는데 진짜 응답을 못 읽는 것, 이미지 입력 모양 거절.
// - 지금 못 잡는 이유: harness wire는 손 응답만 본다. 진짜 응답과 한도는 부르는 수밖에 없다.

import { liveSuite } from "./suite.ts";

liveSuite({
  provider: "anthropic",
  protocol: "anthropic-messages",
  endpoint: "https://api.anthropic.com/v1",
  model: "claude-haiku-5-5",
  keyEnv: "ANTHROPIC_API_KEY",
});
