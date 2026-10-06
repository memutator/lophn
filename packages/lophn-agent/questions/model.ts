import { createHash } from "node:crypto";
import { canonicalize } from "../../base/mod.ts";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type CreateQuestionInput,
  QUESTION_BLOB_FIELDS,
  QUESTION_BLOB_OWNER_KIND,
  QUESTION_TEXT_PURPOSE,
  type questionList,
  type QuestionOption,
  questionTextBytes,
} from "../../contracts/lophn-agent/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
  type Output,
  type RequestContext,
  type SchemaStep,
  type SettingMutation,
  settingMutationSchema,
  type SqlParams,
  type SqlRow,
  type Tx,
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
  check (status != 'expired' or closed_reason = 'expired'),
  check (status != 'cancelled' or closed_reason in ('deferred', 'cancelled', 'superseded')),
  check ((closed_reason in ('cancelled', 'superseded')) = (closed_reason_blob is not null)),
  check (status in ('expired', 'cancelled') or closed_reason_blob is null)
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
// 일반 blob.read로는 열지 않는다: 읽는 쪽 범위(사람, 그 assignment의 agent, machine,
// 글 일부는 coding_agent)는 ReadQuestionText가 판정한다(질문 답의 secret 경계는
// screen.ts, R11).
export const questionBodyFields: readonly BlobFieldDefinition[] = Object.values(
  QUESTION_BLOB_FIELDS,
).map((field) =>
  defineBlobField({
    owner_kind: QUESTION_BLOB_OWNER_KIND,
    field,
    retention: { kind: "permanent" },
    general_read: false,
  })
);

// 글 값의 blob 증거. core가 같은 UTF-8 bytes로 준비했으므로 같은 글은 항상 같은 hash다.
// 재전송의 지문도 값으로 정해져 준비 참조의 수명과 상관없다.
export type TextBlob = {
  hash: string;
  evidence: {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  };
};

export function textBlob(ctx: RequestContext, text: string): TextBlob {
  const bytes = questionTextBytes(text);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return {
    hash,
    evidence: {
      preparation: hash,
      principal: ctx.principal,
      purpose: QUESTION_TEXT_PURPOSE,
      hash,
      size_bytes: bytes.length,
    },
  };
}

// 같은 (질문, field, hash)는 한 번만 등록한다. 서로 다른 선택지의 같은 설명은 한 참조다.
export function registerTextBlobs(
  tx: Tx,
  question: string,
  seq: string,
  blobs: readonly { field: string; blob: TextBlob }[],
): Result<void> {
  const seen = new Set<string>();
  for (const { field, blob } of blobs) {
    const key = `${field}:${blob.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const registered = tx.registerBlobRef({
      owner_kind: QUESTION_BLOB_OWNER_KIND,
      owner_key: question,
      field,
      registered_seq: seq,
      source: { kind: "prepared", blob: blob.evidence },
    });
    if (!registered.ok) return err(registered.error);
  }
  return ok(undefined);
}

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

// 같은 질문 option을 사람 결정으로 적용한 기록의 key. 적용 기록은 platform/ledger의
// question_evidence(identity R14의 일회 표)이고 이 concern에는 적용 상태 표가 없다.
export function evidenceKey(question: string, option: string): string {
  return `${question}\u0000${option}`;
}

// 사람이 고른 선택지의 고정 action을 실제로 적용했는지. 답 접수와 적용 완료는 다르다(R10).
// 자유 답·답 없음·종료한 질문은 적용한 일이 없다. 표가 없는 harness는 적용 기록도 없다.
export function appliedOf(lookup: Lookup, row: QuestionRow): boolean {
  if (row.status !== "answered" || row.answer === null) return false;
  const answer = JSON.parse(row.answer) as {
    kind: string;
    option_key: string | null;
  };
  if (answer.kind !== "option" || answer.option_key === null) return false;
  try {
    return lookup.sql.get(
      "select 1 as found from question_evidence where evidence_key = ?",
      [evidenceKey(row.id, answer.option_key)],
    ) !== undefined;
  } catch {
    return false;
  }
}

// 채택은 answered 질문이 고른 선택지의 adoption으로만 판정한다(R16). 새 version은 자동
// 채택하지 않는다: 같은 질문의 답은 그때 고정한 document·version만 가리킨다. 채택을 근거로
// 쓰는 ticket·handoff는 이 값의 document·version과 질문 ID를 함께 보관한다.
export type Adoption = {
  question: string;
  document: string;
  version: string;
  section: string | null;
};

export function adoptionOf(row: QuestionRow): Adoption | null {
  if (row.status !== "answered" || row.answer === null) return null;
  const answer = JSON.parse(row.answer) as {
    kind: string;
    option_key: string | null;
  };
  if (answer.kind !== "option") return null;
  const options = JSON.parse(row.options) as {
    key: string;
    adoption:
      | { document: string; version: string; section: string | null }
      | null;
  }[];
  const chosen = options.find((option) => option.key === answer.option_key);
  if (chosen === undefined || chosen.adoption === null) return null;
  return {
    question: row.id,
    document: chosen.adoption.document,
    version: chosen.adoption.version,
    section: chosen.adoption.section,
  };
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

// 저장되는 모양의 질문 내용. 요청의 글은 blob hash로 바뀌어 있다.
export type StoredQuestionContent = {
  prompt_blob: string;
  reason_blob: string;
  options: unknown[];
  recommendation: unknown;
  blobs: { field: string; blob: TextBlob }[];
};

export function storedContent(
  ctx: RequestContext,
  input: CreateQuestionInput,
): StoredQuestionContent {
  const prompt = textBlob(ctx, input.prompt);
  const reason = textBlob(ctx, input.reason);
  const blobs: StoredQuestionContent["blobs"] = [
    { field: QUESTION_BLOB_FIELDS.prompt, blob: prompt },
    { field: QUESTION_BLOB_FIELDS.reason, blob: reason },
  ];
  const options = input.options.map((option) => {
    const { description, ...rest } = option;
    const blob = textBlob(ctx, description);
    blobs.push({ field: QUESTION_BLOB_FIELDS.optionDescription, blob });
    return { ...rest, description_blob: blob.hash };
  });
  let recommendation: unknown = null;
  if (input.recommendation !== null) {
    const blob = textBlob(ctx, input.recommendation.explanation);
    blobs.push({ field: QUESTION_BLOB_FIELDS.recommendation, blob });
    recommendation = {
      option_key: input.recommendation.option_key,
      explanation_blob: blob.hash,
    };
  }
  return {
    prompt_blob: prompt.hash,
    reason_blob: reason.hash,
    options,
    recommendation,
    blobs,
  };
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

export function sameContent(
  row: QuestionRow,
  input: CreateQuestionInput,
  stored: StoredQuestionContent,
): boolean {
  return row.run === input.run && row.session === input.session &&
    row.prompt_blob === stored.prompt_blob &&
    row.reason_blob === stored.reason_blob &&
    row.expires_at === input.expires_at &&
    canonicalize(JSON.parse(row.options)) === canonicalize(stored.options) &&
    canonicalize(
        row.recommendation === null ? null : JSON.parse(row.recommendation),
      ) === canonicalize(stored.recommendation);
}
