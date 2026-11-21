import type { SchemaStep } from "../../protocol/server/mod.ts";

// 기계 사이 mail의 표(machine-a2a). `router/remote-sender-schema.ts`와 `lophn-agent/session/remote-sender-schema.ts`의 step 뒤에 잇는다.
// - mail_outbox: 다른 기계로 낼 mail. 받는 기계가 ack하거나 옛 판이라 거절할 때까지 남는다. seq는 상대(peer)마다 1부터 늘고 줄을 지워도
//   다시 쓰지 않는다(mail_seq).
// - mail_seen: 받은 mail. 같은 mail id(보낸 기계마다)를 한 번만 적용하는 근거다. `mail`은 대기 목록에 선(held) 줄만 든다.
export const mailSchemaSteps: readonly SchemaStep[] = [
  {
    id: "router.mail.tables",
    sql: `
create table mail_outbox (
  id text primary key,
  peer text not null,
  seq integer not null,
  call text not null,
  kind text not null check (kind in ('call', 'reply', 'cancel', 'state')),
  mail text not null check (json_valid(mail)),
  sent_at text not null,
  expires_at text not null,
  unique (peer, seq)
);
create table mail_seq (
  peer text primary key,
  next integer not null
);
create table mail_seen (
  origin text not null,
  id text not null,
  call text not null,
  kind text not null,
  state text not null check (state in ('applied', 'held', 'started', 'skipped', 'expired', 'cancelled', 'refused')),
  mail text check (mail is null or json_valid(mail)),
  computer text not null,
  arrived_at text not null,
  primary key (origin, id)
);`,
  },
];
