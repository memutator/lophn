import type { SchemaStep } from "../../protocol/server/mod.ts";

// instance 한 행과 그 줄. 다른 module의 표(session, message, project)는 물리 FK 없이 id만 적는다.
// - state_seq는 이 표 안에서 이어 센다(기록 event를 남기지 않는다).
// - 끝난 instance를 막는 trigger는 없다. ended는 기록일 뿐이라 running으로 돌아올 수 있고,
//   stopped의 넘기기는 command가 거절한다.
// - participants는 `{ agent, workspace? } | { kind: "human" }` JSON이다.
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
      state TEXT NOT NULL CHECK (state IN ('running', 'ended', 'stopped')),
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
      kind TEXT NOT NULL CHECK (kind IN ('started', 'report', 'edit', 'handed', 'not_handed', 'ended', 'stopped', 'lophn_restarted', 'program_exited')),
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
  // place를 workspace로 부르게 됐다. 참가자 `{ agent, place }`의 key를 옮긴다.
  {
    id: "workflows.workspace",
    sql: `
    UPDATE workflow_instances SET participants = (
      SELECT json_group_object(key, CASE
        WHEN json_type(value, '$.place') IS NULL THEN json(value)
        ELSE json_set(json_remove(value, '$.place'), '$.workspace', json(value -> '$.place'))
      END)
      FROM json_each(workflow_instances.participants)
    ) WHERE EXISTS (
      SELECT 1 FROM json_each(workflow_instances.participants)
      WHERE json_type(value, '$.place') IS NOT NULL
    );
  `,
  },
];

// 위 목록 뒤에 새 step을 붙일 수 없어(낸 step의 자리가 팀 등록 한가운데다) 목록 끝에 등록하는 wiring(workflows.ts)이 따로 낸다.
// 이름 없는 `{ kind: "harness" }` 참가자와 not_handed 이유 `harness`를 없앴다. harness agent는 이름 있는 agent 참가자다.
// 참가자는 지운다(그 key를 by로 쓰던 step은 넘길 때 unknown_participant가 된다). 줄은 trigger를 잠시 내려 이유를 unresolved로 옮긴다.
export const workflowsNoHarnessKindSteps: readonly SchemaStep[] = [
  {
    id: "workflows.no-harness-kind",
    sql: `
    UPDATE workflow_instances SET participants = (
      SELECT json_group_object(key, json(value))
      FROM json_each(workflow_instances.participants)
      WHERE value ->> '$.kind' IS NOT 'harness'
    ) WHERE EXISTS (
      SELECT 1 FROM json_each(workflow_instances.participants)
      WHERE value ->> '$.kind' IS 'harness'
    );
    DROP TRIGGER workflow_lines_keep;
    UPDATE workflow_lines SET data = json_set(data, '$.reason', 'unresolved')
    WHERE kind = 'not_handed' AND data ->> '$.reason' = 'harness';
    CREATE TRIGGER workflow_lines_keep BEFORE UPDATE ON workflow_lines
    BEGIN SELECT RAISE(ABORT, 'a workflow line does not change'); END;
  `,
  },
];
