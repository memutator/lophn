import { definePort } from "../../../protocol/base/mod.ts";

// lophn-agent의 turn 유효성 read가 채우는 판정. platform은 turn 상태를 직접 읽지 않는다.
// active는 진행 중 turn, finished는 끝난 turn(감사 보완만), unknown은 자격 밖·없는 turn이다.
type TurnAdmission = {
  status(turn: string): "active" | "finished" | "unknown";
};

export const turnAdmission = definePort<TurnAdmission>(
  "lophn-agent.turn-admission",
);
