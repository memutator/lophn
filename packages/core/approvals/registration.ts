// approvals의 core 등록. core가 memory route를 가져간다. 할당(assignment) route는 agent 정의 파일을 읽고 써서
// 조립(core/main/daemon/wiring/assignment-file.ts)이 등록한다.
import {
  PERMISSIONS_VIEW_ROUTES,
  toolGateCheck,
  turnRequestDecide,
} from "../../protocol/approvals/mod.ts";

export function createCoreRegistration() {
  return {
    // handler는 wiring이 route 이름으로 붙인다.
    memoryRoutes: [
      turnRequestDecide,
      toolGateCheck,
      ...PERMISSIONS_VIEW_ROUTES,
    ],
  };
}
