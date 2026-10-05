import { createHash } from "node:crypto";
import { canonicalize } from "../../base/mod.ts";
import {
  type CreateQuestionInput,
  type questionList,
  type QuestionOption,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
  type Output,
  type SchemaStep,
  type SettingMutation,
  settingMutationSchema,
  type SqlParams,
  type SqlRow,
} from "../../contracts/platform/mod.ts";

// domain-model lophn-agent/questions의 `questions` 표와 row 변환. 순수 함수와 읽기
// 조회만 있다. 상태 전이 규칙은 commands.ts, 읽기는 reads.ts가 맡는다.

// 질문 하나는 run의 답 기다림 하나다(partial unique, R2). 내용(본문·이유·options·
// 추천·기한·run·session)은 생성 뒤 덮어쓰지 않고(R5), 닫힌 질문은 다시 바뀌지
// 않으며(R9), 삭제는 모두 막아 기록을 남긴다. 본문은 열에 없고 blob hash만 남는다.
// session은 conversation의 sessions 표를 소유한 concern 몫이라 참조 검사 없이 ID만
// 두고 run의 session과 같은지 command가 본다.
export const questionSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.questions.tables",
    sql: `
create table questions (
  id text primary key,
  run text not null references runs (id) on delete restrict,
  session text,
  created_by text not null check (length(created_by) > 0),
  prompt_blob text not null check (length(prompt_blob) = 64),
  reason_blob text not null check (length(reason_blob) = 64),
  options text not null check (json_valid(options)),
  recommendation text check (recommendation is null or json_valid(recommendation)),
  expires_at text,
  status text not null check (status in ('pending', 'answered', 'expired', 'cancelled')),
  answer text check (answer is null or json_valid(answer)),
  binding_hash text check (binding_hash is null or length(binding_hash) = 64),
  closed_reason text check (closed_reason in ('deferred', 'cancelled', 'superseded', 'expired')),
  closed_reason_blob text check (closed_reason_blob is null or length(closed_reason_blob) = 64),
  created_seq integer not null unique check (created_seq >= 1),
  closed_seq integer unique check (closed_seq is null or closed_seq > created_seq),
  check ((status = 'pending') = (closed_seq is null)),
  check ((status = 'answered') = (answer is not null)),
  check (binding_hash is null or status = 'answered'),
  check ((status in ('expired', 'cancelled')) = (closed_reason is not null)),
  check ((status in ('expired', 'cancelled')) = (closed_reason_blob is not null)),
  check (status != 'expired' or closed_reason = 'expired'),
  check (status != 'cancelled' or closed_reason in ('deferred', 'cancelled', 'superseded'))
) strict;
create unique index questions_run_pending on questions (run) where status = 'pending';
create index questions_pending_expiry on questions (status, expires_at) where status = 'pending';
create index questions_run_created on questions (run, created_seq);
create index questions_session_created on questions (session, created_seq);
create trigger questions_content_immutable
before update of id, run, session, created_by, prompt_blob, reason_blob, options,
  recommendation, expires_at, created_seq on questions
begin
  select raise(abort, 'a question is never overwritten');
end;
create trigger questions_closed_terminal
before update on questions
when old.status != 'pending'
begin
  select raise(abort, 'a closed question is never reopened');
end;
create trigger questions_no_delete
before delete on questions
begin
  select raise(abort, 'questions are kept');
end;`,
  },
];

// 질문의 본문·이유·선택지 설명·추천 설명·자유 답·닫은 이유는 blob 참조만 남는다.
// 일반 read로 원문을 내주지 않는다(질문 답의 secret 경계는 screen.ts, R11).
export const questionBodyFields: readonly BlobFieldDefinition[] = [
  "prompt",
  "reason",
  "option_description",
  "recommendation",
  "answer",
  "closed",
].map((field) =>
  defineBlobField({
    owner_kind: "question",
    field,
    retention: { kind: "permanent" },
    general_read: false,
  })
);

// 선택지의 고정 action으로 열 수 있는 owner 동작. 안쪽에서 되돌릴 수 있는 동작만이다.
// 권한 부여·외부 효과·복원 불가 동작은 이 목록에 없으므로 생성에서 막힌다(R12).
// 새 owner 동작은 option action을 등록하는 작업(lophn-agent#T29)이 더한다.
export const QUESTION_ACTIONS: readonly {
  concern: string;
  command: string;
}[] = [{ concern: "platform/settings", command: "apply_settings" }];

export function actionAllowed(
  action: { concern: string; command: string },
): boolean {
  return QUESTION_ACTIONS.some((allowed) =>
    allowed.concern === action.concern && allowed.command === action.command
  );
}

// 닫은 이유 blob은 command 입력에 없는 닫힘(미루기·기한 만료)에 쓰는 고정 문장의
// 지문이다. 무응답은 답이 아니라는 뜻만 담고 사람 글은 담지 않는다.
function reasonHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
export const DEFERRED_REASON_BLOB = reasonHash(
  "lophn-agent/questions: the person deferred the question",
);
export const EXPIRED_REASON_BLOB = reasonHash(
  "lophn-agent/questions: the deadline passed without an answer",
);

// 빈 글의 지문. 자유 답이 이 hash면 빈 답이다(R6).
export const EMPTY_TEXT_BLOB = reasonHash("");

type Lookup = {
  sql: { get: (query: string, params: SqlParams) => SqlRow | undefined };
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export type QuestionRow = {
  id: string;
  run: string;
  session: string | null;
  created_by: string;
  prompt_blob: string;
  reason_blob: string;
  options: string;
  recommendation: string | null;
  expires_at: string | null;
  status: "pending" | "answered" | "expired" | "cancelled";
  answer: string | null;
  binding_hash: string | null;
  closed_reason: string | null;
  closed_reason_blob: string | null;
  created_seq: string;
  closed_seq: string | null;
};

export const QUESTION_COLUMNS = `id, run, session, created_by, prompt_blob,
  reason_blob, options, recommendation, expires_at, status, answer, binding_hash,
  closed_reason, closed_reason_blob, created_seq, closed_seq`;

export function questionRowOf(row: SqlRow): QuestionRow {
  return {
    id: String(row["id"]),
    run: String(row["run"]),
    session: text(row["session"]),
    created_by: String(row["created_by"]),
    prompt_blob: String(row["prompt_blob"]),
    reason_blob: String(row["reason_blob"]),
    options: String(row["options"]),
    recommendation: text(row["recommendation"]),
    expires_at: text(row["expires_at"]),
    status: String(row["status"]) as QuestionRow["status"],
    answer: text(row["answer"]),
    binding_hash: text(row["binding_hash"]),
    closed_reason: text(row["closed_reason"]),
    closed_reason_blob: text(row["closed_reason_blob"]),
    created_seq: String(row["created_seq"]),
    closed_seq: text(row["closed_seq"]),
  };
}

export function loadQuestion(
  lookup: Lookup,
  id: string,
): QuestionRow | undefined {
  const row = lookup.sql.get(
    `select ${QUESTION_COLUMNS} from questions where id = ?`,
    [id],
  );
  return row === undefined ? undefined : questionRowOf(row);
}

export type RunRef = {
  id: string;
  assignment: string;
  session: string | null;
  state: string;
};

export function loadRunRef(lookup: Lookup, id: string): RunRef | undefined {
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

export type QuestionRecord = Output<typeof questionList>["questions"][number];

// 이 질문의 고정 action을 적용한 기록이 있는지. 적용은 action owner의 변경 event가
// 소유하고(option action 적용, lophn-agent#T29) 이 concern에는 적용 상태 표가 없다.
// 적용 기록을 내는 command가 아직 없으므로 답 접수는 적용 완료로 보이지 않는다(R10).
export function appliedOf(_lookup: Lookup, _row: QuestionRow): boolean {
  return false;
}

export function recordOf(row: QuestionRow, applied: boolean): QuestionRecord {
  return {
    id: row.id,
    run: row.run,
    session: row.session,
    prompt_blob: row.prompt_blob,
    reason_blob: row.reason_blob,
    options: JSON.parse(row.options),
    recommendation: row.recommendation === null
      ? null
      : JSON.parse(row.recommendation),
    expires_at: row.expires_at,
    status: row.status,
    answer: row.answer === null ? null : JSON.parse(row.answer),
    closed_reason: row.closed_reason,
    closed_reason_blob: row.closed_reason_blob,
    created_seq: row.created_seq,
    closed_seq: row.closed_seq,
    applied,
  } as QuestionRecord;
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

export function sameContent(
  row: QuestionRow,
  input: CreateQuestionInput,
): boolean {
  return row.run === input.run && row.session === input.session &&
    row.prompt_blob === input.prompt_blob &&
    row.reason_blob === input.reason_blob &&
    row.expires_at === input.expires_at &&
    canonicalize(JSON.parse(row.options)) === canonicalize(input.options) &&
    canonicalize(
        row.recommendation === null ? null : JSON.parse(row.recommendation),
      ) === canonicalize(input.recommendation);
}
