import type { SchemaStep } from "../../protocol/server/mod.ts";
import { defineBlobField } from "../../protocol/storage/mod.ts";

// durable workflow 실행의 정본(workflow_checkpoints)과 시작 시점 code snapshot(workflow_instances.code_snapshot)을 더한다.
// 낸 step 목록의 맨 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams 끝에서 잇는다.
export const WORKFLOW_CHECKPOINTS_SCHEMA_STEP: SchemaStep = {
  id: "workflows.checkpoints-and-snapshot",
  sql: `
    CREATE TABLE workflow_checkpoints (
      instance TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('step','agent','human','workflow','tool')),
      state TEXT NOT NULL CHECK (state IN ('started','completed','failed','interrupted')),
      handle_ref TEXT,
      output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      PRIMARY KEY (instance, key)
    ) STRICT;
    CREATE INDEX workflow_checkpoints_instance ON workflow_checkpoints(instance);
    ALTER TABLE workflow_instances ADD COLUMN code_snapshot TEXT;
  `,
};

export const workflowCheckpointsSchemaSteps: readonly SchemaStep[] = [
  WORKFLOW_CHECKPOINTS_SCHEMA_STEP,
];

// flow instance 시작·재개 시점의 code snapshot blob. 활성/기록 instance의 replay 근거이므로 permanent로 보존한다.
export const WORKFLOW_SNAPSHOT_BLOB_PURPOSE = "workflow_snapshot";
export const WORKFLOW_SNAPSHOT_BLOB_OWNER_KIND = "workflow_instance";
export const WORKFLOW_SNAPSHOT_BLOB_FIELD_NAME = "code_snapshot";

export const WORKFLOW_SNAPSHOT_BLOB_FIELD = defineBlobField({
  owner_kind: WORKFLOW_SNAPSHOT_BLOB_OWNER_KIND,
  field: WORKFLOW_SNAPSHOT_BLOB_FIELD_NAME,
  retention: { kind: "permanent" },
  general_read: false,
});
