// project 시나리오가 같이 쓰는 참가자. 이름은 `call.send` 명령의 `to`가 맞추는 이름과 같다.
import type { Participant } from "../../types.ts";

export const LOPHN: Participant = { agent: "lophn" };
export const LOPHN_tax: Participant = {
  agent: "lophn",
  workspace: { project: "tax" },
};
export const LOPHN_hr: Participant = {
  agent: "lophn",
  workspace: { project: "hr" },
};
// 사람이 만든 agent. 정의는 전역이고 tax project workspace에서 말한다.
export const 세무정리_tax: Participant = {
  agent: "세무정리",
  workspace: { project: "tax" },
};
