// app-engineer 시나리오가 같이 쓰는 참가자. 이름은 call 도구의 `to`가 맞추는 이름과 같다.
import type { Participant } from "../../types.ts";

export const AE_가계부: Participant = {
  role: "app_engineer",
  place: { app: "가계부" },
};
export const AE_할일: Participant = {
  role: "app_engineer",
  place: { app: "할일" },
};
export const LOPHN: Participant = { role: "lophn" };
