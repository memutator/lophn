import { err, fingerprint, ok, type Result } from "../../../base/mod.ts";
import {
  type OptionAction,
  type QuestionActionEvidence,
  questionActionEvidenceSchema,
  questionOptionSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  Sql,
} from "../../../protocol/server/mod.ts";

// 정본 질문에서 사람이 실제로 고른 option. lophn-agent의 question option action read가 채운다.
// platform은 질문 상태를 직접 읽지 않고 이 값만 검증한다.
export type ChosenQuestionOption = {
  option: {
    key: string;
    action: OptionAction | null;
  };
  // 그 option의 고정 action이 되돌릴 수 있는지. 정본 판정이며 제출자가 주장하지 못한다.
  reversible: boolean;
};

export type QuestionOptionSource = (
  question: string,
) => Result<ChosenQuestionOption>;

// 같은 질문 option은 user로 한 번만 기록한다. 기록은 command transaction 안의
// question_evidence 표다. rollback이면 행이 없고, commit이면 재시작 뒤에도 남는다.
export type QuestionEvidenceUse = {
  reserve(question: string, option: string): Result<void>;
};

// machine이 user로 기록할 수 있는 유일한 예외(identity R14). 정본 option의 고정 action과
// 제출 동작 전체·CAS가 같고 되돌릴 수 있을 때만 한 번 통과한다.
export async function verifyQuestionEvidence(
  ctx: AuthenticatedContext,
  evidence: QuestionActionEvidence,
  action: OptionAction,
  source: QuestionOptionSource,
  use: QuestionEvidenceUse,
): Promise<Result<void>> {
  const claimed = questionActionEvidenceSchema.safeParse(evidence);
  const submitted = questionOptionSchema.shape.action.safeParse(action);
  if (ctx.actor !== "machine" || !claimed.success || !submitted.success) {
    return err({
      code: "forbidden",
      message: "질문 근거가 사람 결정을 대신하지 못한다",
    });
  }
  let chosen: Result<ChosenQuestionOption>;
  try {
    chosen = source(claimed.data.question);
  } catch {
    chosen = err({
      code: "unavailable",
      message: "질문 정본을 확인하지 못했다",
    });
  }
  if (!chosen.ok) return chosen;
  const fixed = chosen.value.option.action;
  if (
    chosen.value.option.key !== claimed.data.option || fixed === null ||
    !chosen.value.reversible ||
    await fingerprint(fixed) !== await fingerprint(submitted.data)
  ) {
    return err({
      code: "forbidden",
      message: "제출 동작이 사람이 고른 고정 action과 다르다",
    });
  }
  return use.reserve(claimed.data.question, claimed.data.option);
}

// command transaction의 SQL로 기록한다. primary key가 일회를 강제하고
// 불변 trigger가 기록 뒤 수정을 막는다. 같은 transaction이 rollback되면 행이 없다.
export function questionEvidenceUse(
  sql: Pick<Sql, "run">,
  at: string,
): QuestionEvidenceUse {
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
