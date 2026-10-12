import type { SchemaStep } from "../../contracts/platform/mod.ts";

// approval_requests는 고정 JSON과 blob 참조를 담는다(domain model ledger 표).
// 생성 뒤 내용 컬럼은 바꾸지 않고, 종료는 pending에서 한 번만 기록한다.
// 종료 이유 글은 거절·취소에서 적었을 때만 blob 참조가 있다(R14). 만료는 이유 글이 없다. approval_uses는 platform/ledger의 공통 사용 함수(Tx.useApproval)만 쓴다.
// 허락 범위(grant_scope)와 session 허락이 사는 session(grant_session)은 허락 결정 때 한 번 정해진다.
// session 허락은 별도 표가 아니라 이 열을 조회해 계산한다(R19).
export const APPROVAL_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "approvals",
    sql: `
create table approval_requests (
  id text primary key,
  requester text not null,
  run text,
  reason_blob text not null,
  effect text not null,
  action text not null,
  action_binding_hash text not null,
  expires_at text,
  session_grantable integer not null check (session_grantable in (0, 1)),
  status text not null check (
    status in ('pending', 'granted', 'rejected', 'expired', 'cancelled')
  ),
  grant_scope text check (grant_scope in ('once', 'session')),
  grant_session text,
  closed_reason_blob text,
  created_seq integer not null unique references events (seq),
  closed_seq integer unique references events (seq),
  check (
    (status = 'pending' and closed_seq is null and closed_reason_blob is null) or
    (status = 'granted' and closed_seq is not null and closed_reason_blob is null) or
    (status in ('rejected', 'cancelled') and closed_seq is not null) or
    (status = 'expired' and closed_seq is not null and closed_reason_blob is null)
  ),
  check (expires_at is null or length(expires_at) > 0),
  check ((grant_scope is not null) = (status = 'granted')),
  check (
    (grant_scope = 'session' and session_grantable = 1 and grant_session is not null) or
    (grant_scope is not 'session' and grant_session is null)
  )
);
create index approval_requests_pending on approval_requests (status, expires_at)
  where status = 'pending';
create index approval_requests_run on approval_requests (run, created_seq);
create index approval_requests_binding on approval_requests (action_binding_hash, status);
create index approval_requests_grant_session on approval_requests (grant_session)
  where grant_scope = 'session';
create trigger approval_requests_content_immutable before update on approval_requests
when
  old.id != new.id or old.requester != new.requester or old.run is not new.run or
  old.reason_blob != new.reason_blob or old.effect != new.effect or
  old.action != new.action or old.action_binding_hash != new.action_binding_hash or
  old.expires_at is not new.expires_at or old.created_seq != new.created_seq or
  old.session_grantable != new.session_grantable
begin
  select raise(abort, 'approval request 내용은 생성 뒤 바꾸지 않는다');
end;
create trigger approval_requests_no_delete before delete on approval_requests
when not exists (select 1 from erase_windows where table_name = 'approval_requests')
begin
  select raise(abort, 'approval request는 지우지 않는다');
end;
create table approval_uses (
  approval text primary key references approval_requests (id),
  concern text not null,
  receipt text not null,
  accepted_seq integer not null references events (seq)
);
create index approval_uses_concern on approval_uses (concern, accepted_seq);
create trigger approval_uses_no_update before update on approval_uses
begin
  select raise(abort, 'approval 사용은 불변이다');
end;
create trigger approval_uses_no_delete before delete on approval_uses
when not exists (select 1 from erase_windows where table_name = 'approval_uses')
begin
  select raise(abort, 'approval 사용은 지우지 않는다');
end;`,
  },
];
