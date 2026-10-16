import { definePort } from "../../../protocol/base/mod.ts";

// lophn-agent의 run 유효성 read가 채우는 판정. platform은 run 상태를 직접 읽지 않는다.
// active는 진행 중 run, finished는 끝난 run(감사 보완만), unknown은 자격 밖·없는 run이다.
type RunAdmission = {
  status(run: string): "active" | "finished" | "unknown";
};

export const runAdmission = definePort<RunAdmission>(
  "lophn-agent.run-admission",
);
