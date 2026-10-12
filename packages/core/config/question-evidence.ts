// settings apply의 질문 근거 판별(identity R14를 settings 모양으로).
// lophn 제안은 lophn-agent/questions의 정확한 고정 option action으로만 적용한다
// (platform/settings#R29). 정본 read는 이 command transaction 안에서 ledger
// events 표준본을 SQL로 읽는다(읽는 몫은 이 파일의 eventsOptionSource다).

import { err, ok, type Result } from "../../base/mod.ts";
import type { SettingMutation, SqlRow } from "../../protocol/server/mod.ts";

// 사람이 고른 고정 option action의 뜻(settings 모양). platform은 질문 상태를
// 직접 읽지 않고 이 값만 검증한다.
export type ChosenSettingOption = {
  option: {
    key: string;
    // 고정 action이 내는 set·delete 변경 목록. 자유 답·설명 요청은 null이다.
    changes: readonly SettingMutation[] | null;
  };
};

// 사람이 실제로 고른 option을 읽는다. 기본은 command transaction 안의
// eventsOptionSource다(테스트는 이 자리에 가짜를 둔다).
export type SettingOptionSource = (
  question: string,
) => Result<ChosenSettingOption>;

// 같은 질문 option은 한 번만 적용한다. 기록은 command transaction 안의
// question_evidence 표다. rollback이면 행이 없고, commit이면 재시작 뒤에도 남는다.
export type SettingEvidenceUse = {
  reserve(question: string, option: string): Result<void>;
};

// 제출 입력의 변경 목록. 키·action·값 전체가 고정 action과 같아야 한다(R29).
function mutationKey(mutation: SettingMutation): string {
  return JSON.stringify([mutation.key, mutation.action]);
}

function sameChanges(
  fixed: readonly SettingMutation[],
  submitted: readonly SettingMutation[],
): boolean {
  if (fixed.length !== submitted.length) return false;
  const fixedKeys = fixed.map(mutationKey).sort();
  const submittedKeys = submitted.map(mutationKey).sort();
  for (let index = 0; index < fixedKeys.length; index++) {
    if (fixedKeys[index] !== submittedKeys[index]) return false;
  }
  // 같은 키·action끼리 값 대조. 값은 정본 JSON 문자열이다(contracts 정본).
  const fixedValues = new Map<string, string | undefined>();
  for (const mutation of fixed) {
    fixedValues.set(
      mutationKey(mutation),
      mutation.action === "set" ? JSON.stringify(mutation.value) : undefined,
    );
  }
  for (const mutation of submitted) {
    if (mutation.action !== "set") continue;
    const expected = fixedValues.get(mutationKey(mutation));
    if (expected === undefined || expected !== JSON.stringify(mutation.value)) {
      return false;
    }
  }
  return true;
}

// 고정 action이 settings 변경이면 그 목록이다. 자유 답·설명 요청·다른 owner action은
// changes가 null이다(lophn-agent/questions의 QuestionCreated 질문 선택지 모양).
function fixedChanges(option: unknown): readonly SettingMutation[] | null {
  if (option === null || typeof option !== "object") return null;
  const record = option as { changes?: unknown };
  if (!Array.isArray(record.changes)) return null;
  return record.changes as readonly SettingMutation[];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// ledger events 표준본을 읽는 동기 read. lophn-agent의 question event 모양을
// SQL로만 본다: subject는 질문 묶음이고, QuestionCreated payload의
// questions[].options[]에 key와 changes가 있고, QuestionAnswered payload의
// answers[]가 질문마다 kind=option, option_key를 담는다. platform은
// lophn-agent 코드를 부르지 않는다(lophn-agent/assignments SQL read 관례).
export function eventsOptionSource(sql: {
  all(text: string, params: readonly unknown[]): SqlRow[];
}): SettingOptionSource {
  return (question) => {
    const created = sql.all(
      `select subject, payload from events
       where type = 'QuestionCreated'
         and exists (
           select 1 from json_each(events.payload, '$.questions')
           where json_extract(value, '$.id') = ?
         )
       order by seq`,
      [question],
    );
    if (created.length !== 1) {
      return err({ code: "not_found", message: "질문이 없다" });
    }
    const answered = sql.all(
      "select actor, payload from events where type = 'QuestionAnswered' and subject = ? order by seq",
      [created[0]["subject"]],
    );
    // 사람 답이 없으면 근거가 아니다(설명 요청·추천만은 무변경이다, R29).
    const reply = answered.find((row) =>
      String(row["actor"]) === "user" ||
      String(row["actor"]).startsWith("user:")
    );
    if (reply === undefined) {
      return err({
        code: "forbidden",
        message: "사람이 고른 option이 없다",
      });
    }
    let createdPayload: unknown;
    let answeredPayload: unknown;
    try {
      createdPayload = JSON.parse(String(created[0]["payload"]));
      answeredPayload = JSON.parse(String(reply["payload"]));
    } catch {
      return err({ code: "internal", message: "질문 기록을 읽지 못했다" });
    }
    const questions = recordOf(createdPayload)?.["questions"];
    const answers = recordOf(answeredPayload)?.["answers"];
    if (!Array.isArray(questions) || !Array.isArray(answers)) {
      return err({ code: "internal", message: "질문 기록이 schema와 다르다" });
    }
    const asked = questions.find((candidate) =>
      recordOf(candidate)?.["id"] === question
    );
    const options = recordOf(asked)?.["options"];
    if (!Array.isArray(options)) {
      return err({ code: "internal", message: "질문 기록이 schema와 다르다" });
    }
    // 묶음의 답 가운데 이 질문의 답만 본다.
    const chosen = recordOf(
      recordOf(
        answers.find((entry) => recordOf(entry)?.["question"] === question),
      )?.["answer"],
    );
    if (
      chosen === null || chosen["kind"] !== "option" ||
      typeof chosen["option_key"] !== "string"
    ) {
      return err({
        code: "forbidden",
        message: "사람이 고른 option이 없다",
      });
    }
    const key = chosen["option_key"];
    const fixed = options.find((candidate) =>
      recordOf(candidate)?.["key"] === key
    );
    if (fixed === undefined) {
      return err({
        code: "forbidden",
        message: "제출 변경이 사람이 고른 고정 action과 다르다",
      });
    }
    return ok({
      option: {
        key,
        changes: fixedChanges(fixed),
      },
    });
  };
}

// machine이 user 결정을 대신할 수 있는 유일한 예외(identity R14, settings R29).
// 정본 option의 고정 action이 제출 변경 목록 전체와 같을 때만 한 번 통과한다.
// 답 없음·사람 아닌 답·다른 option의 null changes는 거절이다.
export function verifySettingEvidence(
  ctx: { actor: string },
  changes: readonly SettingMutation[],
  question: string,
  option: string,
  source: SettingOptionSource,
  use: SettingEvidenceUse,
): Result<void> {
  // machine credential만 user 결정을 대신한다.
  if (ctx.actor !== "machine") {
    return err({
      code: "forbidden",
      message: "질문 근거가 사람 결정을 대신하지 못한다",
    });
  }
  let chosen: Result<ChosenSettingOption>;
  try {
    chosen = source(question);
  } catch {
    chosen = err({
      code: "unavailable",
      message: "질문 정본을 확인하지 못했다",
    });
  }
  if (!chosen.ok) return chosen;
  const fixed = chosen.value.option;
  if (
    fixed.key !== option || fixed.changes === null ||
    !sameChanges(fixed.changes, changes)
  ) {
    return err({
      code: "forbidden",
      message: "제출 변경이 사람이 고른 고정 action과 다르다",
    });
  }
  return use.reserve(question, option);
}
