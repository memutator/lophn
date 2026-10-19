// operator 시나리오가 같이 쓰는 참가자와 world. 이름은 call 도구의 `to`가 맞추는 이름과 같다.
// 이 file은 operator 폴더 시나리오의 hash에 든다.
import type { Participant } from "../../types.ts";

export const OP_월말정리: Participant = {
  role: "operator",
  name: "월말정리",
  place: { app: "가계부" },
};
export const OP_세무정리: Participant = {
  role: "operator",
  name: "세무정리",
  place: { project: "tax" },
};
export const AE_가계부: Participant = {
  role: "app_engineer",
  place: { app: "가계부" },
};
export const PM_tax: Participant = {
  role: "project_manager",
  place: { project: "tax" },
};
export const LOPHN: Participant = { role: "lophn" };

// operators-home@2는 앞의 셋을 needs로 갖지만, runner는 world에 적힌 재료마다 hash를 확인하고 등록하므로 넷을 다 적는다.
export const OPERATOR_WORLD = [
  "apps-home@1",
  "projects-home@1",
  "tax-kinds@1",
  "operators-home@2",
];

// O4와 T19-op가 같은 말을 쓴다.
export const O4_REQUEST =
  "합계 app-api가 늘 0을 돌려줘. 이번 달 합계를 구해 줘";
