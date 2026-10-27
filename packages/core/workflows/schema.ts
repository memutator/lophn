import {
  WORKFLOW_LINE_KINDS,
  WORKFLOW_STATES,
} from "../../protocol/workflows/mod.ts";
import type { SchemaStep } from "../../protocol/server/mod.ts";

const list = (values: readonly string[]) =>
  values.map((value) => `'${value}'`).join(", ");

// instance 한 행과 그 줄. 다른 module의 표(session, message, project)는 물리 FK 없이 id만 적는다.
// - state_seq는 이 표 안에서 이어 센다(기록 event를 남기지 않는다).
// - 끝난 instance를 막는 trigger는 없다. ended는 기록일 뿐이라 running으로 돌아올 수 있고,
//   stopped의 넘기기는 command가 거절한다.
// - 줄은 기록이라 고치거나 지우지 않는다. body는 started·report의 글, data는 kind별 나머지 칸이다.
export const workflowsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "workflows.tables",
    sql: `
    CREATE TABLE workflow_instances (
      id TEXT PRIMARY KEY NOT NULL,
      project TEXT NOT NULL,
      workflow TEXT NOT NULL,
      input TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (${list(WORKFLOW_STATES)})),
      participants TEXT NOT NULL CHECK (json_valid(participants)),
      steps TEXT NOT NULL CHECK (json_valid(steps)),
      current_step TEXT,
      human_turn INTEGER NOT NULL CHECK (human_turn IN (0, 1)),
      started_by TEXT NOT NULL CHECK (json_valid(started_by)),
      created_at TEXT NOT NULL,
      finished_at TEXT,
      state_seq INTEGER NOT NULL,
      CHECK ((state = 'running') = (finished_at IS NULL))
    ) STRICT;
    CREATE INDEX workflow_instances_workflow
      ON workflow_instances(project, workflow, id);
    CREATE INDEX workflow_instances_state ON workflow_instances(state, id);
    CREATE TABLE workflow_lines (
      instance TEXT NOT NULL,
      seq INTEGER NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN (${list(WORKFLOW_LINE_KINDS)})),
      by TEXT NOT NULL CHECK (json_valid(by)),
      step TEXT,
      body TEXT,
      data TEXT CHECK (data IS NULL OR json_valid(data)),
      PRIMARY KEY (instance, seq)
    ) STRICT;
    CREATE INDEX workflow_lines_kind ON workflow_lines(instance, kind);
    CREATE TRIGGER workflow_lines_keep BEFORE UPDATE ON workflow_lines
    BEGIN SELECT RAISE(ABORT, 'a workflow line does not change'); END;
    CREATE TRIGGER workflow_lines_stay BEFORE DELETE ON workflow_lines
    BEGIN SELECT RAISE(ABORT, 'a workflow line is not deleted'); END;
  `,
  },
];
