// project-manager 시나리오가 같이 쓰는 참가자. 이름은 call 도구의 `to`가 맞추는 이름과 같다.
import type { Participant } from "../../types.ts";

export const PM_tax: Participant = {
  role: "project_manager",
  place: { project: "tax" },
};
export const PM_hr: Participant = {
  role: "project_manager",
  place: { project: "hr" },
};
export const LOPHN: Participant = { role: "lophn" };
