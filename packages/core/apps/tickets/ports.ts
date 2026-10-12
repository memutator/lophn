import { err, ok, type Result } from "../../../base/mod.ts";
import { PROBLEM_STATUSES_PORT, QUESTION_ADOPTIONS_PORT } from "./commands.ts";
import { adoptionOf } from "../../lophn-agent/tools/handoff/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import {
  defineTxPort,
  type TxPortRegistration,
} from "../../storage/ledger/mod.ts";

// ticket 생성·실행 준비 전환이 같은 transaction에서 묻는 두 읽기 port의 제품 구현이다
// (coding-agent/tickets#R3, R4). 질문 채택 답은 lophn-agent의 질문 표(answered 질문이 고른
// 선택지의 adoption, handoff 근거 검사와 같은 판정)를, 문제 상태는 problems 표를 읽는다. 두 표는
// 같은 ledger라 tx.sql로 읽는다. 읽지 못하면(표 없음 등) 닫힌 채로 unavailable이다.
// tickets 등록(tickets.ts)과 따로 둔 이유: 시험이 대역 port를 같은 key로 따로 올린다.

const unavailable = (message: string): Result<never> =>
  err({ code: "unavailable", message });

function questionAdoptions(tx: Tx) {
  return {
    adoptions(questions: readonly string[]) {
      try {
        const found = new Map<string, { document: string; version: string }>();
        for (const question of questions) {
          const adoption = adoptionOf(tx, question);
          if (adoption !== undefined) {
            found.set(question, {
              document: adoption.document,
              version: adoption.version,
            });
          }
        }
        return ok(found);
      } catch {
        return unavailable("question adoptions could not be read");
      }
    },
  };
}

function problemStatuses(tx: Tx) {
  return {
    problems(ids: readonly string[]) {
      try {
        const statuses: { id: string; status: string }[] = [];
        for (const id of ids) {
          const row = tx.sql.get("select status from problems where id = ?", [
            id,
          ]);
          if (row === undefined) {
            return err({
              code: "not_found",
              message: "problem does not exist",
            });
          }
          statuses.push({ id, status: String(row["status"]) });
        }
        return ok(statuses);
      } catch {
        return unavailable("problem statuses could not be read");
      }
    },
  };
}

const ports: TxPortRegistration[] = [
  defineTxPort(QUESTION_ADOPTIONS_PORT, questionAdoptions),
  defineTxPort(PROBLEM_STATUSES_PORT, problemStatuses),
];

export function createCoreRegistration() {
  return { ports };
}
