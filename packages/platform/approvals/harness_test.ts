// approval 통합 테스트의 ledger 등록(platform#T21, T23).
// 등록 함수는 동기이고 모듈 상태에 의존하지 않는다.
// 설명 글은 값으로 받고 command가 같은 글의 hash와 영구 참조를 만든다. 시험용 참조 등록은
// testing/mod.ts가 낸다(준비 참조가 살아 있는지는 apps/core의 실제 core 시험이 본다).
// core 등록과 같은 모듈에 두면 writer가 둘을 읽어 route가 겹치므로 여기 둔다.

import { defineTxPort, runAdmission } from "../ledger/mod.ts";
import { approvalRunLineage } from "./lineage.ts";
import { probeUseApprovalCommand } from "./probe_test.ts";
import { seedApprovalRequestCommand } from "./seed_test.ts";
import { createApprovalRegistration } from "./registration.ts";
import { registerApprovalTextRef } from "./testing/mod.ts";

// run은 lophn-agent가 채우는 사실이다. 시험은 고정 표로 대신한다: A·B는 같은 session, C는 다른
// session, BARE는 session 없는 run(주기 회차 같은)이다.
export const RUN_A = "run_01h455vb4pex5v6nkc6gd5fdw1";
export const RUN_B = "run_01h455vb4pex5v6nkc6gd5fdw2";
export const RUN_C = "run_01h455vb4pex5v6nkc6gd5fdw3";
export const RUN_BARE = "run_01h455vb4pex5v6nkc6gd5fdw4";
export const SESSION_A = "ses_01h455vb4pex5v6nkc6gd5fdw1";
export const SESSION_B = "ses_01h455vb4pex5v6nkc6gd5fdw2";
const SESSIONS: Readonly<Record<string, string | null>> = {
  [RUN_A]: SESSION_A,
  [RUN_B]: SESSION_A,
  [RUN_C]: SESSION_B,
  [RUN_BARE]: null,
};

export function createLedgerTestRegistration() {
  return {
    ...createApprovalRegistration(),
    ports: [
      defineTxPort(runAdmission, () => ({
        status: (run: string) =>
          run in SESSIONS ? "active" as const : "unknown" as const,
      })),
      defineTxPort(approvalRunLineage, () => ({
        origin: () => null,
        session: (run: string) => SESSIONS[run] ?? null,
      })),
    ],
    registerBlobRef: registerApprovalTextRef,
    testCommands: [seedApprovalRequestCommand, probeUseApprovalCommand],
  };
}
