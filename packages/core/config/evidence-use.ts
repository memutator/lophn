import { err, ok } from "../../base/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import type { SettingEvidenceUse } from "./question-evidence.ts";

// command transaction의 SQL로 기록한다. question_evidence primary key가 일회를
// 강제하고 불변 trigger가 기록 뒤 수정을 막는다. 같은 transaction이 rollback되면
// 행이 없다(platform/ledger schema의 표준본 표를 쓴다).
export function settingEvidenceUse(
  sql: Pick<Sql, "run">,
  at: string,
): SettingEvidenceUse {
  return {
    reserve(question, option) {
      const key = `${question}\u0000${option}`;
      try {
        sql.run(
          "insert into question_evidence (evidence_key, question, option, at) values (?, ?, ?, ?)",
          [key, question, option, at],
        );
      } catch {
        return err({
          code: "conflict",
          message: "질문 option은 이미 적용했다",
        });
      }
      return ok(undefined);
    },
  };
}
