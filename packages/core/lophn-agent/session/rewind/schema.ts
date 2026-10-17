import type { SchemaStep } from "../../../../protocol/server/mod.ts";

// session rewind의 ledger 표. messages·sessions·tool_calls·events 뒤에 만든다.
//
// checkpoints는 turn을 시작한 입력 메시지 하나다(메시지를 접수하는 같은 transaction이 만든다).
// files_restorable은 한 번 낮아지면 되돌아가지 않고 이유도 처음 것을 지킨다.
// rewind_files는 file tool이 쓰기 직전에 tool call마다 남기는 기록이다. root는 file tool에 열린
// 허용 폴더(절대 경로)이고 path는 그 안의 상대 경로다. seq는 기록한 차례(표 안 순번)다: 같은 경로의 기록
// 순서를 이 값이 정한다. 기록은 한도 정리·session 삭제가 지우는 것 말고는 바꾸지 않고, 바뀌는 것은
// reverted_by뿐이다.
// reverts는 rewind 한 번의 시도다. boundary_seq는 고른 메시지의 순번이고 result_seq는 결과를 확정한 때 session의
// 마지막 메시지 순번이다(둘 다 messages.created_seq 쪽 순번). 숨긴 구간은 이 둘 사이다. 최종 결과(outcome·
// result_seq)는 applying에서 한 번만 바뀐다.
// revert_items는 결과 항목이다. 끝난 항목은 고치지 않는다. 예외는 설치가 건너뛴 파일을
// skipped(edited_outside)로 고치는 AmendRevertInstall 하나다.
// rewind_apps는 사람이 고른 앱마다 앱 rewind를 요청한 결과다. 접수(accepted)가 끝나면 한 번 고친다.
// blocked revert는 revert_items 행이 없다. reverts.checkpoint는 turn을 시작한 입력 메시지 id를 가리킨다.
export const revertSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.revert.tables",
    sql: `
create table checkpoints (
  message text primary key references messages (id) on delete restrict,
  session text not null references sessions (id) on delete restrict,
  files_restorable integer not null default 1 check (files_restorable in (0, 1)),
  files_reason text check (files_reason is null or files_reason in ('limit_total', 'limit_file', 'limit_count', 'record_failed')),
  check ((files_restorable = 1) = (files_reason is null))
) strict;
create index checkpoints_session on checkpoints (session, message);
create index checkpoints_session_restorable on checkpoints (session, files_restorable);
create trigger checkpoints_identity_immutable
before update of message, session on checkpoints
begin
  select raise(abort, 'a checkpoint is never moved');
end;
create trigger checkpoints_files_lowered_once
before update of files_restorable, files_reason on checkpoints
when old.files_restorable = 0
  and (new.files_restorable != 0 or new.files_reason is not old.files_reason)
begin
  select raise(abort, 'a checkpoint whose files cannot be restored stays so');
end;
create table reverts (
  id text primary key,
  session text not null references sessions (id) on delete restrict,
  choice text not null check (choice in ('restore_all', 'messages_only', 'summarize')),
  checkpoint text not null references messages (id) on delete restrict,
  boundary_seq integer not null check (boundary_seq >= 1),
  summary_call text,
  outcome text not null check (outcome in ('applying', 'applied', 'partial', 'uncertain', 'blocked')),
  preview_hash text not null check (length(preview_hash) = 64),
  result_seq integer check (result_seq is null or result_seq >= boundary_seq),
  check ((choice = 'summarize') = (summary_call is not null)),
  check ((outcome = 'applying') = (result_seq is null))
) strict;
create unique index reverts_session_applying on reverts (session) where outcome = 'applying';
create index reverts_session_result on reverts (session, result_seq);
create trigger reverts_identity_immutable
before update of id, session, choice, checkpoint, boundary_seq, summary_call, preview_hash on reverts
begin
  select raise(abort, 'a revert attempt is never rewritten');
end;
create trigger reverts_result_final
before update of outcome, result_seq on reverts
when old.outcome != 'applying'
begin
  select raise(abort, 'a revert result is final');
end;
create table rewind_files (
  tool_call text not null references tool_calls (id) on delete restrict,
  root text not null check (length(root) > 0),
  path text not null check (length(path) > 0),
  checkpoint text not null references checkpoints (message) on delete restrict,
  seq integer not null check (seq >= 0),
  before_exists integer not null check (before_exists in (0, 1)),
  before_sha256 text check (before_sha256 is null or length(before_sha256) = 64),
  before_blob text check (before_blob is null or length(before_blob) = 64),
  before_size integer check (before_size is null or before_size >= 0),
  after_exists integer not null check (after_exists in (0, 1)),
  after_sha256 text check (after_sha256 is null or length(after_sha256) = 64),
  moved_from text check (moved_from is null or length(moved_from) > 0),
  reverted_by text references reverts (id) on delete restrict,
  primary key (tool_call, path),
  check ((before_exists = 1) = (before_sha256 is not null)),
  check ((before_exists = 1) = (before_size is not null)),
  check (before_blob is null or before_blob = before_sha256),
  check ((after_exists = 1) = (after_sha256 is not null))
) strict;
create index rewind_files_checkpoint_path on rewind_files (checkpoint, path, seq);
create index rewind_files_path_seq on rewind_files (path, seq);
create index rewind_files_reverted_by on rewind_files (reverted_by);
create trigger rewind_files_immutable
before update of tool_call, root, path, checkpoint, seq, before_exists, before_sha256, before_blob, before_size, after_exists, after_sha256, moved_from on rewind_files
begin
  select raise(abort, 'a rewind record is never rewritten');
end;
create table revert_items (
  revert text not null references reverts (id) on delete restrict,
  ordinal integer not null check (ordinal >= 0),
  class text not null check (class in ('file', 'fact')),
  target text not null check (length(target) > 0),
  source text not null check (json_valid(source)),
  plan text not null check (plan in ('restore', 'skip', 'remain')),
  result text not null check (result in ('restored', 'skipped', 'remained', 'failure', 'uncertain', 'unchanged')),
  reason text check (reason is null or reason in ('edited_outside', 'chain_broken', 'no_pre_image', 'link_path', 'rename_blocked', 'created_edited', 'external_effect', 'already_reverted', 'later_edit')),
  restored_sha256 text check (restored_sha256 is null or length(restored_sha256) = 64),
  primary key (revert, ordinal),
  check (result != 'restored' or reason is null),
  check ((result = 'remained') = (plan = 'remain'))
) strict;
create index revert_items_class_target on revert_items (class, target);
create trigger revert_items_identity_immutable
before update of revert, ordinal, class, target, source, plan on revert_items
begin
  select raise(abort, 'a revert item is never rewritten');
end;
create trigger revert_items_settled
before update on revert_items
when (old.result != 'unchanged' or old.reason is not null)
  and not (
    old.class = 'file' and old.plan = 'restore' and old.result = 'restored'
    and new.result = 'skipped' and new.reason = 'edited_outside'
  )
begin
  select raise(abort, 'a settled revert item is final');
end;
create table rewind_apps (
  revert text not null references reverts (id) on delete restrict,
  app text not null,
  from_invocation text not null,
  result text not null check (result in ('accepted', 'applied', 'rejected')),
  reason text,
  primary key (revert, app),
  check ((result = 'rejected') = (reason is not null))
) strict;
create trigger rewind_apps_settled
before update on rewind_apps
when old.result != 'accepted'
begin
  select raise(abort, 'a settled app rewind request is final');
end;`,
  },
];
