import {
  QUESTION_BLOB_FIELDS,
  QUESTION_BLOB_OWNER_KIND,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { SchemaStep } from "../../../../protocol/server/mod.ts";
import {
  type BlobFieldDefinition,
  defineBlobField,
} from "../../../../protocol/storage/mod.ts";

// domain-model lophn-agent/questions의 `question_groups`·`questions` 표. 묶음은 상태·기한·
// 종료를 갖고 질문은 묶음 안의 값(본문 hash·선택지·추천·답)을 갖는다.
//
// 같은 run에 답을 기다리는 묶음은 하나다(partial unique). 내용(run·session·기한과 묶음 안
// 질문의 본문·이유·선택지·추천)은 생성 뒤 덮어쓰지 않고, 닫힌 묶음은 다시 바뀌지 않으며,
// 지움은 진행 중인 run의 묶음을 막고, 끝난 run의 묶음은 DeleteSession이 지운다(erase.ts). 질문의 답은 묶음이 answered가 될 때 한 번에 채운다: 일부
// 질문만 답한 저장은 없다. 본문은 열에 없고 blob hash만 남는다. session은 conversation의
// sessions 표를 소유한 concern 몫이라 참조 검사 없이 ID만 두고 run의 session과 같은지 command가
// 본다.
export const questionSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.questions.tables",
    sql: `
create table question_groups (
  id text primary key,
  run text not null references runs (id) on delete restrict,
  session text,
  created_by text not null check (length(created_by) > 0),
  expires_at text,
  status text not null check (status in ('pending', 'answered', 'expired', 'cancelled')),
  binding_hash text check (binding_hash is null or length(binding_hash) = 64),
  closed_reason text check (closed_reason in ('deferred', 'cancelled', 'superseded', 'expired')),
  closed_reason_blob text check (closed_reason_blob is null or length(closed_reason_blob) = 64),
  created_seq integer not null unique check (created_seq >= 1),
  closed_seq integer unique check (closed_seq is null or closed_seq > created_seq),
  check ((status = 'pending') = (closed_seq is null)),
  check (binding_hash is null or status = 'answered'),
  check ((status in ('expired', 'cancelled')) = (closed_reason is not null)),
  check (status != 'expired' or closed_reason = 'expired'),
  check (status != 'cancelled' or closed_reason in ('deferred', 'cancelled', 'superseded')),
  check ((closed_reason in ('cancelled', 'superseded')) = (closed_reason_blob is not null)),
  check (status in ('expired', 'cancelled') or closed_reason_blob is null)
) strict;
create unique index question_groups_run_pending on question_groups (run) where status = 'pending';
create index question_groups_pending_expiry on question_groups (status, expires_at) where status = 'pending';
create index question_groups_run_created on question_groups (run, created_seq);
create index question_groups_session_created on question_groups (session, created_seq);
create trigger question_groups_content_immutable
before update of id, run, session, created_by, expires_at, created_seq on question_groups
begin
  select raise(abort, 'a question group is never overwritten');
end;
create trigger question_groups_closed_terminal
before update on question_groups
when old.status != 'pending'
begin
  select raise(abort, 'a closed question group is never reopened');
end;
create trigger question_groups_delete_needs_finished_run
before delete on question_groups
when exists (select 1 from runs where id = old.run and state != 'finished')
begin
  select raise(abort, 'a group of an unfinished run is kept');
end;
create table questions (
  id text primary key,
  "group" text not null references question_groups (id) on delete restrict,
  position integer not null check (position between 1 and 4),
  prompt_blob text not null check (length(prompt_blob) = 64),
  reason_blob text not null check (length(reason_blob) = 64),
  options text not null check (json_valid(options)),
  recommendation text check (recommendation is null or json_valid(recommendation)),
  answer text check (answer is null or json_valid(answer)),
  unique ("group", position)
) strict;
create trigger questions_content_immutable
before update of id, "group", position, prompt_blob, reason_blob, options, recommendation on questions
begin
  select raise(abort, 'a question is never overwritten');
end;
create trigger questions_answer_once
before update of answer on questions
when old.answer is not null
begin
  select raise(abort, 'an answer is never rewritten');
end;
create trigger questions_answer_while_pending
before update of answer on questions
when (select status from question_groups where id = old."group") != 'answered'
begin
  select raise(abort, 'only an answered group holds answers');
end;
create trigger questions_delete_needs_finished_run
before delete on questions
when exists (
  select 1 from question_groups g join runs r on r.id = g.run
  where g.id = old."group" and r.state != 'finished'
)
begin
  select raise(abort, 'a question of an unfinished run is kept');
end;`,
  },
];

// 질문의 본문·이유·선택지 설명·추천 설명·자유 답·닫은 이유는 blob 참조만 남는다. 참조의 owner는
// 묶음이다(owner_key는 묶음 ID). 일반 blob.read로는 열지 않는다: 읽는 쪽 범위(사람, 그
// assignment의 agent, machine, 글 일부는 coding_agent)는 ReadQuestionText가 판정한다(질문 답의
// secret 경계는 screen.ts).
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
