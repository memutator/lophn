import type { SchemaStep } from "../../protocol/platform/mod.ts";

// secrets는 현재 참조만 담는다. secret_preparations는 command 밖 OS 준비의 증거다.
// 둘 다 값·hash·길이·일부를 담지 않는다(domain model).
export const SECRET_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "secrets",
    sql: `
create table secrets (
  name text primary key,
  sealed_ref text not null check (length(sealed_ref) > 0),
  revision integer not null check (revision >= 1)
);
create table secret_preparations (
  preparation text primary key,
  sealed_ref text not null check (length(sealed_ref) > 0),
  purpose text not null,
  owner text not null
);`,
  },
];
