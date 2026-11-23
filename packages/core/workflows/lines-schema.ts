import type { SchemaStep } from "../../protocol/server/mod.ts";

// workflow_lines의 kind check에 step_stalled, retried, escalated, code_updated를 더한다. check는 표에 박혀 있어 표를 다시 짠다.
// 한 번에 넷을 다 더해 다시 짜는 일을 한 번으로 줄였다. 낸 step의 자리가 팀 등록 한가운데라 목록 끝에 등록하는 wiring(remote)이 낸다.
// index와 append-only trigger 둘(workflow_lines_keep, workflow_lines_stay)은 표와 같이 사라져 그대로 다시 만든다.
export const workflowLinesSchemaSteps: readonly SchemaStep[] = [
  {
    id: "workflows.lines-kinds",
    sql: `
    CREATE TABLE workflow_lines_new (
      instance TEXT NOT NULL,
      seq INTEGER NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('started', 'report', 'edit', 'handed', 'not_handed', 'ended', 'stopped', 'lophn_restarted', 'program_exited', 'step_stalled', 'retried', 'escalated', 'code_updated')),
      by TEXT NOT NULL CHECK (json_valid(by)),
      step TEXT,
      body TEXT,
      data TEXT CHECK (data IS NULL OR json_valid(data)),
      PRIMARY KEY (instance, seq)
    ) STRICT;
    INSERT INTO workflow_lines_new (instance, seq, at, kind, by, step, body, data)
    SELECT instance, seq, at, kind, by, step, body, data FROM workflow_lines;
    DROP TABLE workflow_lines;
    ALTER TABLE workflow_lines_new RENAME TO workflow_lines;
    CREATE INDEX workflow_lines_kind ON workflow_lines(instance, kind);
    CREATE TRIGGER workflow_lines_keep BEFORE UPDATE ON workflow_lines
    BEGIN SELECT RAISE(ABORT, 'a workflow line does not change'); END;
    CREATE TRIGGER workflow_lines_stay BEFORE DELETE ON workflow_lines
    BEGIN SELECT RAISE(ABORT, 'a workflow line is not deleted'); END;
  `,
  },
];
