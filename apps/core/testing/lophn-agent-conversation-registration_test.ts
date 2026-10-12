import { runAdmission } from "../../../packages/core/storage/ledger/mod.ts";
import { createLedgerTestRegistration as createConversationRegistration } from "../../../packages/core/lophn-agent/session/registration_test.ts";
import { defineTxPort, type LedgerTestRegistration } from "./ledger.ts";

// 세션·메시지 등록에 platform의 run 판정 port를 더한 시험 등록. agent 자격의 command는
// 자격에 묶인 run이 진행 중일 때만 통과한다(platform/ledger R11). 판정은 runs 표를 읽는다.
export function createLedgerTestRegistration(): LedgerTestRegistration {
  return {
    ...createConversationRegistration(),
    ports: [
      defineTxPort(runAdmission, (tx) => ({
        status: (run: string) => {
          const row = tx.sql.get("select state from runs where id = ?", [run]);
          if (row === undefined) return "unknown" as const;
          return row["state"] === "finished"
            ? "finished" as const
            : "active" as const;
        },
      })),
    ],
  };
}
