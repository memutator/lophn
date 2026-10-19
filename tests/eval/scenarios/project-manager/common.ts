// project-manager 시나리오가 같이 쓰는 참가자. 이름은 call 도구의 `to`가 맞추는 이름과 같다.
// ledger-project와 todo-project는 apps-home 재료가 앱마다 만든 project다(`openAppProject`의 `<slug>-project`).
import type { Participant } from "../../types.ts";

export const PM_tax: Participant = {
  role: "project_manager",
  place: { project: "tax" },
};
export const PM_hr: Participant = {
  role: "project_manager",
  place: { project: "hr" },
};
export const PM_ledger: Participant = {
  role: "project_manager",
  place: { project: "ledger-project" },
};
export const PM_todo: Participant = {
  role: "project_manager",
  place: { project: "todo-project" },
};
export const LOPHN: Participant = { role: "lophn" };
