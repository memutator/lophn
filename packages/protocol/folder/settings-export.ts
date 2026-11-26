// agent, skill, project command, permission rules, workflow 정의를 다른 컴퓨터로 보내고 받은 쪽에서 사람이 검토해 적용하는 계약이다.
import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema, sha256Schema } from "../base/values.ts";

export const SETTINGS_EXPORT_KINDS = [
  "agent",
  "skill",
  "project_command",
  "permission_rules",
  "workflow",
] as const;
export const settingsExportKindSchema = z.enum(SETTINGS_EXPORT_KINDS);
export type SettingsExportKind = z.infer<typeof settingsExportKindSchema>;

const SETTINGS_EXPORT_BODY_MAX_BYTES = 16 * 1024 * 1024;

export const settingsExportFileSchema = z.strictObject({
  rel_path: z.string().min(1).max(512),
  content: z.string(),
  sha256: sha256Schema,
});
export type SettingsExportFile = z.infer<typeof settingsExportFileSchema>;

export const settingsExportItemSchema = z.strictObject({
  kind: settingsExportKindSchema,
  id: z.string().min(1).max(256),
  title: z.string().min(1).max(256),
  files: z.array(settingsExportFileSchema).min(1).max(256),
  meta: z.record(z.string(), z.unknown()).optional(),
  locked_fields: z.array(z.string()).optional(),
});
export type SettingsExportItem = z.infer<typeof settingsExportItemSchema>;

export const stagedSettingsBatchSchema = z.strictObject({
  id: idSchema("stg"),
  from_machine: idSchema("mch"),
  from_name: z.string().min(1).max(128),
  to_machine: idSchema("mch"),
  project_identity: idSchema("pri").nullable(),
  items: z.array(settingsExportItemSchema).min(1),
  state: z.enum(["pending", "applied", "dismissed"]),
  delivery_state: z.enum(["queued", "held_at_hub", "delivered"]),
  note: z.string().nullable(),
  created_at: atSchema,
  updated_at: atSchema,
});
export type StagedSettingsBatch = z.infer<typeof stagedSettingsBatchSchema>;

export const settingsExportSend = defineMemory({
  body_max_bytes: SETTINGS_EXPORT_BODY_MAX_BYTES,
  resource: "settings_export",
  method: "send",
  name: "settings_export.send",
  input: z.strictObject({
    to: z.string().min(1).max(128),
    items: z
      .array(
        z.strictObject({
          kind: settingsExportKindSchema,
          id: z.string().min(1).max(256),
        }),
      )
      .min(1)
      .max(64)
      .optional(),
    raw_items: z.array(settingsExportItemSchema).min(1).max(64).optional(),
    project: z.string().min(1).optional(),
    note: z.string().max(4000).optional(),
  }),
  output: z.strictObject({
    batch: idSchema("stg"),
    to_machine: idSchema("mch"),
    delivery_state: z.enum(["queued", "held_at_hub", "delivered"]),
    item_count: z.number().int().min(1),
  }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "conflict",
    "unavailable",
  ],
});

export const settingsExportStaged = defineMemory({
  resource: "settings_export",
  method: "staged",
  name: "settings_export.staged",
  input: z.strictObject({
    state: z.enum(["pending", "all"]).optional(),
  }),
  output: z.strictObject({
    batches: z.array(stagedSettingsBatchSchema),
  }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const settingsExportApply = defineMemory({
  resource: "settings_export",
  method: "apply",
  name: "settings_export.apply",
  input: z.strictObject({
    batch: idSchema("stg"),
    item_ids: z.array(z.string().min(1)).optional(),
    project: z.string().min(1).optional(),
    overwrite: z.boolean().optional(),
    // permission_rules와 locked field는 사람이 화면이나 --confirm-permissions로 직접 확인해야 적용한다.
    confirm_permissions: z.boolean().optional(),
  }),
  output: z.strictObject({
    applied: z.array(
      z.strictObject({
        kind: settingsExportKindSchema,
        id: z.string(),
        status: z.enum([
          "applied",
          "skipped_conflict",
          "requires_person_confirmation",
        ]),
      }),
    ),
    requires_permission_confirmation: z.boolean(),
  }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "conflict",
    "unavailable",
  ],
});

export const settingsExportDismiss = defineMemory({
  resource: "settings_export",
  method: "dismiss",
  name: "settings_export.dismiss",
  input: z.strictObject({
    batch: idSchema("stg"),
  }),
  output: z.strictObject({
    dismissed: z.boolean(),
  }),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "forbidden", "unavailable"],
});

export const SETTINGS_EXPORT_ROUTES = [
  settingsExportSend,
  settingsExportStaged,
  settingsExportApply,
  settingsExportDismiss,
] as const;
