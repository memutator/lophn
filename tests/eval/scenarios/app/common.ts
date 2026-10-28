// app 시나리오가 같이 쓰는 참가자. 이름은 call 도구의 `to`가 맞추는 이름과 같다.
import type { Participant } from "../../types.ts";

export const LOPHN: Participant = { agent: "lophn" };
export const LOPHN_가계부: Participant = {
  agent: "lophn",
  place: { app: "가계부" },
};
export const LOPHN_할일: Participant = {
  agent: "lophn",
  place: { app: "할일" },
};
