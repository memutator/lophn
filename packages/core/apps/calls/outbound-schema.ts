import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 이 컴퓨터가 다른 컴퓨터의 앱 command를 부른 기록. invocation 표와 달리 changeset·rewind가 없고 받는 앱·release를 이 컴퓨터가 모른다.
// caller는 요청한 쪽(`Requester`) JSON이고 caller_app·session은 찾기용 칸이다. 낸 때 step 목록의 끝에 붙어야 해서(schema-steps.lock.json)
// WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams에서 잇는다.
export const OUTBOUND_CALLS_SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    id: "apps.remote-calls",
    sql: `
    CREATE TABLE app_remote_calls (
      id TEXT PRIMARY KEY NOT NULL,
      caller TEXT NOT NULL CHECK (json_valid(caller)),
      caller_app TEXT,
      session TEXT,
      machine TEXT NOT NULL,
      computer TEXT NOT NULL,
      app TEXT NOT NULL,
      command TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'denied', 'unknown')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT,
      CHECK ((finished_at IS NOT NULL) = (status <> 'running'))
    ) STRICT;
    CREATE INDEX app_remote_calls_app_id ON app_remote_calls (app, id);
    CREATE INDEX app_remote_calls_caller_app_id ON app_remote_calls (caller_app, id);
    CREATE INDEX app_remote_calls_session_id ON app_remote_calls (session, id);
  `,
  },
];
