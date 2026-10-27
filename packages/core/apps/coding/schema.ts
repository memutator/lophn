import type { SchemaStep } from "../../../protocol/server/mod.ts";

// coding session과 앱 줄의 표. 값은 lophn이 꺼지면 의미를 잃어 recover가 켤 때 정리한다.
// 메모리가 아니라 ledger에 두는 이유: command는 writer Worker에서 돌고 reader는 `CodingSessionLookup`과
// 줄을 읽어야 하는데, 둘이 같은 메모리를 볼 수 없고 tx가 되돌아가면 표도 같이 되돌아가야 하기 때문이다.
export const codingSchemaSteps: readonly SchemaStep[] = [
  {
    id: "coding-agent.sessions.tables",
    sql: `
    CREATE TABLE coding_sessions (
      session TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      prompt TEXT NOT NULL,
      call TEXT NOT NULL,
      harness TEXT NOT NULL,
      ended INTEGER NOT NULL DEFAULT 0 CHECK (ended IN (0, 1)),
      started INTEGER NOT NULL DEFAULT 0 CHECK (started IN (0, 1)),
      heard INTEGER NOT NULL DEFAULT 0 CHECK (heard IN (0, 1)),
      running INTEGER NOT NULL DEFAULT 0 CHECK (running IN (0, 1)),
      turn TEXT,
      permissions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(permissions)),
      inflight INTEGER NOT NULL DEFAULT 0 CHECK (inflight IN (0, 1)),
      external_session TEXT,
      -- 첫 prompt를 harness에 넘겼으나 MessageReceived를 아직 내지 않았다.
      prompt_pending INTEGER NOT NULL DEFAULT 0 CHECK (prompt_pending IN (0, 1)),
      paste_until TEXT
    ) STRICT;
    CREATE UNIQUE INDEX coding_sessions_active ON coding_sessions(app) WHERE ended = 0;
    CREATE INDEX coding_sessions_call ON coding_sessions(call);

    CREATE TABLE coding_lines (
      call TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options TEXT NOT NULL CHECK (json_valid(options))
    ) STRICT;
    CREATE INDEX coding_lines_app ON coding_lines(app);

    CREATE TABLE coding_inputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT NOT NULL,
      call TEXT,
      text TEXT NOT NULL
    ) STRICT;
    CREATE INDEX coding_inputs_session ON coding_inputs(session, id);`,
  },
];
