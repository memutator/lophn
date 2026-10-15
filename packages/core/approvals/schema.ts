import type { SchemaStep } from "../../protocol/server/mod.ts";

// 보류 request 한 행. intent는 canonical JSON이라 같은 intent의 중복을 글 비교로 찾는다.
// created_seq·decided_seq는 그때 ledger 끝의 seq다. 순서를 보이는 표시이고 event를 가리키지 않는다.
// 끝난 request는 다시 열리지 않으므로 status는 pending에서 한 번만 바뀐다.
export const APPROVAL_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "approvals",
    sql: `
create table approval_requests (
  id text primary key,
  intent text not null,
  choices text not null,
  status text not null check (status in ('pending', 'allow', 'reject', 'cancelled')),
  reject_reason text,
  applied text,
  created_seq integer not null,
  decided_seq integer,
  created_at text not null,
  decided_at text,
  check ((status = 'pending') = (decided_seq is null)),
  check (reject_reason is null or status = 'reject'),
  check (applied is null or status = 'allow')
);
create index approval_requests_pending on approval_requests (created_seq, id)
  where status = 'pending';
create index approval_requests_unapplied on approval_requests (decided_seq)
  where status = 'allow' and applied is null;`,
  },
];
