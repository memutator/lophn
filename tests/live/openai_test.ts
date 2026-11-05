// 세 질문
// - contract: boundary `models`(받나, 잘리나, tool 인자가 JSON인가, token 수)와 `agent-tools`(실제 workspace tool 묶음).
// - 현실적 회귀: API 필드·한도·stream 모양 변화, 실제 tool 묶음이 커져 reasoning이 출력 한도에서 잘리는 것.
// - 지금 못 잡는 이유: harness wire는 손 응답만 본다. 진짜 응답과 한도는 부르는 수밖에 없다.

import { liveSuite } from "./suite.ts";

// 공용 행은 reasoning 없는 가장 싼 model, 잘림 행만 reasoning model이다.
liveSuite({
  provider: "openai",
  protocol: "openai-responses",
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-nano",
  truncationModel: "gpt-5-nano",
  keyEnv: "OPENAI_API_KEY",
});
