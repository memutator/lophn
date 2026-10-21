import {
  RUN_FAIL_REASONS,
  RUN_KINDS,
  RUN_STATES,
} from "../../protocol/runs/mod.ts";
import type { SchemaStep } from "../../protocol/server/mod.ts";

const list = (values: readonly string[]) =>
  values.map((value) => `'${value}'`).join(", ");

// run 한 행. 다른 module의 표(session, message, turn)는 물리 FK 없이 id만 적는다.
// - agent_key·place_key는 ListRuns 거르기용이다. 만들 때 정하고 바뀌지 않는다.
// - result는 JSON 글이다. JSON null과 SQL NULL은 읽을 때 둘 다 null이다.
// - state_seq는 이 표 안에서 이어 센다(기록 event를 남기지 않는다).
// - 끝난 행은 다시 바뀌지 않는다.
export const runsSchemaSteps: readonly SchemaStep[] = [{
  id: "runs.tables",
  sql: `
    CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN (${list(RUN_KINDS)})),
      target TEXT NOT NULL CHECK (json_valid(target)),
      session TEXT,
      session_opened INTEGER NOT NULL CHECK (session_opened IN (0, 1)),
      input_message TEXT,
      turn TEXT,
      invocation TEXT,
      schema TEXT CHECK (schema IS NULL OR json_valid(schema)),
      state TEXT NOT NULL CHECK (state IN (${list(RUN_STATES)})),
      result TEXT CHECK (result IS NULL OR json_valid(result)),
      error_reason TEXT CHECK (
        error_reason IS NULL OR error_reason IN (${list(RUN_FAIL_REASONS)})
      ),
      error_message TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      state_seq INTEGER NOT NULL,
      agent_key TEXT,
      place_key TEXT,
      CHECK ((state = 'failed') = (error_reason IS NOT NULL)),
      CHECK ((error_reason IS NULL) = (error_message IS NULL)),
      CHECK ((state = 'running') = (finished_at IS NULL))
    ) STRICT;
    CREATE INDEX runs_session ON runs(session, id);
    CREATE INDEX runs_agent ON runs(agent_key, id);
    CREATE INDEX runs_place ON runs(place_key, id);
    CREATE INDEX runs_state ON runs(state, id);
    CREATE TRIGGER runs_finished_stays BEFORE UPDATE ON runs
    WHEN old.state <> 'running'
    BEGIN SELECT RAISE(ABORT, 'a finished run does not change'); END;
  `,
}];
