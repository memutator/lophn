// approval 통합 테스트의 ledger 등록(platform#T21).
// 등록 함수는 동기이고 모듈 상태에 의존하지 않는다.
// 설명 본문의 공백·secret 검사는 command 밖(work)에서 하고, command는 hash를 저장한다.
// core 등록과 같은 모듈에 두면 writer가 둘을 읽어 route가 겹치므로 여기 둔다.

import { seedApprovalRequestCommand } from "./seed_test.ts";
import { createApprovalRegistration } from "./registration.ts";

export function createLedgerTestRegistration() {
  return {
    ...createApprovalRegistration(),
    testCommands: [seedApprovalRequestCommand],
  };
}
