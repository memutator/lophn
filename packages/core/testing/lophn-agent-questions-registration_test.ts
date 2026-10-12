import { runAdmission } from "../storage/ledger/mod.ts";
import { createLedgerTestRegistration as createQuestionsRegistration } from "../lophn-agent/tools/questions/registration_test.ts";
import { defineTxPort, type LedgerTestRegistration } from "./ledger.ts";

// 질문 등록에 platform의 run 판정 port를 더한 시험 등록. agent 자격의 command는 자격에
// 묶인 run이 진행 중일 때만 통과한다(platform/ledger#R11). 판정은 제품 조립
// (packages/core/lophn-agent/register.ts)과 같이 runs 표를 읽는다.
export function createLedgerTestRegistration(): LedgerTestRegistration {
  const base = createQuestionsRegistration();
  return {
    ...base,
    // 저장 선택 표는 platform/settings의 실제 schema가 만든다. leaf 등록이 같은 모양으로
    // 따로 둔 표는 이 조립에서 뺀다.
    schemaSteps: (base.schemaSteps ?? []).filter((step) =>
      step.id !== "questions.test.setting-choices"
    ),
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
