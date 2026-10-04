import type { SchemaStep } from "../../contracts/platform/mod.ts";

// approval_requests는 고정 JSON과 blob 참조를 담는다(domain model ledger 표).
// 생성 뒤 내용 컬럼은 바꾸지 않고, 종료는 pending에서 한 번만 기록한다.
// approval_uses는 T23이 쓴다. 여기서는 표만 만든다.
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
  status text not null check (
    status in ('pending', 'granted', 'rejected', 'expired', 'cancelled')
  ),
  closed_reason_blob text,
  created_seq integer not null unique references events (seq),
  closed_seq integer unique references events (seq),
  check (
    (status = 'pending' and closed_seq is null and closed_reason_blob is null) or
    (status = 'granted' and closed_seq is not null and closed_reason_blob is null) or
    (status in ('rejected', 'expired', 'cancelled') and closed_seq is not null and closed_reason_blob is not null)
  ),
  check (expires_at is null or length(expires_at) > 0)
);
create index approval_requests_pending on approval_requests (status, expires_at)
  where status = 'pending';
create index approval_requests_run on approval_requests (run, created_seq);
create index approval_requests_binding on approval_requests (action_binding_hash, status);
create trigger approval_requests_content_immutable before update on approval_requests
when
  old.id != new.id or old.requester != new.requester or old.run is not new.run or
  old.reason_blob != new.reason_blob or old.effect != new.effect or
  old.action != new.action or old.action_binding_hash != new.action_binding_hash or
  old.expires_at is not new.expires_at or old.created_seq != new.created_seq
begin
  select raise(abort, 'approval request 내용은 생성 뒤 바꾸지 않는다');
end;
create trigger approval_requests_no_delete before delete on approval_requests
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
begin
  select raise(abort, 'approval 사용은 지우지 않는다');
end;`,
  },
];
