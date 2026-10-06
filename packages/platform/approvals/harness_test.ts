// approval 통합 테스트의 ledger 등록(platform#T21, T23).
// 등록 함수는 동기이고 모듈 상태에 의존하지 않는다.
// 설명 글은 값으로 받고 command가 같은 글의 hash와 영구 참조를 만든다. 시험용 참조 등록은
// testing/mod.ts가 낸다(준비 참조가 살아 있는지는 apps/core의 실제 core 시험이 본다).
// core 등록과 같은 모듈에 두면 writer가 둘을 읽어 route가 겹치므로 여기 둔다.

import { probeUseApprovalCommand } from "./probe_test.ts";
import { seedApprovalRequestCommand } from "./seed_test.ts";
import { createApprovalRegistration } from "./registration.ts";
import { registerApprovalTextRef } from "./testing/mod.ts";

export function createLedgerTestRegistration() {
  return {
    ...createApprovalRegistration(),
    registerBlobRef: registerApprovalTextRef,
    testCommands: [seedApprovalRequestCommand, probeUseApprovalCommand],
  };
}
