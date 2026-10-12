import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import {
  type CreateQuestionGroupInput,
  type OptionAction,
  optionActionSchema,
  QUESTION_GROUP_MAX_QUESTIONS,
  type questionList,
  type QuestionOption,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  Output,
  SqlParams,
  SqlRow,
} from "../../../../protocol/server/mod.ts";
import {
  type SettingMutation,
  settingMutationSchema,
} from "../../../../protocol/config/mod.ts";
import type { GroupState, GroupStatus } from "./group.ts";
import type { StoredGroupContent } from "./text-blobs.ts";

// domain-model lophn-agent/questions의 `question_groups`·`questions` 표 row 변환과 읽기 조회.
// 순수 함수와 읽기 조회만 있다. 상태 전이 규칙은 commands.ts, 읽기는 reads.ts가 맡는다.

type Lookup = {
  sql: { get: (query: string, params: SqlParams) => SqlRow | undefined };
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export type GroupRow = {
  id: string;
  run: string;
  session: string | null;
  created_by: string;
  expires_at: string | null;
  status: GroupStatus;
  binding_hash: string | null;
  closed_reason: string | null;
  closed_reason_blob: string | null;
  created_seq: string;
  closed_seq: string | null;
};

export type QuestionRow = {
  id: string;
  group: string;
  position: number;
  prompt_blob: string;
  reason_blob: string;
  options: string;
  recommendation: string | null;
  answer: string | null;
};

// 묶음과 그 질문(position 순서). 묶음의 내용은 질문을 값으로 품지 않고 `questions` 행을
// `group`으로 모은 것이다.
export type QuestionGroup = GroupRow & { questions: QuestionRow[] };

export const GROUP_COLUMNS = `id, run, session, created_by, expires_at, status,
  binding_hash, closed_reason, closed_reason_blob, created_seq, closed_seq`;

export const QUESTION_COLUMNS =
  `id, "group", position, prompt_blob, reason_blob, options, recommendation, answer`;

export function groupRowOf(row: SqlRow): GroupRow {
  return {
    id: String(row["id"]),
    run: String(row["run"]),
    session: text(row["session"]),
    created_by: String(row["created_by"]),
    expires_at: text(row["expires_at"]),
    status: String(row["status"]) as GroupStatus,
    binding_hash: text(row["binding_hash"]),
    closed_reason: text(row["closed_reason"]),
    closed_reason_blob: text(row["closed_reason_blob"]),
    created_seq: String(row["created_seq"]),
    closed_seq: text(row["closed_seq"]),
  };
}

export function questionRowOf(row: SqlRow): QuestionRow {
  return {
    id: String(row["id"]),
    group: String(row["group"]),
    position: Number(row["position"]),
    prompt_blob: String(row["prompt_blob"]),
    reason_blob: String(row["reason_blob"]),
    options: String(row["options"]),
    recommendation: text(row["recommendation"]),
    answer: text(row["answer"]),
  };
}

// 묶음의 질문은 많아야 4개이고 position이 1부터 연속이다. ReadQuestionText의 snapshot은
// `get`만 주므로 위치 하나씩 읽는다.
export function loadQuestions(lookup: Lookup, group: string): QuestionRow[] {
  const questions: QuestionRow[] = [];
  for (let position = 1; position <= QUESTION_GROUP_MAX_QUESTIONS; position++) {
    const row = lookup.sql.get(
      `select ${QUESTION_COLUMNS} from questions where "group" = ? and position = ?`,
      [group, position],
    );
    if (row === undefined) break;
    questions.push(questionRowOf(row));
  }
  return questions;
}

export function loadGroup(
  lookup: Lookup,
  id: string,
): QuestionGroup | undefined {
  const row = lookup.sql.get(
    `select ${GROUP_COLUMNS} from question_groups where id = ?`,
    [id],
  );
  return row === undefined
    ? undefined
    : { ...groupRowOf(row), questions: loadQuestions(lookup, id) };
}

// 질문 ID로 그 묶음을 찾는다. 질문 ID를 다른 concern이 가리키므로(선택지 적용 근거·채택)
// 이 길이 필요하다.
export function loadGroupOfQuestion(
  lookup: Lookup,
  question: string,
): { group: QuestionGroup; question: QuestionRow } | undefined {
  const row = lookup.sql.get(
    `select "group" from questions where id = ?`,
    [question],
  );
  if (row === undefined) return undefined;
  const group = loadGroup(lookup, String(row["group"]));
  const found = group?.questions.find((one) => one.id === question);
  return group === undefined || found === undefined
    ? undefined
    : { group, question: found };
}

export type RunRef = {
  id: string;
  assignment: string;
  session: string | null;
  state: string;
};

export function loadRunRef(
  lookup: Lookup,
  id: string,
): RunRef | undefined {
  const row = lookup.sql.get(
    "select id, assignment, session, state from runs where id = ?",
    [id],
  );
  return row === undefined ? undefined : {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    session: text(row["session"]),
    state: String(row["state"]),
  };
}

export function assignmentState(
  lookup: Lookup,
  id: string,
): string | undefined {
  const row = lookup.sql.get("select state from assignments where id = ?", [
    id,
  ]);
  return row === undefined ? undefined : String(row["state"]);
}

type StoredOption = {
  key: string;
  action: unknown;
  adoption:
    | { document: string; version: string; section: string | null }
    | null;
};

export function optionsOf(question: QuestionRow): StoredOption[] {
  return JSON.parse(question.options) as StoredOption[];
}

type StoredAnswer = { kind: string; option_key: string | null };

function answerOf(question: QuestionRow): StoredAnswer | null {
  return question.answer === null
    ? null
    : JSON.parse(question.answer) as StoredAnswer;
}

// group.ts의 순수 검사가 읽는 모양. 같은 검사를 두 벌 두지 않는다.
export function groupStateOf(group: QuestionGroup): GroupState {
  return {
    status: group.status,
    created_seq: group.created_seq,
    expires_at: group.expires_at,
    questions: group.questions.map((question) => ({
      id: question.id,
      options: optionsOf(question).map((option) => ({
        key: option.key,
        action: option.action,
      })),
      recommendation: question.recommendation === null
        ? null
        : JSON.parse(question.recommendation) as { option_key: string | null },
    })),
  };
}

export type QuestionGroupRecord = Output<typeof questionList>["groups"][number];

// 같은 질문 option을 사람 결정으로 적용한 기록의 key. 적용 기록은 platform/ledger의
// question_evidence(identity R14의 일회 표)이고 이 concern에는 적용 상태 표가 없다.
export function evidenceKey(question: string, option: string): string {
  return `${question}\u0000${option}`;
}

// 사람이 고른 선택지의 고정 action을 실제로 적용했는지. 답 접수와 적용 완료는 다르다(R10).
// 자유 답·답 없음·종료한 묶음은 적용한 일이 없다. 표가 없는 harness는 적용 기록도 없다.
export function appliedOf(
  lookup: Lookup,
  group: QuestionGroup,
  question: QuestionRow,
): boolean {
  if (group.status !== "answered") return false;
  const answer = answerOf(question);
  if (
    answer === null || answer.kind !== "option" || answer.option_key === null
  ) {
    return false;
  }
  try {
    return lookup.sql.get(
      "select 1 as found from question_evidence where evidence_key = ?",
      [evidenceKey(question.id, answer.option_key)],
    ) !== undefined;
  } catch {
    return false;
  }
}

// 사람이 고른 선택지와 그 고정 action. 고정 action이 있는 선택지를 가진 질문은 질문 하나짜리
// 묶음이라(R13) 묶음에서 많아야 하나다. 답이 없거나 선택지가 아니거나 action이 없으면 없다.
export function chosenActionOf(
  group: QuestionGroup,
): { question: QuestionRow; key: string; action: OptionAction } | undefined {
  if (group.status !== "answered") return undefined;
  for (const question of group.questions) {
    const answer = answerOf(question);
    if (answer === null || answer.kind !== "option") continue;
    const option = optionsOf(question).find((candidate) =>
      candidate.key === answer.option_key
    );
    if (option === undefined || option.action === null) continue;
    const parsed = optionActionSchema.safeParse(option.action);
    if (parsed.success && answer.option_key !== null) {
      return { question, key: answer.option_key, action: parsed.data };
    }
  }
  return undefined;
}

// 채택은 answered 묶음에 속한 질문이 고른 선택지의 adoption으로만 판정한다(R16). 새 version은
// 자동 채택하지 않는다: 같은 질문의 답은 그때 고정한 document·version만 가리킨다. 채택을 근거로
// 쓰는 ticket·handoff는 이 값의 document·version과 질문 ID를 함께 보관한다.
export type Adoption = {
  question: string;
  document: string;
  version: string;
  section: string | null;
};

export function adoptionsOf(group: QuestionGroup): Adoption[] {
  if (group.status !== "answered") return [];
  const adopted: Adoption[] = [];
  for (const question of group.questions) {
    const answer = answerOf(question);
    if (answer === null || answer.kind !== "option") continue;
    const chosen = optionsOf(question).find((option) =>
      option.key === answer.option_key
    );
    if (chosen === undefined || chosen.adoption === null) continue;
    adopted.push({
      question: question.id,
      document: chosen.adoption.document,
      version: chosen.adoption.version,
      section: chosen.adoption.section,
    });
  }
  return adopted;
}

export function recordOf(
  group: QuestionGroup,
  applied: (question: QuestionRow) => boolean,
): QuestionGroupRecord {
  return {
    id: group.id,
    run: group.run,
    session: group.session,
    expires_at: group.expires_at,
    status: group.status,
    closed_reason: group.closed_reason,
    closed_reason_blob: group.closed_reason_blob,
    created_seq: group.created_seq,
    closed_seq: group.closed_seq,
    questions: group.questions.map((question) => ({
      id: question.id,
      group: question.group,
      position: question.position,
      prompt_blob: question.prompt_blob,
      reason_blob: question.reason_blob,
      options: JSON.parse(question.options),
      recommendation: question.recommendation === null
        ? null
        : JSON.parse(question.recommendation),
      answer: question.answer === null ? null : JSON.parse(question.answer),
      applied: applied(question),
    })),
  } as QuestionGroupRecord;
}

// 선택지의 고정 action이 platform/settings 변경이면 그 변경 목록을 낸다.
// platform/settings#R29가 QuestionCreated에서 이 목록을 읽어 machine ApplySettings를
// 대조한다. 다른 선택지·action 없음은 null이다. 모양이 틀리면 undefined다.
export function settingChangesOf(
  option: QuestionOption,
): SettingMutation[] | null | undefined {
  const action = option.action;
  if (action === null) return null;
  if (action.concern !== "platform/settings") return null;
  if (action.input.kind !== "inline") return undefined;
  const changes = (action.input.value as { changes?: unknown })["changes"];
  if (!Array.isArray(changes) || changes.length === 0) return undefined;
  const parsed: SettingMutation[] = [];
  const keys = new Set<string>();
  for (const change of changes) {
    const one = settingMutationSchema.safeParse(change);
    if (!one.success || keys.has(one.data.key)) return undefined;
    keys.add(one.data.key);
    parsed.push(one.data);
  }
  return parsed;
}

// 선택지의 근거·채택 참조는 그 document의 실제 불변 version이어야 한다(R16). 판 표(documents/
// versions)는 소유 concern의 것이라 읽기만 한다. 판 표가 없는 등록(문서 concern 없는 harness)은
// 확인할 판이 없으므로 통과한다.
export function fixedVersionsExist(
  lookup: Lookup,
  option: QuestionOption,
): Result<void> {
  const references = [
    ...option.evidence,
    ...(option.adoption === null ? [] : [option.adoption]),
  ];
  for (const reference of references) {
    let found: SqlRow | undefined;
    try {
      found = lookup.sql.get(
        "select 1 as found from versions where id = ? and document = ?",
        [reference.version, reference.document],
      );
    } catch {
      return ok(undefined);
    }
    if (found === undefined) {
      return err({
        code: "invalid_input",
        message: "a fixed version reference does not name a stored version",
      });
    }
  }
  return ok(undefined);
}

// 이미 저장된 묶음이 같은 요청의 내용인지(재전송 판정). 질문 순서와 값이 모두 같아야 한다.
export function sameContent(
  group: QuestionGroup,
  input: CreateQuestionGroupInput,
  stored: StoredGroupContent,
): boolean {
  if (
    group.run !== input.run || group.session !== input.session ||
    group.expires_at !== input.expires_at ||
    group.questions.length !== stored.questions.length
  ) return false;
  return group.questions.every((row, index) => {
    const next = stored.questions[index]!;
    return row.id === next.id && row.prompt_blob === next.prompt_blob &&
      row.reason_blob === next.reason_blob &&
      canonicalize(JSON.parse(row.options)) === canonicalize(next.options) &&
      canonicalize(
          row.recommendation === null ? null : JSON.parse(row.recommendation),
        ) === canonicalize(next.recommendation);
  });
}
